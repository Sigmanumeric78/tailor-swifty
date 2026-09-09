# Experimental camera measurement pipeline

Pipeline version: `camera-measurement-0.2.1`.

## Architecture and data flow

The `/measurements/camera` and `/measurements/photos` routes are lazy-loaded. Nothing requests camera permission or imports the vision runtimes merely by opening either route. Live-camera permission is requested only after **Start camera scan**; photo models initialize only after **Process photos locally**. React Webcam owns the live video element, `useCameraStream` tracks and stops every stream track, and all image processing occurs in browser memory. Preview frames are reduced to at most 640 px for gates. Accepted captures use source resolution, exist as `ImageBitmap` objects only, and are closed on completion, cancellation, error, or unmount.

```text
phone camera -> reduced preview -> MediaPipe hard gates + native advisory checks
             -> 8-frame front burst -> best 3 separated frames
             -> 8-frame side burst  -> best 3 separated frames
             -> accepted views -> lazy OpenCV + BodyPix initialization
             -> torso-connected MediaPipe mask -> geometry
             -> independent BodyPix mask -> agreement evidence
             -> independent height calibration -> geometry x 3
             -> robust aggregation + pipeline quality -> FlowContext
             -> existing manual form review -> backward-compatible backend submission
```

No raw image, selected `File`, base64 frame, face, mask, landmark, contour, EXIF blob, or biometric pixel is sent to FastAPI, Lambda, Neon, analytics, storage APIs, or logs. Only reviewed numeric estimates and non-identifying provenance enter `FlowContext`. The session contract has additive optional provenance fields (input mode, capture source, calibration mode, pipeline/model versions, reason codes, a normalized capability summary, and manual-review status); legacy requests receive safe defaults.

## State machine

| State | Entry condition | Main exits |
|---|---|---|
| `idle` | Route loaded | `START` -> permission |
| `requestingPermission` | Explicit user action | granted / denied |
| `loadingModels` | Camera granted | ready / model failure |
| `heightEntry` | Models ready | valid integer 1000–2500 mm |
| `front.instructions/aligning/ready/countdown/capturingBurst/review` | Height accepted | manual shutter or optional auto-capture; accept/retake frozen preview |
| `side.instructions/aligning/ready/countdown/capturingBurst/review` | Front accepted | manual shutter or optional auto-capture; accept/retake frozen preview |
| `processing` | Both views accepted | results / low confidence / fatal error |
| `lowConfidence` | Score below 0.55 | targeted front or side retry / manual fallback |
| `results` | Sufficient estimates | explicit manual-form review |
| `cancelled` | cancel/manual fallback | cleanup / restart |

Manual capture is the default. **Capture front now** and **Capture side now** become available when MediaPipe, a non-zero video frame, exactly one substantially framed person, and no catastrophic blocker are present. Advisory warnings do not disable the shutter. Manual capture skips the wait, but never skips full-resolution post-capture person, framing, orientation, silhouette, ROI image-quality, and burst validation. Auto-capture is optional. Readiness uses the latest two-second window, at least five samples, and an essential-gate pass ratio of at least 80%. The accepted alignment evidence is frozen on countdown entry. Its monotonic three-second deadline belongs to XState and is not recreated by React renders. Previously, a React timeout effect depended on the changing XState snapshot; 250 ms quality updates repeatedly cleaned up and recreated that timeout, so capture could be postponed forever. Advisory warnings and one or two transient hard failures never reset the deadline; three consecutive hard-blocker samples return to alignment. `COUNTDOWN_COMPLETE` remains for deterministic tests. Side capture cannot precede accepted front repetitions.

The preview analysis loop keeps changing callback props in a ref. Callback identity no longer tears down its 250 ms interval; only the registry, active view, selected device, or video ref can recreate it. A new view or device resets pose history and stability. Missing or multiple people and analysis exceptions clear history; exceptions emit a hard `MODEL_UNAVAILABLE` result rather than leaving stale passing state. Once alignment reports stability it does not repeatedly send `POSE_STABLE` after the machine leaves alignment. The XState machine is hardware-free and unit tested, including fake-time countdown coverage.

