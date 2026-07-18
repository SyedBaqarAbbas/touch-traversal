# Hand tracking worker contract

THO-43 moves MediaPipe hand inference behind `apps/web/lib/hand.worker.ts`.

Local assets:

- Model: `/models/hand_landmarker/hand_landmarker.task`
- Model SHA-256: `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1`
- WASM runtime: `/vendor/mediapipe/tasks-vision/wasm`

Runtime policy:

- `getUserMedia` remains gated by the explicit camera-access action.
- Frames are attached to one local `<video>` and never uploaded. The element stays hidden in the
  demo and becomes the visible mirrored backdrop in `/perform`; both modes use the same stream and
  worker.
- The browser-side controller transfers resized `ImageBitmap` frames to the worker.
- Frame submission is throttled to a 15–30 FPS inference budget, currently targeting 24 FPS.
- Performance presentation reduces the existing worker-controller target to 20 FPS at medium
  quality and 15 FPS at low quality before core graph navigation is reduced.
- Worker failures post typed `ERROR` messages so the UI can preserve mouse and keyboard access.
- Responsiveness is summarized by `summarizeHandWorkerResponsiveness`: inference must stay inside 15–30 FPS and render cadence must stay at or above 45 FPS.
- Normalized landmark frames feed the guarded gesture controller. Cursor, select, traversal, return,
  and topology actions use the same scene interaction paths as mouse input; an empty-space pinch
  also drives guarded orbit, pan, depth zoom, and release through the shared view-control path.
- Background tabs do not submit new frames. Disabling, exiting, unmounting, a worker failure, or an
  ended camera track releases the owned tracks and worker; returning to graph-only presentation
  without disabling keeps that same stream alive.
