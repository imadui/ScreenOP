# Third-party notices

OneLoom bundles or builds on the following open-source components.

| Component | Use | License |
| --- | --- | --- |
| [Electron](https://www.electronjs.org/) (Chromium, Node.js) | Application runtime | MIT (Chromium: BSD-style and others, see `LICENSES.chromium.html` in the packaged app) |
| [React](https://react.dev/) | User interface | MIT |
| [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) (`@mediapipe/tasks-vision`, WebAssembly runtime copied to `resources/mediapipe/`) | Camera background segmentation | Apache License 2.0 |
| MediaPipe **Selfie Segmenter** model (`resources/mediapipe/selfie_segmenter.tflite`) | Camera background segmentation | Apache License 2.0 — © Google LLC |
| Build/test tooling (Vite, electron-vite, electron-builder, TypeScript, Vitest, Playwright) | Development only, not shipped | MIT / Apache-2.0 |

The Apache License 2.0 text is available at <https://www.apache.org/licenses/LICENSE-2.0>.
The selfie segmentation model is distributed unmodified, as published at
`https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`.
