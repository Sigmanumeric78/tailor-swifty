# Server camera processing without runtime image storage

Status: experimental and unvalidated. Pipeline `server-camera-0.1.0`; token schema `1`; measurement definition `shirt-camera-geometry-1`.

## Request lifecycle

Production builds use `VITE_CAMERA_PROCESSING_MODE=server`. Participant creation returns a 30-minute participant access token bound to the participant UUID. Consent creation, camera-session issuance, measurement operations, and recommendation operations require that token in the `Authorization` header; a UUID alone grants no access. The token stays only in React memory, is never logged or stored, and a page refresh intentionally restarts the anonymous fitting session. The existing FastAPI Lambda issues a five-minute processing-session token only after participant-token authorization plus active recommendation consent and separately versioned `server-camera-consent-1` consent. It signs a random nonce, expiry, pipeline/schema versions, token type and a nominal allowance of six views. The camera-session token contains no participant identifier.

The browser decodes a camera frame or selected JPEG, PNG, or WebP with browser orientation handling, scales the longest edge to 1280 pixels, and always canvas-encodes the transmitted image as JPEG at successively lower quality if needed. It accepts at most 2,500,000 compressed bytes. Canvas encoding removes EXIF and other source metadata. The complete JSON request is capped at 4,500,000 bytes. Only bounded numeric capture metadata can accompany it. The prepared size is shown before transmission. HEIC/HEIF is not claimed as supported; users must convert it to JPEG, PNG, or WebP.

Each `/analyze` request contains exactly one photograph. The processor validates content type, JSON size, token, field allowlist, view, height, candidate number, MIME type, base64 size, encoded image length and dimensions before model inference. JPEG/WebP dimensions are parsed before OpenCV decode; the hard limits are six megapixels and a 1600-pixel longest edge. A malformed image, decompression-bomb dimension, unsupported format, or oversized payload produces a structured rejection without echoing input.

The processor performs in-memory OpenCV ROI quality checks and MediaPipe Pose Landmarker IMAGE-mode pose/segmentation. The component connected or close to shoulder/hip anchors supplies the primary silhouette. It validates one person, usable head/shoulder/hip anchors, full head-and-feet silhouette framing, severe image-quality blockers and front/profile orientation. Knees are not a universal gate: low knee visibility is advisory when the silhouette endpoints, torso anchors, orientation, and calibration remain safe. Verified height provides weak-perspective scale:

`mm_per_pixel = verified_height_mm / cleaned_silhouette_height_pixels`

The response contains one correction or a signed observation with only compact calibrated widths/lengths, quality, warning codes, candidate index and versions. It contains no pixels, mask, contour, complete landmarks, filename, EXIF or device label. The browser releases the source bitmap, canvas, blob and base64 references after success, rejection, timeout, abort or unmount. Browser and Lambda runtimes cannot promise forensic secure erasure, but the application creates no persistence path.

Only after the front request has returned and its raw-image references have been released does the UI request a side image. `/finalize` verifies one to three unique, matched front/side observations, their HMAC, type, expiry, pipeline version, view and session nonce. It uses medians and MAD-derived uncertainty. A single pair carries `REPEATABILITY_NOT_ASSESSED` and cannot be high quality. Shoulder width is withheld if both shoulders are unusable; sleeve length is withheld unless either complete shoulder–elbow–wrist chain is usable. Those partial failures do not discard valid torso fields. Neck circumference is always null with `NECK_ESTIMATOR_UNVALIDATED`, and shirt length remains null; both require manual entry. Every estimate requires manual confirmation.

The processor session is intentionally not created while the camera is merely opening. The browser records durable image-processing consent, waits for a decoded first camera frame, and creates the five-minute session immediately before the first analyze request. With no accepted observations, a session with less than 90 seconds remaining is replaced, and one `TOKEN_EXPIRED` response permits exactly one replacement and one retry. Once any observation exists, expiry clears the entire matched pair and offers **Restart capture session**; it never combines an old observation with a new session or asks the user to repeat still-active legal consent. Actual consent failures return to `/consent` with an allowlisted same-origin return path. Expired participant access restarts the anonymous in-memory fitting identity instead of being confused with processor-session expiry.

## Integrity and isolation

