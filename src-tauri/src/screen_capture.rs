pub mod capture;

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::state::AppState;
use capture::{
    capture_desktop, crop_task, png_data_url, previous_region, validate_region, DesktopCapture,
    ScreenRegion, SelectedRegion, MAX_TASK_PNG_BYTES,
};

const SELECTOR: &str = "screen-capture";

#[derive(Clone, Serialize)]
pub struct ScreenCaptureFrame {
    pub id: String,
    pub image_url: String,
    pub width: u32,
    pub height: u32,
}

struct PendingCapture {
    id: String,
    desktop: DesktopCapture,
    preview: String,
}

#[derive(Default)]
struct CaptureInner {
    busy: bool,
    pending: Option<PendingCapture>,
    task: Option<ScreenCaptureFrame>,
    region: Option<SelectedRegion>,
}

/// Only one frozen desktop and one selected task live in memory. No disk writes.
#[derive(Default)]
pub struct ScreenCaptureState(Mutex<CaptureInner>);

impl ScreenCaptureState {
    pub fn task_image(&self, id: &str) -> Result<String, String> {
        let inner = self.0.lock().map_err(|_| "Screen capture is unavailable")?;
        match &inner.task {
            Some(task) if task.id == id => Ok(task.image_url.clone()),
            _ => Err("Screen task expired. Capture the task again".into()),
        }
    }

    pub fn is_capturing(&self) -> bool {
        self.0
            .lock()
            .map_or(true, |inner| inner.busy || inner.pending.is_some())
    }

    fn begin(&self, app_state: &AppState) -> Result<(), String> {
        if let Some(intel) = &app_state.intelligence {
            if intel
                .lock()
                .map_err(|_| "AI is unavailable")?
                .is_generating()
            {
                return Err(
                    "Wait for the current answer or stop it before capturing a task".into(),
                );
            }
        }
        let mut inner = self.0.lock().map_err(|_| "Screen capture is unavailable")?;
        if inner.busy || inner.pending.is_some() {
            return Err("Screen selection is already open".into());
        }
        inner.busy = true;
        Ok(())
    }
}

async fn desktop_without_nexq(
    app: &AppHandle,
    active_display_only: bool,
) -> Result<DesktopCapture, String> {
    // Off the UI thread, Tauri hide() only queues a message. Acknowledge the
    // actual native calls on that thread before flushing DWM and reading pixels.
    let (hidden_tx, hidden_rx) = tokio::sync::oneshot::channel();
    let hide_app = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| {
            let mut hidden: Vec<tauri::WebviewWindow> = Vec::new();
            for (label, window) in hide_app.webview_windows() {
                if label != SELECTOR && window.is_visible().unwrap_or(false) {
                    if let Err(error) = window.hide() {
                        for previous in hidden {
                            let _ = previous.show();
                        }
                        return Err(format!("Could not hide NexQ before capture: {error}"));
                    }
                    hidden.push(window);
                }
            }
            Ok(hidden)
        })();
        let _ = hidden_tx.send(result);
    })
    .map_err(|error| format!("Could not prepare screen capture: {error}"))?;
    let hidden = hidden_rx
        .await
        .map_err(|_| "Screen capture window operation stopped")??;
    let result = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        unsafe {
            let _ = windows::Win32::Graphics::Dwm::DwmFlush();
        }
        capture_desktop(active_display_only)
    })
    .await
    .map_err(|e| format!("Screen capture stopped: {e}"));
    let (restore_tx, restore_rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        for window in hidden {
            let _ = window.show();
        }
        let _ = restore_tx.send(());
    })
    .map_err(|error| format!("Could not restore NexQ after capture: {error}"))?;
    restore_rx
        .await
        .map_err(|_| "Screen capture window operation stopped")?;
    result?
}

#[tauri::command]
pub async fn start_screen_capture(
    app_handle: AppHandle,
    capture_state: State<'_, ScreenCaptureState>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    capture_state.begin(&state)?;
    let result = start_selection(&app_handle, &capture_state).await;
    if result.is_err() {
        if let Ok(mut inner) = capture_state.0.lock() {
            inner.busy = false;
            inner.pending = None;
        }
        if let Some(window) = app_handle.get_webview_window(SELECTOR) {
            let _ = window.close();
        }
    }
    result
}

