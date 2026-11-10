//! Follow native visibility so the blur surface is removed before hiding.
//! Based on NexQ upstream visibility handling (0a12b733c17629076427dcb3acda23c5199a5704).
//! Capture affinity is deliberately left to stealth_commands.

use std::sync::Mutex;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    SWP_HIDEWINDOW, SWP_SHOWWINDOW, WINDOWPOS, WM_NCDESTROY, WM_WINDOWPOSCHANGED,
    WM_WINDOWPOSCHANGING,
};

const SUBCLASS_ID: usize = 0x4E58_5142; // "NXQB"
static HOOKED: Mutex<Vec<isize>> = Mutex::new(Vec::new());

pub fn follow_visibility(window: &tauri::WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let hwnd = hwnd.0 as isize;
    let visible = window.is_visible().unwrap_or(false);
    if let Err(error) = window.run_on_main_thread(move || {
        let mut hooked = HOOKED.lock().unwrap_or_else(|error| error.into_inner());
        if hooked.contains(&hwnd) {
            return;
        }
        let installed =
            unsafe { SetWindowSubclass(HWND(hwnd as *mut _), Some(subclass_proc), SUBCLASS_ID, 0) };
        if !installed.as_bool() {
            log::warn!("Could not follow overlay visibility for desktop blur");
            return;
        }
        hooked.push(hwnd);
        drop(hooked);
        set_blur(HWND(hwnd as *mut _), visible);
    }) {
        log::warn!("Could not initialize overlay blur: {error}");
    }
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    match msg {
        WM_WINDOWPOSCHANGING => {
            let position = &*(lparam.0 as *const WINDOWPOS);
            if position.flags.contains(SWP_HIDEWINDOW) {
                set_blur(hwnd, false);
            }
        }
        WM_WINDOWPOSCHANGED => {
            let position = &*(lparam.0 as *const WINDOWPOS);
            if position.flags.contains(SWP_SHOWWINDOW) {
                set_blur(hwnd, true);
            }
        }
        WM_NCDESTROY => {
            let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
            HOOKED
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .retain(|handle| *handle != hwnd.0 as isize);
        }
        _ => {}
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

fn set_blur(hwnd: HWND, enabled: bool) {
    use std::ffi::c_void;
    use windows::core::PCSTR;
    use windows::Win32::System::LibraryLoader::{GetModuleHandleA, GetProcAddress};

    #[repr(C)]
    struct AccentPolicy {
        accent_state: u32,
        accent_flags: u32,
        gradient_color: u32,
        animation_id: u32,
    }
    #[repr(C)]
    struct CompositionData {
        attrib: u32,
        data: *mut c_void,
        size: usize,
    }
    type SetComposition = unsafe extern "system" fn(HWND, *mut CompositionData) -> i32;

    unsafe {
        let Ok(module) = GetModuleHandleA(PCSTR(b"user32.dll\0".as_ptr())) else {
            return;
        };
        let Some(function) =
            GetProcAddress(module, PCSTR(b"SetWindowCompositionAttribute\0".as_ptr()))
        else {
            return;
        };
        let apply: SetComposition = std::mem::transmute(function);
        let mut policy = AccentPolicy {
            accent_state: if enabled { 3 } else { 0 },
            accent_flags: 0,
            // Alpha=1 keeps live blur active; CSS supplies the visible tint.
            gradient_color: 0x01000000,
            animation_id: 0,
        };
        let mut data = CompositionData {
            attrib: 19, // WCA_ACCENT_POLICY
            data: &mut policy as *mut _ as *mut c_void,
            size: std::mem::size_of::<AccentPolicy>(),
        };
        apply(hwnd, &mut data);
    }
}
