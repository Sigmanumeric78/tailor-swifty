# Experimental camera measurement pipeline

Pipeline version: `camera-measurement-0.2.0`.

## Architecture and data flow

The `/measurements/camera` and `/measurements/photos` routes are lazy-loaded. Nothing requests camera permission or imports the vision runtimes merely by opening either route. Live-camera permission is requested only after **Start camera scan**; photo models initialize only after **Process photos locally**. React Webcam owns the live video element, `useCameraStream` tracks and stops every stream track, and all image processing occurs in browser memory. Preview frames are reduced to at most 640 px for gates. Accepted captures use source resolution, exist as `ImageBitmap` objects only, and are closed on completion, cancellation, error, or unmount.

```text
phone camera -> reduced preview -> pose/framing + OpenCV quality gates
             -> 8-frame front burst -> best 3 separated frames
             -> 8-frame side burst  -> best 3 separated frames
             -> accepted views -> lazy BodyPix initialization
             -> MediaPipe/BodyPix masks -> cleanup + consensus
             -> independent height calibration -> geometry x 3
             -> robust aggregation + pipeline quality -> FlowContext
             -> existing manual form review -> unchanged backend submission
```

No raw image, selected `File`, base64 frame, face, mask, landmark, or biometric pixel is sent to FastAPI, Lambda, Neon, analytics, storage APIs, or logs. Only reviewed numeric estimates and numeric provenance enter `FlowContext`; only values the user reviews in the existing form can later follow the unchanged backend contract.

## State machine

| State | Entry condition | Main exits |
|---|---|---|
| `idle` | Route loaded | `START` -> permission |
| `requestingPermission` | Explicit user action | granted / denied |
| `loadingModels` | Camera granted | ready / model failure |
| `heightEntry` | Models ready | valid integer 1000–2500 mm |
| `front.instructions/alignment/countdown/capturingBurst/review` | Height accepted | accepted front only after 3 selected frames |
| `side.instructions/alignment/countdown/capturingBurst/review` | Front accepted | processing only after 3 selected side frames |
| `processing` | Both views accepted | results / low confidence / fatal error |
| `lowConfidence` | Score below 0.55 | targeted front or side retry / manual fallback |
| `results` | Sufficient estimates | explicit manual-form review |
| `cancelled` | cancel/manual fallback | cleanup / restart |

A failed mandatory gate during countdown returns to alignment. Side capture cannot precede front acceptance. The three-second delay belongs to each XState `countdown` state. Previously, a React timeout effect depended on the changing XState snapshot; 250 ms quality updates repeatedly cleaned up and recreated that timeout, so capture could be postponed forever. Passing quality events now update context without resetting the state-owned delay, while a failed event immediately returns to alignment. `COUNTDOWN_COMPLETE` remains available for deterministic tests.

The preview analysis loop keeps changing callback props in a ref. Callback identity no longer tears down its 250 ms interval; only the registry, active view, selected device, or video ref can recreate it. A new view or device resets pose history and stability. Missing or multiple people and analysis exceptions clear history; exceptions emit a failed `MODEL_UNAVAILABLE` result rather than leaving stale passing state. The XState machine is hardware-free and unit tested, including fake-time countdown coverage.

## Existing-photo workflow

`/measurements/photos` accepts one to three directly front-facing photos and the same number of true left/right profile photos. Three independent pairs are recommended. One pair is allowed only as a rough prefill: no frames are duplicated, repeat consistency contributes zero, `REPEATABILITY_NOT_ASSESSED` is emitted, and the result cannot enter the high quality band solely from other components. Arbitrary diagonal and 360-degree angles are unsupported by the current geometry.

Accepted types are JPEG, PNG, and WebP. HEIC/HEIF receives conversion guidance. Encoded files are limited to 15 MB, decoded images to 24 megapixels, and the processed longest dimension to 2048 pixels with aspect ratio preserved. `createImageBitmap(file, { imageOrientation: 'from-image' })` applies encoded orientation where supported. Empty, corrupt, zero-dimension, oversized, unmatched, and privacy-safe metadata duplicates are rejected. File inputs reset after every selection.

Each still runs OpenCV sharpness, exposure, contrast, and clipping checks plus MediaPipe person-count, framing, required-landmark, and view-orientation gates. Motion and stability gates do not apply to still photos. MediaPipe runs in `IMAGE` mode for stills and `VIDEO` mode for live frames; the service tracks its mode and avoids redundant `setOptions` calls. Rejected images produce a view-and-filename-specific error and never contribute measurements.

Selected files and decoded bitmaps stay in component-local memory. No thumbnails or persistent object URLs are created. Original decoded bitmaps close after normalization; normalized bitmaps close on removal, successful processing, cancellation, navigation, unmount, or when a failed operation no longer needs them. Canvases are cleared. Model and OpenCV resources follow the same lifecycle. The application releases browser references to decoded images, but browser memory cannot provide forensic secure erasure. The original gallery files remain on the user’s device.

## Locked dependencies and models

Production packages are exactly pinned in `frontend/package.json`: react-webcam 7.2.0, XState 5.32.6, @xstate/react 6.1.0, MediaPipe Tasks Vision 1.0.1, Body Segmentation 1.0.2, TensorFlow.js core/converter/WebGL/WASM 4.22.0, and TechStark OpenCV.js 5.0.0-release.1.

The committed model manifest contains per-file sizes and SHA-256 values. Primary model identities are:

- MediaPipe Pose Landmarker full float16 v1: `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1`, 9,398,198 bytes, production.
- BodyPix ResNet50 stride 16 quant2: aggregate `39c74c47e7212bc3cf82b512ccfd58cb6502d8d131b0280697879f8fb572a9e9`, 47,993,528 bytes across model JSON and 12 shards, production.
- U2Net human segmentation: research-only and disabled. Its official repository link does not provide an immutable weight version, published SHA-256, or separate weight licence; no substitute is used.