async fn start_selection(app: &AppHandle, state: &ScreenCaptureState) -> Result<(), String> {
    let desktop = desktop_without_nexq(app, false).await?;
    let bounds = desktop.bounds;
    let (desktop, preview) = tauri::async_runtime::spawn_blocking(move || {
        let preview = png_data_url(&desktop.pixels, None)?;
        Ok::<_, String>((desktop, preview))
    })
    .await
    .map_err(|e| format!("Screen preview stopped: {e}"))??;
    let id = uuid::Uuid::new_v4().to_string();
    {
        let mut inner = state
            .0
            .lock()
            .map_err(|_| "Screen capture is unavailable")?;
        inner.pending = Some(PendingCapture {
            id: id.clone(),
            desktop,
            preview,
        });
        inner.busy = false;
    }
    let window = WebviewWindowBuilder::new(
        app,
        SELECTOR,
        WebviewUrl::App(format!("index.html?view=screen-capture&captureId={id}").into()),
    )
    .title("Select screen task")
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .shadow(false)
    .build()
    .map_err(|e| format!("Could not open screen selector: {e}"))?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let capture = handle.state::<ScreenCaptureState>();
            if let Ok(mut inner) = capture.0.lock() {
                if inner
                    .pending
                    .as_ref()
                    .is_some_and(|pending| pending.id == id)
                {
                    inner.pending = None;
                    inner.busy = false;
                }
            };
        }
    });
    window
        .set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| e.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(bounds.width, bounds.height))
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_screen_capture(
    capture_state: State<'_, ScreenCaptureState>,
) -> Result<ScreenCaptureFrame, String> {
    let inner = capture_state
        .0
        .lock()
        .map_err(|_| "Screen capture is unavailable")?;
    let pending = inner.pending.as_ref().ok_or("Screen selection expired")?;
    Ok(ScreenCaptureFrame {
        id: pending.id.clone(),
        image_url: pending.preview.clone(),
        width: pending.desktop.bounds.width,
        height: pending.desktop.bounds.height,
    })
}

#[tauri::command]
pub fn cancel_screen_capture(
    capture_id: String,
    app_handle: AppHandle,
    capture_state: State<'_, ScreenCaptureState>,
) -> Result<(), String> {
    {
        let mut inner = capture_state
            .0
            .lock()
            .map_err(|_| "Screen capture is unavailable")?;
        if inner
            .pending
            .as_ref()
            .is_none_or(|pending| pending.id != capture_id)
        {
            return Err("Screen selection expired".into());
        }
        inner.pending = None;
        inner.busy = false;
    }
    if let Some(window) = app_handle.get_webview_window(SELECTOR) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn finish_screen_capture(
    capture_id: String,
    region: ScreenRegion,
    app_handle: AppHandle,
    capture_state: State<'_, ScreenCaptureState>,
) -> Result<(), String> {
    let pending = {
        let mut inner = capture_state
            .0
            .lock()
            .map_err(|_| "Screen capture is unavailable")?;
        let pending = inner
            .pending
            .as_ref()
            .filter(|p| p.id == capture_id)
            .ok_or("Screen selection expired")?;
        validate_region(
            region,
            pending.desktop.bounds.width,
            pending.desktop.bounds.height,
        )?;
        inner.busy = true;
        inner.pending.take().ok_or("Screen selection expired")?
    };
    let bounds = pending.desktop.bounds;
    let encoded = tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            let image = crop_task(&pending.desktop.pixels, region)?;
            Ok::<_, String>(ScreenCaptureFrame {
                id: pending.id.clone(),
                image_url: png_data_url(&image, Some(MAX_TASK_PNG_BYTES))?,
                width: image.width(),
                height: image.height(),
            })
        })();
        // Retain the frozen desktop so an encoding error allows a smaller selection.
        (pending, result)
    })
    .await;
    let task = {
        let mut inner = capture_state
            .0
            .lock()
            .map_err(|_| "Screen capture is unavailable")?;
        inner.busy = false;
        let (pending, result) = match encoded {
            Ok(encoded) => encoded,
            Err(error) => {
                drop(inner);
                if let Some(window) = app_handle.get_webview_window(SELECTOR) {
                    let _ = window.close();
                }
                return Err(format!("Screen selection stopped: {error}"));
            }
        };
        let task = match result {
            Ok(task) => task,
            Err(error) => {
                // Alt+F4 may have closed the selector while the PNG was encoding.
                if app_handle.get_webview_window(SELECTOR).is_some() {
                    inner.pending = Some(pending);
                }
                return Err(error);
            }
        };
        inner.region = Some(SelectedRegion {
            x: i64::from(bounds.x) + i64::from(region.x),
            y: i64::from(bounds.y) + i64::from(region.y),
            width: region.width,
            height: region.height,
            desktop: bounds,
        });
        inner.task = Some(task.clone());
        task
    };
    // Close only after encoding succeeds, and before publishing the answer.
    if let Some(window) = app_handle.get_webview_window(SELECTOR) {
        let _ = window.close();
    }
    publish_task(&app_handle, &task)
}

