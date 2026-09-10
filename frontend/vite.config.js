import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const cameraMode = process.env.VITE_CAMERA_PROCESSING_MODE || (mode === 'test' ? 'browser-research' : 'server')
  const serverCameraMode = cameraMode === 'server'

  return {
    // Production server mode must not copy the ignored browser-CV weights that may
    // exist in a developer's public directory. Browser research builds retain the
    // existing verified public-model workflow.
    publicDir: serverCameraMode ? false : 'public',
    plugins: [react()],
    resolve: {
      alias: {
        '@camera-mode-pages': fileURLToPath(new URL(
          serverCameraMode ? './src/features/cameraScan/routes.server.js' : './src/features/cameraScan/routes.browser.js',
          import.meta.url,
        )),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': 'http://127.0.0.1:8000',
        '/health': 'http://127.0.0.1:8000',
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.js',
      css: true,
      globals: true,
    },
  }
})