Live hard failures are limited to no person, multiple people, missing segmentation, missing head or feet, wrong view orientation, essential current-view landmark loss, and severe truncation. Moderate blur, lighting, contrast, centring, motion, arms near the torso, and nonessential landmark uncertainty are advisory. The UI displays one actionable instruction and keeps the remaining diagnostics in an expandable section; advisory warnings do not hide the manual shutter.

## Existing-photo workflow

`/measurements/photos` accepts one to three directly front-facing photos and the same number of true left/right profile photos. Each matched pair is independently validated; rejected pairs never contribute measurements, while remaining valid pairs can continue. Three independent pairs are recommended. One valid pair is allowed only as a rough prefill: no frames are duplicated, repeat consistency contributes zero, `REPEATABILITY_NOT_ASSESSED` is emitted, and the result cannot enter the high quality band solely from other components. Arbitrary diagonal and 360-degree angles are unsupported by the current geometry.

Accepted types are JPEG, PNG, and WebP. HEIC/HEIF receives conversion guidance. Encoded files are limited to 15 MB, decoded images to 24 megapixels, and the processed longest dimension to 2048 pixels with aspect ratio preserved. `createImageBitmap(file, { imageOrientation: 'from-image' })` applies encoded orientation where supported. A bounded local JPEG EXIF parser can read orientation, dimensions, capture timestamp, focal length, 35-mm-equivalent focal length, and digital zoom. These optional values are diagnostic only, may be stale after editing/cropping, and never provide scale without object distance. Missing, stripped, malformed, or inconsistent EXIF does not block processing. Empty, corrupt, zero-dimension, oversized, unmatched, and privacy-safe metadata duplicates are rejected. File inputs reset after every selection.

Each still runs OpenCV person-ROI sharpness, exposure, contrast, and clipping checks plus MediaPipe person-count, framing, required-landmark, and view-orientation gates. Motion and stability gates do not apply to still photos. MediaPipe runs in `IMAGE` mode for stills and `VIDEO` mode for live frames; mode changes and inference calls are serialized so a live preview cannot race an accepted still-image analysis. Rejected images produce one dominant view-specific instruction without copying filenames into error objects, retain diagnostic reason codes, and never contribute measurements.

Selected files and decoded bitmaps stay in component-local memory. No thumbnails or persistent object URLs are created. Original decoded bitmaps close after normalization; normalized bitmaps close on removal, successful processing, cancellation, navigation, unmount, or when a failed operation no longer needs them. Canvases are cleared. Model and OpenCV resources follow the same lifecycle. The application releases browser references to decoded images, but browser memory cannot provide forensic secure erasure. The original gallery files remain on the user’s device.

## Locked dependencies and models

Production packages are exactly pinned in `frontend/package.json`: react-webcam 7.2.0, XState 5.32.6, @xstate/react 6.1.0, MediaPipe Tasks Vision 1.0.1, Body Segmentation 1.0.2, TensorFlow.js core/converter/WebGL/WASM 4.22.0, and TechStark OpenCV.js 5.0.0-release.1.

The committed model manifest contains per-file sizes and SHA-256 values. Primary model identities are:

- MediaPipe Pose Landmarker full float16 v1: `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1`, 9,398,198 bytes, production.
- BodyPix ResNet50 stride 16 quant2: aggregate `39c74c47e7212bc3cf82b512ccfd58cb6502d8d131b0280697879f8fb572a9e9`, 47,993,528 bytes across model JSON and 12 shards, production.
- U2Net human segmentation: research-only and disabled. Its official repository link does not provide an immutable weight version, published SHA-256, or separate weight licence; no substitute is used.

MediaPipe and TensorFlow WASM runtime files are also versioned, hashed, and loaded from `/models`. Production never fetches model weights from a runtime CDN.

## Gates and provisional thresholds