/// Capture the foreground window's display and let the existing vision request find the task.
#[tauri::command]
pub async fn capture_screen_task(
    app_handle: AppHandle,
    capture_state: State<'_, ScreenCaptureState>,
    state: State<'_, AppState>,
) -> Result<ScreenCaptureFrame, String> {
    capture_state.begin(&state)?;
    let result = capture_active_task(&app_handle, &capture_state).await;
    if let Ok(mut inner) = capture_state.0.lock() {
        inner.busy = false;
    }
    result
}

async fn capture_active_task(
    app: &AppHandle,
    state: &ScreenCaptureState,
) -> Result<ScreenCaptureFrame, String> {
    let desktop = desktop_without_nexq(app, true).await?;
    let task = tauri::async_runtime::spawn_blocking(move || {
        let image = crop_task(
            &desktop.pixels,
            ScreenRegion {
                x: 0,
                y: 0,
                width: desktop.bounds.width,
                height: desktop.bounds.height,
            },
        )?;
        Ok::<_, String>(ScreenCaptureFrame {
            id: uuid::Uuid::new_v4().to_string(),
            image_url: png_data_url(&image, Some(MAX_TASK_PNG_BYTES))?,
            width: image.width(),
            height: image.height(),
        })
    })
    .await
    .map_err(|error| format!("Screen capture stopped: {error}"))??;
    state
        .0
        .lock()
        .map_err(|_| "Screen capture is unavailable")?
        .task = Some(task.clone());
    Ok(task)
}

#[tauri::command]
pub async fn recapture_screen_region(
    app_handle: AppHandle,
    capture_state: State<'_, ScreenCaptureState>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    capture_state.begin(&state)?;
    let has_region = capture_state
        .0
        .lock()
        .map_err(|_| "Screen capture is unavailable")?
        .region
        .is_some();
    let result = if has_region {
        recapture_region(&app_handle, &capture_state).await
    } else {
        match capture_active_task(&app_handle, &capture_state).await {
            Ok(task) => publish_task(&app_handle, &task),
            Err(error) => Err(error),
        }
    };
    if let Ok(mut inner) = capture_state.0.lock() {
        inner.busy = false;
    }
    result
}

async fn recapture_region(app: &AppHandle, state: &ScreenCaptureState) -> Result<(), String> {
    let selection = state
        .0
        .lock()
        .map_err(|_| "Screen capture is unavailable")?
        .region
        .ok_or("Select a task area first with Capture task")?;
    let desktop = desktop_without_nexq(app, false).await?;
    let region = previous_region(selection, desktop.bounds)?;
    let task = tauri::async_runtime::spawn_blocking(move || {
        let image = crop_task(&desktop.pixels, region)?;
        Ok::<_, String>(ScreenCaptureFrame {
            id: uuid::Uuid::new_v4().to_string(),
            image_url: png_data_url(&image, Some(MAX_TASK_PNG_BYTES))?,
            width: image.width(),
            height: image.height(),
        })
    })
    .await
    .map_err(|e| format!("Screen capture stopped: {e}"))??;
    state
        .0
        .lock()
        .map_err(|_| "Screen capture is unavailable")?
        .task = Some(task.clone());
    publish_task(app, &task)
}

fn publish_task(app: &AppHandle, task: &ScreenCaptureFrame) -> Result<(), String> {
    app.emit_to("overlay", "nexq:screen-task-captured", task)
        .map_err(|e| format!("Could not open screen answer: {e}"))
}
