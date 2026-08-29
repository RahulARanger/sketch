//! Native macOS tablet input that is not consistently exposed by WKWebView.
//!
//! Wacom's "Erase" pen-button action is delivered to AppKit as tablet input.
//! Depending on the Wacom profile and WebKit version, the webview may receive
//! the resulting pen contact without the eraser/button metadata. The local
//! AppKit monitor preserves that native state and forwards only transitions to
//! the webview.

use block2::RcBlock;
use objc2_app_kit::{NSEvent, NSEventButtonMask, NSEventMask, NSEventType, NSPointingDeviceType};
use std::ptr::NonNull;
use tauri::{AppHandle, Emitter};

const EVENT_NAME: &str = "wacom-eraser-state";

pub fn install(app: &AppHandle) {
    let app = app.clone();
    let previous_state = std::cell::Cell::new(false);
    let monitor = RcBlock::new(move |event: NonNull<NSEvent>| {
        let event_ptr = event.as_ptr();
        let event = unsafe { event.as_ref() };
        let event_type = event.r#type();
        let is_tablet_event = matches!(
            event_type,
            NSEventType::TabletPoint | NSEventType::TabletProximity
        );

        if is_tablet_event {
            let eraser = event.pointingDeviceType() == NSPointingDeviceType::Eraser
                // The configured Erase action is the pen's upper side button.
                // Keep the lower side available for the app's pan binding.
                || event.buttonMask().contains(NSEventButtonMask::PenUpperSide);
            let active = if event_type == NSEventType::TabletProximity {
                eraser && event.isEnteringProximity()
            } else {
                eraser
            };

            if active != previous_state.get() {
                previous_state.set(active);
                if let Err(error) = app.emit(EVENT_NAME, active) {
                    eprintln!("failed to forward Wacom eraser state: {error}");
                }
            }
        }

        event_ptr
    });

    let mask = NSEventMask::TabletPoint | NSEventMask::TabletProximity;
    let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &monitor) };
    if monitor.is_none() {
        eprintln!("unable to install native Wacom tablet monitor");
        return;
    }

    // AppKit owns the monitor while the application is running. Keep the
    // returned removal token alive for the lifetime of this process.
    std::mem::forget(monitor);
}