All thresholds live in `scanConfig.js`, remain provisional, and require physical validation. Pose uses visibility >= 0.55 and presence >= 0.50, one usable person, complete head and feet, 1–4% safe margins, 65–92% body-height occupancy, correct front/side projection, and robust 75th-percentile normalized landmark motion <= 0.015 over a 12-frame/two-second live window. Front hard landmarks cover the best visible head landmark, both shoulders, both hips, and reliable bilateral lower-body endpoints; uncertain elbows and wrists are advisory because they are not needed for torso circumference capture. Profiles compare both sides, then require the best visible near-side head, shoulder, hip, knee, and lower-body endpoint; elbow/wrist uncertainty and the naturally occluded far-side chain are advisory. Orientation remains separate. Front torso bounds use min/max x across both shoulders and hips, so mirrored coordinates do not assume anatomical left is screen-left. Pose quality is calculated from current-view required-landmark visibility and presence.

The live preview uses lightweight canvas luminance and edge sampling inside an expanded MediaPipe person ROI, so it does not load OpenCV before capture. Whole-frame bounds remain responsible for crop/margin checks. Moderate values are advisory; catastrophic blur (<3 normalized preview units), luminance (<22 or >238), or extreme clipping can block capture. Post-capture OpenCV performs authoritative ROI variance-of-Laplacian, luminance, clipping, and contrast analysis. Motion combines robust visible-landmark displacement with ROI luminance stability; motion is omitted for still photos.

Masks are thresholded at 0.55 and morphologically closed with a kernel scaled to silhouette height (clamped to 3–15 px). Small enclosed holes are filled. Connected-component selection requires containment or proximity to both shoulder and both hip landmarks, so a larger disconnected chair, shadow, mirror subject, or furniture region is not selected merely because it has more pixels. A component touching a frame border is rejected when it indicates truncation.

The cleaned MediaPipe person component is the primary geometry mask. BodyPix is independent validation evidence only: it is never AND-intersected with the MediaPipe mask, because that erosion can systematically reduce body widths. Agreement retains whole-mask IoU, height, and torso-width differences. Boundary agreement is symmetric and distance-tolerant: boundary pixels match within 1.5% of silhouette height, clamped to 3–12 px. This prevents an ordinary two-to-three-pixel model translation from appearing as total boundary disagreement. Gross disagreement reduces live quality or gives retake guidance; imported-photo disagreement remains rejectable. BodyPix returns RGBA `ImageData`; conversion validates `width * height * 4` bytes and creates exactly one mask value per pixel from alpha, preventing background label colours from becoming foreground.

## Progressive model initialization

`CameraModelRegistry.initializeLive()` loads only MediaPipe Pose Landmarker. `initializeQuality()` loads OpenCV after a shutter request for authoritative captured-frame validation. After accepted front and side views, `initializeSegmentation()` attempts BodyPix immediately before measurement processing (and reuses OpenCV). `initialize()` loads all applicable stages for photo processing only after explicit user action. Promise deduplication reuses model instances across views and retakes. Generation guards reject initialization that finishes after disposal. A secondary BodyPix failure is disposed and becomes `SECONDARY_SEGMENTER_UNAVAILABLE`; the MediaPipe-primary geometry continues at reduced quality. Required MediaPipe or OpenCV failures still stop safely.

BodyPix imports and registers the WebGL backend and checks the boolean result of `tf.setBackend('webgl')`; a resolved `false` is treated as failure, not success. If WebGL throws or returns false, the pinned WASM backend is registered, configured with `/models/tensorflow/wasm/`, selected, awaited with `tf.ready()`, and verified with `tf.getBackend()`. Body-part-map decoding is enabled on WebGL. On WASM it is disabled because TensorFlow.js 4.22.0's WASM `BatchMatMul` does not support the int32 BodyPix body-part decoding operation; the same locked ResNet50 person silhouette still runs and provides the secondary mask required by this pipeline. If neither backend succeeds, processing reports `MODEL_BACKEND_UNAVAILABLE: webgl, wasm`. MediaPipe, OpenCV, and BodyPix initialization durations and bounded per-image inference timings remain in memory only and are never transmitted.

Camera acquisition uses a negotiable ladder: ideal rear-facing 1920×1080, ideal 1280×720, then browser-selected resolution, with no mandatory minimum dimensions. Once permission exposes device identifiers, an explicit selection uses the same ladder with an exact `deviceId`; that selection persists across front and side. A changed active device produces a retake warning rather than silently mixing lenses. The ephemeral capability summary includes only dimensions, rate/aspect ratio, facing/resize mode, zoom/focus ranges, current zoom, and torch availability—never labels, user agent, or guessed focal length. A supported 1.0 zoom ratio is requested, but is not treated as physical calibration. Optional device-orientation permission is requested only from its button and provides roll/pitch guidance; denial or absence never blocks capture. Frames retain aspect ratio and `playsInline` remains enabled.