Participant, session, and observation tokens use canonical JSON plus standard-library HMAC-SHA256. Signature checks use `hmac.compare_digest`. Their distinct purposes are `PARTICIPANT_ACCESS`, `CAMERA_SESSION`, `FRONT_OBSERVATION`, and `SIDE_OBSERVATION`; wrong-purpose and cross-session substitutions are rejected. Participant lifetime is 1,800 seconds, camera-session lifetime is 300 seconds, and observations are bounded to approximately 600 seconds. A dedicated SecureString, named through `CAMERA_PROCESSING_SIGNING_PARAMETER_NAME`, is required and must never be the database password. Tokens stay in React memory and are never placed in URLs, logs, browser storage or Neon.

`CameraProcessorFunction` is a separate Python 3.12 x86-64 Lambda with 2048 MB memory, a 60-second timeout and 512 MB ephemeral allocation. `ProcessorReservedConcurrency` defaults to `0`, which omits the Lambda reservation rather than disabling the function; constrained preview accounts can therefore deploy while retaining their required unreserved pool. Production should set it to `2` only after the regional concurrency quota has been increased enough to preserve AWS's required unreserved capacity. It writes no image to `/tmp`. Its role has only normal Lambda logging and `ssm:GetParameter` for the dedicated signing secret. The template declares no S3, SQS, DynamoDB or EFS resource and grants no runtime access to those services. Lambda Function URL CORS responses allow only the explicit configured origins. A missing origin is still authenticated by the processing token; an unrelated browser origin is rejected.

The processor package contains the official Pose Landmarker Full float16 v1 model. The build downloads it—not an invocation—and verifies byte length 9,398,198 and SHA-256 `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1`. Model objects are initialized at module scope and reused in warm environments. The current extracted build reports 237,212,384 bytes, below the 262,144,000-byte Lambda quota; its conventional ZIP remains approximately 85 MB. The ZIP therefore requires normal SAM-managed deployment packaging rather than Lambda's 50 MB direct-upload path. This is deployment artifact transport, not processor runtime storage; no new runtime bucket or permission is declared.

## Frontend modes and cleanup

The Vite alias selects only the server pages in production. A post-build audit fails if output contains browser model files or references to the pose task, MediaPipe WASM, TensorFlow WASM, BodyPix weights or browser OpenCV package. `browser-research` remains an explicit local mode and retains its integrity-verified on-device pipeline. Server mode performs no continuous browser pose inference.

Live capture uses a fixed non-AI body guide and a server-specific startup ladder: prefer 1280×720 with the requested exact front/rear facing mode, then ideal facing mode, then a facing-only request, and finally browser-selected video. After permission, the page enumerates cameras, shows privacy-safe display names, and can reopen a selected physical device through an exact in-memory `deviceId`. Raw IDs are never shown, logged, or persisted. Switching stops the old tracks first and repeats the complete readiness sequence. A camera change after acceptance invalidates both observations so scales from different lenses cannot be combined.

Stream acquisition alone is not readiness. The hook attaches the stream to the actual video element, awaits `play()`, nonzero decoded metadata, then one presented frame via `requestVideoFrameCallback`; older browsers use a bounded ready-state/current-time/animation-frame fallback. The whole attempt is limited to about ten seconds and guarded by a generation ID so a stale promise cannot replace a newer camera. Retry, switch, cancel, navigation, unmount, and StrictMode cleanup cancel listeners, timers and frame callbacks and stop every track. The active server flow has no pose countdown: its visible manual capture button enables only after a real frame and sends immediately when pressed.

The full source-aspect frame uses the same preparation/client path as import. Requests use `AbortController`, a 60-second timeout, no automatic retry after ambiguous failure, and a process-wide maximum concurrency of two. Tracks stop on cancellation, completion and unmount. Photo inputs reset immediately; selected files are not retained in FlowContext. Only signed observations and reviewed numeric results live in React state. Local development diagnostics use `performance.now()` for permission/request, stream acquisition, metadata, first frame, image preparation, upload/response, render, and total capture stages. Processor responses report cold initialization when applicable plus decode, pose/segmentation, geometry, and total durations; no image, identity, token, filename, landmark, or measurement value is logged.

The consent copy states: “Front and side photographs are transmitted securely to an AWS processing function, held only in volatile processing memory, and discarded when each request completes. Tailor Swifty stores only reviewed numeric measurements and processing provenance. Photographs are not retained or used for model training without separate consent.” Failure requires resubmission because the application does not retain the image. Model-training consent remains separate and is not implemented or inferred.

## Dependencies and packaging

