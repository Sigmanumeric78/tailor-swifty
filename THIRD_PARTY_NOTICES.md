# Third-party notices — camera measurement experiment

| Component | Exact version | Licence | Upstream | Purpose |
|---|---:|---|---|---|
| react-webcam | 7.2.0 | MIT | https://github.com/mozmorris/react-webcam | Phone camera React integration |
| xstate | 5.32.6 | MIT | https://github.com/statelyai/xstate | Deterministic capture state machine |
| @xstate/react | 6.1.0 | MIT | https://github.com/statelyai/xstate | React state-machine binding |
| @mediapipe/tasks-vision | 1.0.1 | Apache-2.0 | https://github.com/google-ai-edge/mediapipe | Pose, visibility and initial mask runtime |
| @tensorflow-models/body-segmentation | 1.0.2 | Apache-2.0 | https://github.com/tensorflow/tfjs-models | BodyPix segmentation API |
| @tensorflow/tfjs-core | 4.22.0 | Apache-2.0 | https://github.com/tensorflow/tfjs | Tensor runtime |
| @tensorflow/tfjs-converter | 4.22.0 | Apache-2.0 | https://github.com/tensorflow/tfjs | Graph-model loading |
| @tensorflow/tfjs-backend-webgl | 4.22.0 | Apache-2.0 | https://github.com/tensorflow/tfjs | Preferred browser backend |
| @tensorflow/tfjs-backend-wasm | 4.22.0 | Apache-2.0 | https://github.com/tensorflow/tfjs | Same-origin browser fallback |
| @techstark/opencv-js | 5.0.0-release.1 | Apache-2.0 | https://github.com/TechStark/opencv-js | OpenCV.js npm packaging for quality and contours |

Research-only Python dependencies are pinned in `requirements.lock.txt`: numpy 2.5.3 (BSD-3-Clause), opencv-python-headless 5.0.0.93 (Apache-2.0), Pillow 12.3.0 (HPND), psutil 7.2.2 (BSD-3-Clause), torch 2.14.0 (BSD-3-Clause), and torchvision 0.29.0 (BSD-3-Clause). Their upstream projects are NumPy, OpenCV, python-pillow/Pillow, giampaolo/psutil, and pytorch/pytorch/vision respectively. They are isolated from FastAPI/Lambda and support offline preprocessing, inference and performance measurement.

## Model and runtime assets

| Asset | Source/version | SHA-256 | Status |
|---|---|---|---|
| MediaPipe Pose Landmarker Full float16 | Official Google `pose_landmarker_full/float16/1` | `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` | Production, Apache-2.0 |
| BodyPix ResNet50 stride16 quant2 | Official TensorFlow.js BodyPix storage; package git `dd5f6ac96e71b7994647534975cbfb614097b8f3` | Aggregate `39c74c47e7212bc3cf82b512ccfd58cb6502d8d131b0280697879f8fb572a9e9`; per-file hashes in manifest | Production, Apache-2.0 |
| MediaPipe Tasks Vision WASM | npm package 1.0.1 | Per-file hashes in manifest | Production runtime, Apache-2.0 |
| TensorFlow.js WASM backend | npm package 4.22.0 | Per-file hashes in manifest | Production fallback, Apache-2.0 |
| `u2net_human_seg.pth` | Official U-2-Net repository link | Unresolved—no authoritative published SHA-256 | Disabled research candidate |

The U-2-Net source repository declares Apache-2.0 for code, but the linked human-segmentation weight has no immutable version, authoritative checksum, or separately stated weight licence. It is not shipped or fetched. The benchmark adapter refuses to initialize without an explicitly supplied verified hash and official checkout. No third-party ONNX conversion is substituted.

The complete manifest, byte sizes, fixed source URLs and every production per-file hash are in `frontend/public/models/camera-model-manifest.json`.

No AprilTag/ArUco/ChArUco browser dependency, MediaPipe Image Segmenter model, Capacitor runtime, native depth SDK, EXIF package, size chart, or correction-model weight was added. Those boundaries use repository-owned adapters or a small local metadata parser and remain unavailable where an established exact-version dependency/asset, commercial licence, immutable checksum, and platform validation have not all been established.
