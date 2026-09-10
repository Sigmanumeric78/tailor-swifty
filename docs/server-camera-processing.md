# Server camera processing without runtime image storage

Status: experimental and unvalidated. Pipeline `server-camera-0.1.0`; token schema `1`; measurement definition `shirt-camera-geometry-1`.

## Request lifecycle

Production builds use `VITE_CAMERA_PROCESSING_MODE=server`. Participant creation returns a 30-minute participant access token bound to the participant UUID. Consent creation, camera-session issuance, measurement operations, and recommendation operations require that token in the `Authorization` header; a UUID alone grants no access. The token stays only in React memory, is never logged or stored, and a page refresh intentionally restarts the anonymous fitting session. The existing FastAPI Lambda issues a five-minute processing-session token only after participant-token authorization plus active recommendation consent and separately versioned `server-camera-consent-1` consent. It signs a random nonce, expiry, pipeline/schema versions, token type and a nominal allowance of six views. The camera-session token contains no participant identifier.

The browser decodes a camera frame or selected JPEG/WebP with browser orientation handling, scales the longest edge to 1280 pixels, canvas-encodes at successively lower quality if needed, and accepts at most 2,500,000 compressed bytes. Canvas encoding removes EXIF and other source metadata. The complete JSON request is capped at 4,500,000 bytes. Only bounded numeric capture metadata can accompany it. The prepared size is shown before transmission.

Each `/analyze` request contains exactly one photograph. The processor validates content type, JSON size, token, field allowlist, view, height, candidate number, MIME type, base64 size, encoded image length and dimensions before model inference. JPEG/WebP dimensions are parsed before OpenCV decode; the hard limits are six megapixels and a 1600-pixel longest edge. A malformed image, decompression-bomb dimension, unsupported format, or oversized payload produces a structured rejection without echoing input.

The processor performs in-memory OpenCV ROI quality checks and MediaPipe Pose Landmarker IMAGE-mode pose/segmentation. The component connected or close to shoulder/hip anchors supplies the primary silhouette. It validates one person, stable view-specific core landmarks, full-body framing, severe image-quality blockers and front/profile orientation. Verified height provides weak-perspective scale:

`mm_per_pixel = verified_height_mm / cleaned_silhouette_height_pixels`

The response contains one correction or a signed observation with only compact calibrated widths/lengths, quality, warning codes, candidate index and versions. It contains no pixels, mask, contour, complete landmarks, filename, EXIF or device label. The browser releases the source bitmap, canvas, blob and base64 references after success, rejection, timeout, abort or unmount. Browser and Lambda runtimes cannot promise forensic secure erasure, but the application creates no persistence path.

Only after the front request has returned and its raw-image references have been released does the UI request a side image. `/finalize` verifies one to three unique, matched front/side observations, their HMAC, type, expiry, pipeline version, view and session nonce. It uses medians and MAD-derived uncertainty. A single pair carries `REPEATABILITY_NOT_ASSESSED` and cannot be high quality. Shirt length stays null and manual. Every estimate requires manual confirmation.

## Integrity and isolation

Participant, session, and observation tokens use canonical JSON plus standard-library HMAC-SHA256. Signature checks use `hmac.compare_digest`. Their distinct purposes are `PARTICIPANT_ACCESS`, `CAMERA_SESSION`, `FRONT_OBSERVATION`, and `SIDE_OBSERVATION`; wrong-purpose and cross-session substitutions are rejected. Participant lifetime is 1,800 seconds, camera-session lifetime is 300 seconds, and observations are bounded to approximately 600 seconds. A dedicated SecureString, named through `CAMERA_PROCESSING_SIGNING_PARAMETER_NAME`, is required and must never be the database password. Tokens stay in React memory and are never placed in URLs, logs, browser storage or Neon.

`CameraProcessorFunction` is a separate Python 3.12 x86-64 Lambda with 2048 MB memory, 60-second timeout, 512 MB ephemeral allocation and reserved concurrency 2. It writes no image to `/tmp`. Its role has only normal Lambda logging and `ssm:GetParameter` for the dedicated signing secret. The template declares no S3, SQS, DynamoDB or EFS resource and grants no runtime access to those services. Lambda Function URL CORS responses allow only the explicit configured origins. A missing origin is still authenticated by the processing token; an unrelated browser origin is rejected.