OpenCV remains a large lazy chunk (approximately 15.5 MB minified in the current build). It is route and action deferred, but this release does not claim that chunk was optimized away.

## Calibration and measurement geometry

Front and side views are calibrated separately:

`mm_per_pixel = verified_height_mm / cleaned_silhouette_height_pixels`

Calibration uses a versioned provider boundary with `VERIFIED_HEIGHT`, `PHYSICAL_REFERENCE`, `NATIVE_INTRINSICS_DEPTH`, and `UNAVAILABLE` modes. Only verified-height weak-perspective calibration is operational; its calibration-quality contribution is provisionally reduced by 15% and carries `WEAK_PERSPECTIVE_CALIBRATION`. The physical-reference boundary and proposed 500 mm two-point vertical reference are documented in `docs/physical-reference-calibration.md`; marker detection is blocked pending an established browser detector with verified commercial licence, exact version, immutable WASM integrity, and physical fixture tests. Native intrinsics/depth are also unavailable in the web adapter, which returns null fields instead of guessing. No Capacitor runtime exists in this repository, so Android Camera2/ARCore and iOS AVFoundation/ARKit integrations remain `BLOCKED_UNVALIDATED` interfaces rather than uncompiled platform code.

The silhouette top and heel/foot-connected bottom define height—not the nose or forehead. Truncation, implausible aspect ratio, missing visible feet, and landmark/mask extent disagreement above the provisional 0.15 tolerance fail calibration. Scale uncertainty is:

`sqrt((height_input_uncertainty / height_mm)^2 + (boundary_uncertainty_px / silhouette_height_px)^2)`

Torso scanlines select the contiguous interval containing the landmark-derived torso centre and use nearby-row medians. Neck, chest, waist and hip bands are landmark-relative. Circumferences use Ramanujan’s ellipse approximation with front semi-axis `a = front_width/2`, side semi-axis `b = side_depth/2`, and `h = (a-b)^2/(a+b)^2`:

`C = pi(a+b)(1 + 3h/(10 + sqrt(4-3h)))`

Shoulder width is the front shoulder landmark distance checked in image coordinates. Sleeve length is shoulder-to-elbow plus elbow-to-wrist, never a chord. Armhole depth is explicitly estimated from shoulder to chest contour. Shirt length is not directly observable because it depends on preferred hem position; it remains null until manually entered.

## Repetition and pipeline quality

Each view captures at least 8 frames and selects the best 3 with >=150 ms temporal separation. Numeric estimates use the median; spread uses median absolute deviation and a configurable 3-MAD rule. Failed consistency requests another burst or manual fallback and never becomes zero.

The internal score is a non-redistributed weighted sum: capture 0.17, pose 0.17, segmentation 0.15, calibration 0.13, repeat consistency 0.17, observability 0.05, front/side scale agreement 0.08, camera metadata 0.03, and confirmed clothing fit 0.05. Capture uses selected-frame ROI scores; pose uses required-landmark evidence; every other component uses its measured output. Missing components score zero. Preserved warning codes apply a provisional penalty; silhouette disagreement additionally caps quality. An observable null measurement forces overall quality to zero. High is >=0.75; medium is 0.55–0.749 and requires explicit confirmation; low is <0.55 and requires retry or manual entry. Overall quality is the minimum required observable measurement score. This is a pipeline quality score, not a validated probability that a measurement is accurate.

## Running locally

```sh
cd frontend
npm ci
npm run models:fetch
npm run models:verify
npm run dev
```

Use HTTPS or localhost because browsers restrict camera APIs to secure contexts. Test with `npm test -- --run`; tests mock hardware and models.

## Segmentation benchmark

