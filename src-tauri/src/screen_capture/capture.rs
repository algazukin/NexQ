use base64::Engine;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ImageEncoder, RgbaImage};
use serde::{Deserialize, Serialize};

pub const MIN_REGION_EDGE: u32 = 8;
pub const MAX_TASK_EDGE: u32 = 2560;
const MAX_DESKTOP_PIXELS: u64 = 64_000_000;
pub const MAX_TASK_PNG_BYTES: usize = 16 * 1024 * 1024;

/// Coordinates in physical pixels relative to the frozen desktop image.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScreenRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DesktopBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Last selection in desktop coordinates, which may have a negative origin.
#[derive(Clone, Copy, Debug)]
pub struct SelectedRegion {
    pub x: i64,
    pub y: i64,
    pub width: u32,
    pub height: u32,
    pub desktop: DesktopBounds,
}

pub struct DesktopCapture {
    pub bounds: DesktopBounds,
    pub pixels: RgbaImage,
}

pub fn validate_region(region: ScreenRegion, width: u32, height: u32) -> Result<(), String> {
    if region.width < MIN_REGION_EDGE || region.height < MIN_REGION_EDGE {
        return Err("Select an area at least 8 pixels wide and high".into());
    }
    if region
        .x
        .checked_add(region.width)
        .is_none_or(|right| right > width)
        || region
            .y
            .checked_add(region.height)
            .is_none_or(|bottom| bottom > height)
    {
        return Err("Selected area is outside the captured screen".into());
    }
    Ok(())
}

pub fn crop_task(pixels: &RgbaImage, region: ScreenRegion) -> Result<RgbaImage, String> {
    validate_region(region, pixels.width(), pixels.height())?;
    let crop = image::imageops::crop_imm(pixels, region.x, region.y, region.width, region.height)
        .to_image();
    let longest = crop.width().max(crop.height());
    if longest <= MAX_TASK_EDGE {
        return Ok(crop);
    }
    let width =
        (u64::from(crop.width()) * u64::from(MAX_TASK_EDGE) / u64::from(longest)).max(1) as u32;
    let height =
        (u64::from(crop.height()) * u64::from(MAX_TASK_EDGE) / u64::from(longest)).max(1) as u32;
    Ok(image::imageops::resize(
        &crop,
        width,
        height,
        image::imageops::FilterType::Triangle,
    ))
}

