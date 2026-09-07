# Experimental camera measurement pipeline

## Architecture and data flow

The `/measurements/camera` route is lazy-loaded. Nothing requests camera permission or imports the vision runtimes until the user selects **Start camera scan**. React Webcam owns the browser video element, `useCameraStream` tracks and stops every stream track, and all processing occurs in browser memory. Preview frames are reduced to at most 640 px for gates. Accepted captures use the source resolution, exist as `ImageBitmap` objects only, and are closed on completion, cancellation, or unmount.

```text
phone camera -> reduced preview -> pose/framing + OpenCV quality gates
             -> 8-frame front burst -> best 3 separated frames
             -> 8-frame side burst  -> best 3 separated frames
             -> MediaPipe/BodyPix masks -> cleanup + consensus
             -> independent height calibration -> geometry x 3
             -> robust aggregation + confidence -> FlowContext
             -> existing manual form review -> unchanged backend submission
```

No raw image, base64 frame, face, mask, landmark or biometric pixel is sent to FastAPI, Lambda, Neon, analytics, or logs. Only reviewed form values follow the existing backend contract.

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

A failed mandatory gate during countdown returns to alignment. Side capture cannot precede front acceptance. The XState machine is hardware-free and unit tested.

## Locked dependencies and models

Production packages are exactly pinned in `frontend/package.json`: react-webcam 7.2.0, XState 5.32.6, @xstate/react 6.1.0, MediaPipe Tasks Vision 1.0.1, Body Segmentation 1.0.2, TensorFlow.js core/converter/WebGL/WASM 4.22.0, and TechStark OpenCV.js 5.0.0-release.1.

The committed model manifest contains per-file sizes and SHA-256 values. Primary model identities are:

- MediaPipe Pose Landmarker full float16 v1: `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1`, 9,398,198 bytes, production.
- BodyPix ResNet50 stride 16 quant2: aggregate `39c74c47e7212bc3cf82b512ccfd58cb6502d8d131b0280697879f8fb572a9e9`, 47,993,528 bytes across model JSON and 12 shards, production.
- U2Net human segmentation: research-only and disabled. Its official repository link does not provide an immutable weight version, published SHA-256, or separate weight licence; no substitute is used.

MediaPipe and TensorFlow WASM runtime files are also versioned, hashed, and loaded from `/models`. Production never fetches model weights from a runtime CDN.

## Gates and provisional thresholds

All thresholds live in `scanConfig.js` and require validation; they are not scientifically established. Pose requires visibility and presence >= 0.70, one usable person, complete head/feet, 2–4% safe margins, 65–92% body-height occupancy, correct front/side projection, separated arms, and normalized motion <= 0.015 over a 12-frame/1000 ms stable window. OpenCV uses normalized variance of Laplacian >= 80, mean luminance 45–215, dark fraction <= 0.35, clipped-highlight fraction <= 0.20, and grayscale standard deviation >= 28.

Masks are thresholded at 0.55, morphologically closed, reduced to the largest external contour, and compared using IoU, boundary disagreement, silhouette-height disagreement and torso scanline-width disagreement. The pipeline never silently chooses the larger mask.

## Calibration and measurement geometry

Front and side views are calibrated separately:

`mm_per_pixel = verified_height_mm / cleaned_silhouette_height_pixels`

The silhouette top and heel/foot-connected bottom define height—not the nose or forehead. Truncation, implausible aspect ratio, missing visible feet and excessive landmark/mask extent disagreement fail calibration. Scale uncertainty is:

`sqrt((height_input_uncertainty / height_mm)^2 + (boundary_uncertainty_px / silhouette_height_px)^2)`

Torso scanlines select the contiguous interval containing the landmark-derived torso centre and use nearby-row medians. Neck, chest, waist and hip bands are landmark-relative. Circumferences use Ramanujan’s ellipse approximation with front semi-axis `a = front_width/2`, side semi-axis `b = side_depth/2`, and `h = (a-b)^2/(a+b)^2`:

`C = pi(a+b)(1 + 3h/(10 + sqrt(4-3h)))`

Shoulder width is the front shoulder landmark distance checked in image coordinates. Sleeve length is shoulder-to-elbow plus elbow-to-wrist, never a chord. Armhole depth is explicitly estimated from shoulder to chest contour. Shirt length is not directly observable because it depends on preferred hem position; it remains null until manually entered.

## Repetition and confidence

Each view captures at least 8 frames and selects the best 3 with >=150 ms temporal separation. Numeric estimates use the median; spread uses median absolute deviation and a configurable 3-MAD rule. Failed consistency requests another burst or manual fallback and never becomes zero.

Confidence is a non-redistributed weighted sum: capture 0.20, pose 0.20, segmentation 0.20, calibration 0.15, repeat consistency 0.20, observability 0.05. Missing components score zero. High is >=0.75; medium is 0.55–0.749 and requires explicit confirmation; low is <0.55 and requires retry/manual entry. Overall confidence is the minimum observable measurement confidence.

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

Camera estimates are experimental, not clinically or commercially validated. Close-fitting clothing is required; ordinary RGB images cannot recover anatomy hidden by loose clothes. Known-height calibration inherits height-entry, camera perspective, lens distortion, posture, hair, clothing and silhouette-boundary uncertainty. Device cameras vary, and ultrawide/digital zoom should be avoided. Every estimate requires review; medium confidence requires explicit confirmation, low confidence requires retry/manual measurement, and shirt length always requires manual completion.

Database camera provenance, migrations, persistent captures, model training, children/guardian workflows and deployment are future work and explicitly out of scope for this phase.
