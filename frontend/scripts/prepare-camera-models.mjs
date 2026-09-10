import { spawnSync } from 'node:child_process'

const mode = process.env.VITE_CAMERA_PROCESSING_MODE || 'server'
if (mode === 'server') {
  console.log('Server camera mode: browser CV models are not fetched for this build.')
  process.exit(0)
}
if (mode !== 'browser-research') throw new Error(`Unsupported VITE_CAMERA_PROCESSING_MODE: ${mode}`)
for (const script of ['models:fetch', 'models:verify']) {
  const result = spawnSync('npm', ['run', script], { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status || 1)
}