pub fn png_data_url(pixels: &RgbaImage, max_bytes: Option<usize>) -> Result<String, String> {
    let mut bytes = Vec::new();
    PngEncoder::new_with_quality(&mut bytes, CompressionType::Fast, FilterType::Adaptive)
        .write_image(
            pixels.as_raw(),
            pixels.width(),
            pixels.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| format!("Could not encode screen image: {e}"))?;
    if max_bytes.is_some_and(|limit| bytes.len() > limit) {
        return Err("Screen image is too large; select a smaller area".into());
    }
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

pub fn previous_region(
    selection: SelectedRegion,
    desktop: DesktopBounds,
) -> Result<ScreenRegion, String> {
    if desktop != selection.desktop {
        return Err("Display layout changed. Select the task area again".into());
    }
    let region = ScreenRegion {
        x: u32::try_from(selection.x - i64::from(desktop.x))
            .map_err(|_| "Selected area is no longer on screen")?,
        y: u32::try_from(selection.y - i64::from(desktop.y))
            .map_err(|_| "Selected area is no longer on screen")?,
        width: selection.width,
        height: selection.height,
    };
    validate_region(region, desktop.width, desktop.height)?;
    Ok(region)
}

#[cfg(not(target_os = "windows"))]
pub fn capture_desktop(_active_display_only: bool) -> Result<DesktopCapture, String> {
    Err("Screen task capture is currently supported on Windows".into())
}

#[cfg(target_os = "windows")]
pub fn capture_desktop(active_display_only: bool) -> Result<DesktopCapture, String> {
    use std::mem::size_of;
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::UI::HiDpi::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    struct DpiContext(DPI_AWARENESS_CONTEXT);
    impl Drop for DpiContext {
        fn drop(&mut self) {
            if !self.0 .0.is_null() {
                unsafe {
                    SetThreadDpiAwarenessContext(self.0);
                }
            }
        }
    }

    // GDI handles must be released on every error path, with the bitmap
    // deselected before it is read or destroyed.
    struct CaptureHandles {
        screen: HDC,
        memory: HDC,
        bitmap: HBITMAP,
        previous: Option<HGDIOBJ>,
    }
    impl Drop for CaptureHandles {
        fn drop(&mut self) {
            unsafe {
                if let Some(previous) = self.previous {
                    SelectObject(self.memory, previous);
                }
                if !self.bitmap.is_invalid() {
                    let _ = DeleteObject(self.bitmap);
                }
                if !self.memory.is_invalid() {
                    let _ = DeleteDC(self.memory);
                }
                if !self.screen.is_invalid() {
                    ReleaseDC(None, self.screen);
                }
            }
        }
    }

    unsafe {
        let _dpi = DpiContext(SetThreadDpiAwarenessContext(
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        ));
        let (x, y, width, height) = if active_display_only {
            let monitor = MonitorFromWindow(GetForegroundWindow(), MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO {
                cbSize: size_of::<MONITORINFO>() as u32,
                ..MONITORINFO::default()
            };
            if !GetMonitorInfoW(monitor, &mut info).as_bool() {
                return Err("Could not locate the active display".into());
            }
            let rect = info.rcMonitor;
            (
                rect.left,
                rect.top,
                rect.right - rect.left,
                rect.bottom - rect.top,
            )
        } else {
            (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
                GetSystemMetrics(SM_CXVIRTUALSCREEN),
                GetSystemMetrics(SM_CYVIRTUALSCREEN),
            )
        };
        if width <= 0 || height <= 0 || (width as u64) * (height as u64) > MAX_DESKTOP_PIXELS {
            return Err("Desktop is unavailable or too large to capture".into());
        }
        let bounds = DesktopBounds {
            x,
            y,
            width: width as u32,
            height: height as u32,
        };
        let mut handles = CaptureHandles {
            screen: GetDC(None),
            memory: HDC::default(),
            bitmap: HBITMAP::default(),
            previous: None,
        };
        if handles.screen.is_invalid() {
            return Err("Could not open the Windows desktop".into());
        }
        handles.memory = CreateCompatibleDC(handles.screen);
        if handles.memory.is_invalid() {
            return Err("Could not allocate screen capture context".into());
        }
        handles.bitmap = CreateCompatibleBitmap(handles.screen, width, height);
        if handles.bitmap.is_invalid() {
            return Err("Could not allocate screen image".into());
        }
        let previous = SelectObject(handles.memory, handles.bitmap);
        if previous.is_invalid() {
            return Err("Could not select screen image".into());
        }
        handles.previous = Some(previous);
        BitBlt(
            handles.memory,
            0,
            0,
            width,
            height,
            handles.screen,
            bounds.x,
            bounds.y,
            SRCCOPY | CAPTUREBLT,
        )
        .map_err(|e| format!("Windows screen capture failed: {e}"))?;
        SelectObject(handles.memory, previous);
        handles.previous = None;

        let mut info = BITMAPINFO::default();
        info.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = width;
        info.bmiHeader.biHeight = -height;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB.0;
        let mut bytes = vec![0u8; width as usize * height as usize * 4];
        let rows = GetDIBits(
            handles.memory,
            handles.bitmap,
            0,
            height as u32,
            Some(bytes.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        );
        if rows != height {
            return Err("Windows returned an incomplete screen image".into());
        }
        for pixel in bytes.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            pixel[3] = 255;
        }
        let pixels = RgbaImage::from_raw(width as u32, height as u32, bytes)
            .ok_or("Invalid screen image dimensions")?;
        Ok(DesktopCapture { bounds, pixels })
    }
}

#[cfg(test)]

mod tests {
    use super::*;
    use image::Rgba;

    #[test]
    fn allows_region_touching_screen_edges() {
        // Arrange
        let region = ScreenRegion {
            x: 12,
            y: 4,
            width: 8,
            height: 8,
        };
        // Act
        let result = validate_region(region, 20, 12);
        // Assert
        assert!(result.is_ok());
    }

    #[test]
    fn rejects_tiny_outside_and_overflowing_regions() {
        // Arrange
        let regions = [
            ScreenRegion {
                x: 0,
                y: 0,
                width: 7,
                height: 8,
            },
            ScreenRegion {
                x: 13,
                y: 0,
                width: 8,
                height: 8,
            },
            ScreenRegion {
                x: u32::MAX,
                y: 0,
                width: 8,
                height: 8,
            },
        ];
        // Act
        let rejected = regions.map(|r| validate_region(r, 20, 12).is_err());
        // Assert
        assert_eq!(rejected, [true, true, true]);
    }

    #[test]
    fn crop_contains_only_selected_physical_pixels() {
        // Arrange
        let pixels = RgbaImage::from_fn(20, 12, |x, y| Rgba([x as u8, y as u8, 99, 255]));
        // Act
        let crop = crop_task(
            &pixels,
            ScreenRegion {
                x: 12,
                y: 4,
                width: 8,
                height: 8,
            },
        )
        .unwrap();
        // Assert
        assert_eq!(crop.dimensions(), (8, 8));
        assert_eq!(crop.get_pixel(0, 0), &Rgba([12, 4, 99, 255]));
        assert_eq!(crop.get_pixel(7, 7), &Rgba([19, 11, 99, 255]));
    }

    #[test]
    fn shrinks_large_task_preserving_aspect_ratio() {
        // Arrange
        let pixels = RgbaImage::new(5120, 128);
        // Act
        let crop = crop_task(
            &pixels,
            ScreenRegion {
                x: 0,
                y: 0,
                width: 5120,
                height: 128,
            },
        )
        .unwrap();
        // Assert
        assert_eq!(crop.dimensions(), (MAX_TASK_EDGE, 64));
    }

    #[test]
    fn encodes_png_with_original_small_image_dimensions() {
        // Arrange
        let pixels = RgbaImage::from_pixel(8, 8, Rgba([17, 23, 42, 255]));
        // Act
        let url = png_data_url(&pixels, Some(MAX_TASK_PNG_BYTES)).unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(url.strip_prefix("data:image/png;base64,").unwrap())
            .unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        // Assert
        assert_eq!((decoded.width(), decoded.height()), (8, 8));
        assert_eq!(decoded.to_rgba8().get_pixel(0, 0), &Rgba([17, 23, 42, 255]));
    }

    #[test]
    fn full_desktop_preview_does_not_use_provider_image_limit() {
        // Arrange
        let mut seed = 123456789_u32;
        let pixels = RgbaImage::from_fn(3000, 2000, |_, _| {
            let mut rgb = [0_u8; 4];
            for channel in &mut rgb[..3] {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                *channel = seed as u8;
            }
            rgb[3] = 255;
            Rgba(rgb)
        });
        // Act
        let task = png_data_url(&pixels, Some(MAX_TASK_PNG_BYTES));
        let preview = png_data_url(&pixels, None);
        // Assert
        assert!(task.is_err());
        assert!(preview.is_ok());
    }

    #[test]
    fn repeat_preserves_physical_area_on_negative_origin_monitor() {
        // Arrange
        let desktop = DesktopBounds {
            x: -1920,
            y: -180,
            width: 4480,
            height: 1620,
        };
        let selected = SelectedRegion {
            x: -1600,
            y: 20,
            width: 800,
            height: 600,
            desktop,
        };
        // Act
        let region = previous_region(selected, desktop).unwrap();
        // Assert
        assert_eq!(
            region,
            ScreenRegion {
                x: 320,
                y: 200,
                width: 800,
                height: 600
            }
        );
    }

    #[test]
    fn repeat_rejects_changed_monitor_layout() {
        // Arrange
        let desktop = DesktopBounds {
            x: -1920,
            y: 0,
            width: 4480,
            height: 1440,
        };
        let selected = SelectedRegion {
            x: -1600,
            y: 20,
            width: 800,
            height: 600,
            desktop,
        };
        let changed = DesktopBounds {
            x: 0,
            y: 0,
            width: 2560,
            height: 1440,
        };
        // Act
        let result = previous_region(selected, changed);
        // Assert
        assert!(result.unwrap_err().contains("Display layout changed"));
    }

    #[test]
    #[cfg(target_os = "windows")]
    #[ignore = "Requires an interactive Windows desktop; image stays in memory"]
    fn native_capture_reads_complete_desktop_and_restores_dpi_context() {
        // Arrange
        use windows::Win32::UI::HiDpi::GetThreadDpiAwarenessContext;
        let previous = unsafe { GetThreadDpiAwarenessContext() };
        // Act
        let desktop = capture_desktop(false).unwrap();
        let after = unsafe { GetThreadDpiAwarenessContext() };
        // Assert
        assert_eq!(
            desktop.pixels.dimensions(),
            (desktop.bounds.width, desktop.bounds.height)
        );
        assert!(desktop.pixels.width() > 0 && desktop.pixels.height() > 0);
        assert_eq!(previous, after);
        assert!(desktop.pixels.pixels().all(|pixel| pixel[3] == 255));
    }
    #[test]
    #[cfg(target_os = "windows")]
    #[ignore = "Requires an interactive Windows desktop; pixels stay in memory"]
    fn native_capture_active_display_preserves_physical_bounds_and_dpi() {
        // Arrange
        use windows::Win32::Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        };
        use windows::Win32::UI::HiDpi::{
            GetThreadDpiAwarenessContext, SetThreadDpiAwarenessContext,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        };
        use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
        let previous = unsafe { GetThreadDpiAwarenessContext() };
        unsafe {
            SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        }
        let mut expected = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..MONITORINFO::default()
        };
        let located = unsafe {
            GetMonitorInfoW(
                MonitorFromWindow(GetForegroundWindow(), MONITOR_DEFAULTTONEAREST),
                &mut expected,
            )
            .as_bool()
        };
        unsafe {
            SetThreadDpiAwarenessContext(previous);
        }
        assert!(located);
        // Act
        let desktop = capture_desktop(true).unwrap();
        // Assert
        assert_eq!(desktop.bounds.x, expected.rcMonitor.left);
        assert_eq!(desktop.bounds.y, expected.rcMonitor.top);
        assert_eq!(
            desktop.pixels.dimensions(),
            (
                (expected.rcMonitor.right - expected.rcMonitor.left) as u32,
                (expected.rcMonitor.bottom - expected.rcMonitor.top) as u32
            )
        );
        assert_eq!(unsafe { GetThreadDpiAwarenessContext() }, previous);
        assert!(desktop.pixels.pixels().all(|pixel| pixel[3] == 255));
    }
}