See `research/segmentation-benchmark/README.md`. The harness applies EXIF orientation, preserves aspect ratio, restores masks to original coordinates, uses 3 warmups and 10 measured runs, and writes JSON/CSV/Markdown. Without authorised images it exits 2 with `DATASET_REQUIRED`. Pairwise agreement is never described as accuracy. Labelled accuracy requires an appropriately licensed ground-truth dataset.

## Performance evidence

The audited pre-change build for this session produced an initial application chunk of 135.89 kB minified, a 74.47 kB camera-page chunk, a 9.55 kB photo-page chunk, and a lazy OpenCV chunk of 15,514.56 kB (3,906.10 kB gzip). The final build produced 135.89 kB (34.18 kB gzip), 80.39 kB (25.99 kB gzip), 13.12 kB (5.45 kB gzip), and 15,514.56 kB (3,906.10 kB gzip), respectively. The initial non-camera chunk remained unchanged; capability, readiness, provider, EXIF, and provenance code increased only lazy/feature chunks. Model/runtime bytes are recorded exactly in the manifest; browser-requested bytes depend on the runtime-selected MediaPipe and TensorFlow WASM variant, so they are not summed into a fictitious mobile transfer number. The registry records MediaPipe, OpenCV and BodyPix initialization, bounded per-image inference samples, first detection time, capture-processing time, and peak retained image count in memory only. It transmits none of them. No mobile initialization or inference timings are claimed without physical-device execution.

## Input modes and research boundaries

Session provenance distinguishes `MANUAL_MEASUREMENTS`, `CAMERA_MEASUREMENTS`, and the unavailable `HEIGHT_WEIGHT_SIZE_ESTIMATE`. The height/weight provider returns `UNAVAILABLE_NO_SIZE_CHART`; no universal chart, sex, gender, age, or garment-size rule is invented. A deterministic measurement-correction provider currently preserves estimates unchanged and records its version. Future correction inputs may include normalized front/side width profiles, pose ratios, verified height, optional self-reported weight, marker scale, tilt, segmentation disagreement, capability tier, and explicitly reported clothing fit. Outputs are corrected values plus calibrated per-measurement uncertainty. No trained weights exist.

`research/accuracy-pilot/` contains a machine-readable labelled-row schema, evaluation boundary, and validation-first robust-linear training skeleton. It requires pseudonymous participants, research-consent and licence metadata, professional ground truth, participant-grouped splits, and a device-held-out split. Without them both tools exit `DATASET_REQUIRED` and generate no simulated accuracy. Raw research images are excluded from the application and production database.

## Physical validation checklist (not executed)

- Recent Android Chrome, recent iPhone Safari, and desktop graceful fallback.
- Fixed rear camera while the person rotates; front-camera fallback; low-resolution camera.
- Permission allow, deny, settings recovery, and retry.
- Automatic countdown and manual **Capture now** for both views.
- One and three imported pairs; missing EXIF; WebGL-disabled WASM fallback.
- Bright/dark backgrounds, minor motion, ordinary/tight/loose clothing warnings.
- Retake, navigation, track stop, bitmap/mask/tensor/Mat cleanup, and browser network inspection proving no image request.

This checklist must be completed by a real person on real devices. Synthetic fixtures and a desktop browser are not physical-phone validation.

## Known limitations and manual confirmation

Camera and photo estimates are experimental, not clinically or commercially validated. Close-fitting clothing is required; ordinary RGB images cannot recover anatomy hidden by loose clothes. Known-height calibration inherits height-entry, camera perspective, lens distortion, posture, hair, clothing and silhouette-boundary uncertainty. The ellipse circumference model is an approximation, not ground-truth anatomy, and no unvalidated correction factors are applied. Device cameras vary, and ultrawide or digital zoom should be avoided. Every estimate requires review; medium quality requires explicit confirmation, low quality requires retry or manual measurement, and shirt length always requires manual completion because preferred hem position is not observable.

A physical phone smoke test is still required on recent Android Chrome and iPhone Safari devices, including front and rear cameras and permission retry behavior. A labelled pilot comparing estimates with professional tape measurements is also required before making accuracy claims.

Persistent captures, retained-image research, trained correction models, children/guardian workflows, native platform builds, immutable production caching configuration, and deployment remain future work. The additive provenance migration stores structured numeric/version metadata only; it never adds raw media storage.