MediaPipe and TensorFlow WASM runtime files are also versioned, hashed, and loaded from `/models`. Production never fetches model weights from a runtime CDN.

## Gates and provisional thresholds

All thresholds live in `scanConfig.js`, remain provisional, and require physical validation. Pose uses visibility >= 0.55 and presence >= 0.50, one usable person, complete head and feet, 1–4% safe margins, 65–92% body-height occupancy, correct front/side projection, separated arms, and normalized motion <= 0.015 over a 12-frame/1000 ms live window. Front captures require bilateral core and limb landmarks. Profiles score the left and right shoulder-to-foot chains and require the most visible complete near-side chain plus the best usable nose, near-side eye, or near-side ear; the naturally occluded far-side limb chain is not required. Orientation remains a separate heuristic gate. Front torso bounds use the minimum and maximum x coordinate across both shoulders and hips, so mirrored or reversed screen coordinates do not assume anatomical left is screen-left. Pose quality is calculated from required-landmark visibility and presence rather than a fixed value.

OpenCV uses normalized variance of Laplacian >= 80, mean luminance 45–215, dark fraction <= 0.35, clipped-highlight fraction <= 0.20, and grayscale standard deviation >= 28. Motion is omitted for still photos.

Masks are thresholded at 0.55, morphologically closed, reduced to the largest external contour, and compared using IoU, boundary disagreement, silhouette-height disagreement and torso scanline-width disagreement. BodyPix returns RGBA `ImageData`; the old implementation interpreted channels incorrectly. Conversion now validates `width * height * 4` bytes and creates exactly one mask value per pixel from alpha, preventing background label colours from becoming foreground. The pipeline never silently chooses the larger mask.

## Progressive model initialization

`CameraModelRegistry.initializeLive()` loads MediaPipe Pose Landmarker and OpenCV for alignment. It deliberately does not initialize BodyPix. After accepted front and side views, `initializeSegmentation()` loads BodyPix immediately before measurement processing. `initialize()` loads both stages for photo processing after explicit user action. Generation guards reject initialization that finishes after disposal, and failure paths dispose partially initialized resources. Pinned model URLs, same-origin loading, and manifest hash verification are unchanged.

OpenCV remains a large lazy chunk (approximately 15.5 MB minified in the current build). It is route and action deferred, but this release does not claim that chunk was optimized away.

## Calibration and measurement geometry

Front and side views are calibrated separately:

`mm_per_pixel = verified_height_mm / cleaned_silhouette_height_pixels`

The silhouette top and heel/foot-connected bottom define height—not the nose or forehead. Truncation, implausible aspect ratio, missing visible feet, and landmark/mask extent disagreement above the provisional 0.15 tolerance fail calibration. Scale uncertainty is:

`sqrt((height_input_uncertainty / height_mm)^2 + (boundary_uncertainty_px / silhouette_height_px)^2)`

Torso scanlines select the contiguous interval containing the landmark-derived torso centre and use nearby-row medians. Neck, chest, waist and hip bands are landmark-relative. Circumferences use Ramanujan’s ellipse approximation with front semi-axis `a = front_width/2`, side semi-axis `b = side_depth/2`, and `h = (a-b)^2/(a+b)^2`:

`C = pi(a+b)(1 + 3h/(10 + sqrt(4-3h)))`

Shoulder width is the front shoulder landmark distance checked in image coordinates. Sleeve length is shoulder-to-elbow plus elbow-to-wrist, never a chord. Armhole depth is explicitly estimated from shoulder to chest contour. Shirt length is not directly observable because it depends on preferred hem position; it remains null until manually entered.

## Repetition and pipeline quality

Each view captures at least 8 frames and selects the best 3 with >=150 ms temporal separation. Numeric estimates use the median; spread uses median absolute deviation and a configurable 3-MAD rule. Failed consistency requests another burst or manual fallback and never becomes zero.

The internal score is a non-redistributed weighted sum: capture 0.20, pose 0.20, segmentation 0.20, calibration 0.15, repeat consistency 0.20, observability 0.05. Capture uses selected-frame OpenCV scores; pose uses required-landmark visibility and presence; segmentation, calibration, repeat consistency, and observability use their measured outputs. Missing components score zero. An observable null measurement forces overall quality to zero. High is >=0.75; medium is 0.55–0.749 and requires explicit confirmation; low is <0.55 and requires retry or manual entry. Overall quality is the minimum required observable measurement score. This is a pipeline quality score, not a validated probability that a measurement is accurate.

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

## Known limitations and manual confirmation

Camera and photo estimates are experimental, not clinically or commercially validated. Close-fitting clothing is required; ordinary RGB images cannot recover anatomy hidden by loose clothes. Known-height calibration inherits height-entry, camera perspective, lens distortion, posture, hair, clothing and silhouette-boundary uncertainty. The ellipse circumference model is an approximation, not ground-truth anatomy, and no unvalidated correction factors are applied. Device cameras vary, and ultrawide or digital zoom should be avoided. Every estimate requires review; medium quality requires explicit confirmation, low quality requires retry or manual measurement, and shirt length always requires manual completion because preferred hem position is not observable.

A physical phone smoke test is still required on recent Android Chrome and iPhone Safari devices, including front and rear cameras and permission retry behavior. A labelled pilot comparing estimates with professional tape measurements is also required before making accuracy claims.

Database camera provenance, migrations, persistent captures, model training, children/guardian workflows and deployment are future work and explicitly out of scope for this phase.