The processor uses exact versions: MediaPipe `0.10.21` (Apache-2.0), NumPy `1.26.4` (BSD-3-Clause), OpenCV headless `4.10.0.84` (Apache-2.0), protobuf `4.25.8` (BSD-3-Clause), absl-py `2.3.1` (Apache-2.0), attrs `25.4.0` (MIT), and flatbuffers `25.9.23` (Apache-2.0). They are installed without unneeded optional visualization dependencies inside the official SAM Python 3.12 build image. Pruning affects only generated artifacts: caches, tests, bundled unrelated MediaPipe solution models, and unneeded symbols. Runtime licences/metadata remain. Native imports and Pose Landmarker initialization are exercised inside the Lambda base image.

BodyPix, TensorFlow.js, U2Net and browser WASM are not part of the processor. No model is built from scratch. The package does not download anything during an invocation.

## Cost and abuse boundary

Invalid authentication, schema, MIME and size requests fail before model invocation. Where the regional quota permits it, reserved concurrency provides a coarse capacity cap and Lambda returns throttling responses when it is exhausted. Preview deployments using `ProcessorReservedConcurrency=0` have no per-function concurrency reservation and rely on the account-level Lambda quota; this is a known cost-control limitation. A public Function URL does not provide a product-grade per-user quota. Before unrestricted scale, use a separately reviewed API Gateway/WAF or challenge/rate-control design. Those paid controls are deliberately not created here. The stateless token embeds an allowed-view count but cannot enforce a global consumption counter without introducing state; callers are restricted to candidate indexes zero through two per request.

## Validation evidence and remaining work

The exact artifact imports MediaPipe, OpenCV and NumPy and creates the Pose Landmarker in the Lambda Python 3.12 image. Processor tests cover tokens, tampering/expiry/session/view binding, one-image request validation, oversize/format errors, header decompression limits, compact geometry, missing views, person/view gates, component selection and singleton initialization. Synthetic masks and mocked landmarks validate deterministic behavior but do not establish real-world accuracy.

Local Docker measured 267.010 ms model initialization and 39.493/31.247 ms for two warm 1280×960 synthetic no-person rejection paths. Accepted full-pipeline cold/warm latency, peak memory and memory-size comparisons at 1024/1769/2048/3008 MB remain blocked without an authorised full-body fixture and SAM/AWS benchmark run. These numbers must not be represented as AWS production latency.

Deployment prerequisites are a dedicated signing-key SecureString (at least 32 random bytes), explicit preview/production origins, both API and processor Function URLs in Amplify environment variables, and SAM-managed ZIP artifact packaging. Then test consent, rejection, one and three matched pairs, timeout/throttle behavior, CORS, log redaction, and cleanup in an isolated preview. No resources were created or modified by this implementation session.

Physical Android Chrome and iPhone Safari testing remains required. A licensed labelled tape-measurement pilot remains required before accuracy or uncertainty-coverage claims. Ordinary RGB silhouettes cannot recover anatomy under loose clothing and remain sensitive to perspective, camera tilt, lens distortion, posture, hair and segmentation boundaries. Circumferences use an ellipse approximation, not ground-truth anatomy.

## Physical-device checklist — NOT EXECUTED

Every item below requires a human using a real device; automated mocks do not satisfy it.

- NOT EXECUTED — Android Chrome: fresh rear-camera permission, decoded preview, manual front/side capture, and result/rejection.
- NOT EXECUTED — Android Chrome: already-granted permission, front camera, rear camera, camera switch, and old-track release.
- NOT EXECUTED — Android Chrome: denied permission, Retry camera, existing-photo fallback, and manual fallback.
- NOT EXECUTED — iPhone Safari: fresh rear-camera permission, portrait orientation, decoded first frame, and manual capture.
- NOT EXECUTED — iPhone Safari: already-granted permission, front/rear switch, background/foreground cycle, and resumed preview.
- NOT EXECUTED — iPhone Safari: denied permission, settings recovery, Retry camera, and photo fallback.
- NOT EXECUTED — Both platforms: slow network, request timeout, non-automatic retry behavior, and retained usable camera controls.
- NOT EXECUTED — Both platforms: processor-session expiry before capture and one bounded automatic replacement.
- NOT EXECUTED — Both platforms: session expiry after a front observation, pair clearing, and explicit restart.
- NOT EXECUTED — Both platforms: JPEG, PNG, and WebP existing-photo upload with one front and one profile image sent separately.
- NOT EXECUTED — Both platforms: cancel, route change, unmount, object/reference cleanup, and browser network/storage inspection.
