# Atelier landing integration

Base: 1134673b3d07d3a009ba03ca7d4610e10a1cd3cb on feature/server-side-camera-processing-no-s3.

The home route now uses the supplied marble torso, fixed authored tape and progressive scroll reveal. The existing start handler still selects shirt and navigates to consent. Only the home route hides the fitting index and uses full-width content. Camera, uploads, consent enforcement, measurement logic and backend are unchanged.

Three is exactly pinned at 0.160.0. Loader and renderer come from that same package. The model contains normals, UVs and its texture. `assets.js` imports hashed asset URLs explicitly because server-mode Vite disables publicDir. Keep that configuration: it prevents accidental publication of browser CV model weights.

Rendering is isolated in the dynamically imported scene.js. The still poster is always usable during startup/failure. Reduced motion and data saving default to the poster. Pause shows the completed ribbon. Teardown aborts downloads and disposes resources. The tape is decorative; no dimensions are inferred from the sculpture.

Verification on 2026-09-30: 148 server-mode and 146 browser-research frontend tests passed. The production build and its postbuild audit passed with 21 files and no browser-CV runtime/model references. Separate asset checks confirmed the embedded texture, finite unit normals and 2,163 surface-clearance samples. Real headless Chrome checks at 1440, 768, 390 and 320 CSS pixels found no horizontal overflow and exercised pause/resume, CTA-to-consent navigation, the manual/camera/photo entry routes, reduced motion, asset failure and WebGL failure. Physical Android Chrome and iPhone Safari checks have NOT been completed.

The production build emits `poster.webp` as 64,480 bytes, `tape-geometry.json` as 134,504 bytes (34,820 bytes transferred with local compression), and `torso.glb` as 1,734,320 bytes. On a fresh local Chrome load, those resources completed in 2.9 ms, 7.3 ms and 14.4 ms respectively; the 3D-ready observation was 3.35 seconds including browser navigation and the network-idle wait. These are local desktop observations, not mobile or hosted performance claims.

Before preview release: check mobile layout; scroll/pause/reduced-motion behavior; loading failures; start-to-consent flow; navigation to camera/upload routes; network/graphics resource cleanup. Do not treat the native-rendered motion reference as a browser test. Backend redeployment is not required for this landing change.
