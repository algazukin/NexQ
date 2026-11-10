# Solve a task from your screen (Windows)

Screen tasks work with or without an active meeting. Select an image-capable model in **Settings > AI**, using **Custom** or an OpenAI-compatible provider. Other provider types currently show an unsupported-provider error.

For CLIProxyAPI, configure Custom with base URL `http://127.0.0.1:8317/v1`, Bearer authentication using an API key from your CLIProxyAPI configuration, and the model exposed by that proxy (for example, `gpt-6.1-sol` when available in `/v1/models`). Reasoning effort and priority/boost are controlled by the proxy configuration.

1. Press **Ctrl+Alt+S**, or click **Screen / Capture screen task** in the launcher or live overlay.
2. NexQ hides its windows and captures the display containing the foreground window. The model finds the main task or relevant code without manual selection and streams a concise answer. In compact mode, **More** gives one sentence with the idea, the requested C# method/class, and one line of complexity. It omits tutorial sections, boilerplate and usage examples unless required; essential concurrency/error-handling logic remains. Conceptual questions receive 2-4 direct sentences.
3. **Shift-click Screen** to select an area manually instead. Drag around the task; release to send it, or press **Esc** to cancel.
4. Press **Ctrl+Shift+Enter** or **Repeat last area** to capture the last manual area again. Without a manual area, this captures the active display. If the display layout changes, select the manual area again.

**Ctrl+B** reopens the screen answer while it remains in memory, including outside a meeting. The screen-task shortcuts are fixed and reserved; the other shortcuts remain configurable.

NexQ waits for its windows to be hidden before reading screen pixels. The automatic action sends the active display; manual selection sends only the selected crop. Screenshots stay in memory and are not saved to files or prompt logs. During a meeting, the last 60 seconds of transcript (at most 6,000 characters) and your configured instructions accompany the image. The active task also retains its starting transcript conditions from the configured Transcript Window (capped at five minutes and 6,000 characters), the current spoken follow-up (2,000 characters) and the preceding assistant answer (4,000 characters). These bounds apply per request; no additional model call is made.

This path uses one streamed model request, without OCR, RAG retrieval, web search, or an agent/tool loop. Any processing inside your configured HTTP proxy remains under that proxy's control. A new capture is refused while another answer is generating; stop that answer first.

Captured images are reduced to a maximum edge of 2,560 pixels and limited to 16 MiB of PNG data. Select a smaller area if a very detailed image exceeds that limit. The full desktop preview is local and does not use the provider-image limit. Windows desktops above 64 million pixels are rejected to bound memory use.

The last capture and thumbnail are held until replaced or NexQ exits. Answer text may be recorded through NexQ's existing meeting AI log, but screenshot bytes are excluded. Screen capture currently supports Windows; macOS needs a separate native capture implementation.

## Task detection and privacy

One vision request identifies the main task or relevant code, ignores interface chrome and unrelated text, then answers using the current short/detail C# profile. If several equally likely tasks are visible or the statement is unreadable, the answer asks for clarification.

Capture pixels remain in memory and are sent only through the existing configured vision provider; this does not add continuous screenshots or a separate OCR request.

**Ctrl+Alt+B** hides both NexQ windows in the tray without stopping the meeting; press again to restore. Use it before **Win+Shift+S** or another external capture. Exclusion of a visible window depends on that capture path, so the built-in Screen action hides NexQ itself. Tray hiding is blocked during a capture or manual selection.


## Code Review

Click **Code Review** beside **Screen** in the launcher, full overlay or compact hints. NexQ hides its windows, captures the active display and reviews the visible code in one vision request. It uses the same image-capable provider/model as screen tasks.

The default **hint** mode shows at most three important findings as copied source lines with short inline comments. It prioritizes correctness, boundaries, exceptions, concurrency/cancellation and meaningful performance problems; it does not rewrite the solution or report style-only nits. Editor line numbers are cited only when readable. If no clear issue is visible, it answers “Явных проблем не найдено”; unreadable or absent code prompts a request for a readable capture.

**Подробнее** in compact mode, or **Review подробнее** beside the review capture in full mode, expands the review using the **same image**. It explains causes, consequences and minimal corrected fragments. **Кратко** restores the short comments without another model request. A new **Code Review** click takes a new image. **Stop** cancels the review; stopping while the image is preparing prevents its later model submission.

Screenshots remain in memory, with the same image size limits and no OCR/RAG/classification request added. Comments appear in NexQ's answer; the source editor is not modified. Long inline comments wrap inside the review panel.

## Spoken follow-ups on a screen task

After **Screen**, **Подскажи** answers the latest spoken follow-up using the **last captured image**, the task conditions and the preceding proposed answer. It does not capture a new image: click **Screen** again if the editor or task changed. A repeated capture updates the image while retaining relevant conditions. The current image determines the actual code; suggested code from an earlier answer is not assumed to have been applied.

**Подробнее** expands the displayed answer using the same image and the speech snapshot from that answer; a question spoken afterwards does not change its target. While detailed code is open, automatic hints are paused so they cannot replace it. Press **Подскажи** to request a follow-up manually. In compact Solve mode, automatic spoken follow-ups can use the attached screenshot; Code Review remains manual.

If a refreshed capture request fails or is stopped and the old answer is restored, press **Screen** again before requesting another image-based hint. NexQ reports this explicitly rather than sending a text-only answer without the image.

**К вопросам** detaches the current image context and returns to ordinary spoken hints. Use it when moving to a different task. Starting a different meeting also clears task memory. The raw last capture remains available until replaced or the app exits; context is not a persistent conversation history. Irrelevant chatter should be ignored, but relevance is decided by the model and is not guaranteed.
