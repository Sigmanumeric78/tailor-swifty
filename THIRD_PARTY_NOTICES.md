# Third-party notices — camera measurement experiments

## Production interface dependency

| Component | Exact version | Licence | Upstream | Purpose |
|---|---:|---|---|---|
| three | 0.160.0 | MIT | https://github.com/mrdoob/three.js | Lazy-loaded Atelier landing sculpture and decorative tape renderer |

The Atelier torso, texture, tape geometry and poster were supplied as project assets. Their external source licence was not independently established by this integration; retain the original ownership and usage records. They are decorative interface assets and are not customer measurement inputs.

## Server processor production dependencies

| Component | Exact version | Licence | Upstream | Purpose |
|---|---:|---|---|---|
| mediapipe | 0.10.21 | Apache-2.0 | https://github.com/google-ai-edge/mediapipe | Server Pose Landmarker and primary segmentation |
| numpy | 1.26.4 | BSD-3-Clause | https://github.com/numpy/numpy | In-memory numeric image operations |
| opencv-python-headless | 4.10.0.84 | Apache-2.0 | https://github.com/opencv/opencv-python | In-memory decode, quality, morphology and contours |
| protobuf | 4.25.8 | BSD-3-Clause | https://github.com/protocolbuffers/protobuf | MediaPipe task data runtime |
| absl-py | 2.3.1 | Apache-2.0 | https://github.com/abseil/abseil-py | MediaPipe runtime support |
| attrs | 25.4.0 | MIT | https://github.com/python-attrs/attrs | MediaPipe task runtime support |
| flatbuffers | 25.9.23 | Apache-2.0 | https://github.com/google/flatbuffers | MediaPipe task model/runtime data |

## Browser-research dependencies

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
| MediaPipe Pose Landmarker Full float16 | Official Google `pose_landmarker_full/float16/1` | `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1` | Server production package and browser research, Apache-2.0 |
| BodyPix ResNet50 stride16 quant2 | Official TensorFlow.js BodyPix storage; package git `dd5f6ac96e71b7994647534975cbfb614097b8f3` | Aggregate `39c74c47e7212bc3cf82b512ccfd58cb6502d8d131b0280697879f8fb572a9e9`; per-file hashes in manifest | Browser research only, Apache-2.0 |
| MediaPipe Tasks Vision WASM | npm package 1.0.1 | Per-file hashes in manifest | Browser research runtime, Apache-2.0 |
| TensorFlow.js WASM backend | npm package 4.22.0 | Per-file hashes in manifest | Browser research fallback, Apache-2.0 |
| `u2net_human_seg.pth` | Official U-2-Net repository link | Unresolved—no authoritative published SHA-256 | Disabled research candidate |

The U-2-Net source repository declares Apache-2.0 for code, but the linked human-segmentation weight has no immutable version, authoritative checksum, or separately stated weight licence. It is not shipped or fetched. The benchmark adapter refuses to initialize without an explicitly supplied verified hash and official checkout. No third-party ONNX conversion is substituted.

The browser-research manifest, byte sizes, fixed source URLs and per-file hashes are in `frontend/public/models/camera-model-manifest.json`. The server model has a separate minimal manifest in `camera_processor/model-manifest.json`; the build verifies it before packaging.

No AprilTag/ArUco/ChArUco browser dependency, MediaPipe Image Segmenter model, Capacitor runtime, native depth SDK, EXIF package, size chart, or correction-model weight was added. Those boundaries use repository-owned adapters or a small local metadata parser and remain unavailable where an established exact-version dependency/asset, commercial licence, immutable checksum, and platform validation have not all been established.
