# Hand tracking worker contract

THO-43 moves MediaPipe hand inference behind `apps/web/lib/hand.worker.ts`.

Local assets:

- Model: `/models/hand_landmarker/hand_landmarker.task`
- Model SHA-256: `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`
- WASM runtime: `/vendor/mediapipe/tasks-vision/wasm`

Runtime policy:

- `getUserMedia` remains gated by the explicit camera-access action.
- Frames are attached to a hidden local `<video>` and never uploaded.
- The browser-side controller transfers resized `ImageBitmap` frames to the worker.
- Frame submission is throttled to a 15–30 FPS inference budget, currently targeting 24 FPS.
- Worker failures post typed `ERROR` messages so the UI can preserve mouse and keyboard access.
- Responsiveness is summarized by `summarizeHandWorkerResponsiveness`: inference must stay inside 15–30 FPS and render cadence must stay at or above 45 FPS.
- Normalized landmark frames feed the guarded gesture controller; cursor, select, traversal, return,
  and topology actions use the same scene interaction paths as mouse input.