The processor package contains the official Pose Landmarker Full float16 v1 model. The build downloads it—not an invocation—and verifies byte length 9,398,198 and SHA-256 `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1`. Model objects are initialized at module scope and reused in warm environments. The extracted build is 237,210,838 bytes, below the 262,144,000-byte Lambda quota; its conventional ZIP is approximately 85,029,360 bytes. The ZIP therefore requires normal SAM-managed deployment packaging rather than Lambda's 50 MB direct-upload path. This is deployment artifact transport, not processor runtime storage; no new runtime bucket or permission is declared.

## Frontend modes and cleanup

The Vite alias selects only the server pages in production. A post-build audit fails if output contains browser model files or references to the pose task, MediaPipe WASM, TensorFlow WASM, BodyPix weights or browser OpenCV package. `browser-research` remains an explicit local mode and retains its integrity-verified on-device pipeline. Server mode performs no continuous browser pose inference.

Live capture uses a fixed non-AI body guide and the existing camera fallback ladder. It sends a full source-aspect frame through the same preparation/client path as import. Requests use `AbortController`, a 60-second timeout, no automatic retry after ambiguous failure, and a process-wide maximum concurrency of two. Tracks stop on cancellation, completion and unmount. Photo inputs reset immediately; selected files are not retained in FlowContext. Only signed observations and reviewed numeric results live in React state.

The consent copy states: “Front and side photographs are transmitted securely to an AWS processing function, held only in volatile processing memory, and discarded when each request completes. Tailor Swifty stores only reviewed numeric measurements and processing provenance. Photographs are not retained or used for model training without separate consent.” Failure requires resubmission because the application does not retain the image. Model-training consent remains separate and is not implemented or inferred.

## Dependencies and packaging

The processor uses exact versions: MediaPipe `0.10.21` (Apache-2.0), NumPy `1.26.4` (BSD-3-Clause), OpenCV headless `4.10.0.84` (Apache-2.0), protobuf `4.25.8` (BSD-3-Clause), absl-py `2.3.1` (Apache-2.0), attrs `25.4.0` (MIT), and flatbuffers `25.9.23` (Apache-2.0). They are installed without unneeded optional visualization dependencies inside the official SAM Python 3.12 build image. Pruning affects only generated artifacts: caches, tests, bundled unrelated MediaPipe solution models, and unneeded symbols. Runtime licences/metadata remain. Native imports and Pose Landmarker initialization are exercised inside the Lambda base image.

BodyPix, TensorFlow.js, U2Net and browser WASM are not part of the processor. No model is built from scratch. The package does not download anything during an invocation.

## Cost and abuse boundary

Invalid authentication, schema, MIME and size requests fail before model invocation. Reserved concurrency provides a coarse capacity cap; Lambda returns throttling responses when it is exhausted. A public Function URL does not provide a product-grade per-user quota. Before unrestricted scale, use a separately reviewed API Gateway/WAF or challenge/rate-control design. Those paid controls are deliberately not created here. The stateless token embeds an allowed-view count but cannot enforce a global consumption counter without introducing state; callers are restricted to candidate indexes zero through two per request, and concurrency is bounded.

## Validation evidence and remaining work

The exact artifact imports MediaPipe, OpenCV and NumPy and creates the Pose Landmarker in the Lambda Python 3.12 image. Processor tests cover tokens, tampering/expiry/session/view binding, one-image request validation, oversize/format errors, header decompression limits, compact geometry, missing views, person/view gates, component selection and singleton initialization. Synthetic masks and mocked landmarks validate deterministic behavior but do not establish real-world accuracy.

Local Docker measured 267.010 ms model initialization and 39.493/31.247 ms for two warm 1280×960 synthetic no-person rejection paths. Accepted full-pipeline cold/warm latency, peak memory and memory-size comparisons at 1024/1769/2048/3008 MB remain blocked without an authorised full-body fixture and SAM/AWS benchmark run. These numbers must not be represented as AWS production latency.

Deployment prerequisites are a dedicated signing-key SecureString (at least 32 random bytes), explicit preview/production origins, both API and processor Function URLs in Amplify environment variables, and SAM-managed ZIP artifact packaging. Then test consent, rejection, one and three matched pairs, timeout/throttle behavior, CORS, log redaction, and cleanup in an isolated preview. No resources were created or modified by this implementation session.

Physical Android Chrome and iPhone Safari testing remains required. A licensed labelled tape-measurement pilot remains required before accuracy or uncertainty-coverage claims. Ordinary RGB silhouettes cannot recover anatomy under loose clothing and remain sensitive to perspective, camera tilt, lens distortion, posture, hair and segmentation boundaries. Circumferences use an ellipse approximation, not ground-truth anatomy.
