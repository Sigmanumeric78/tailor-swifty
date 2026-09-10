import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mode = process.env.VITE_CAMERA_PROCESSING_MODE || 'server'
if (mode !== 'server') process.exit(0)

const root = fileURLToPath(new URL('../dist/', import.meta.url))
const forbidden = [
  'camera-model-manifest',
  'pose_landmarker_full.task',
  'vision_wasm',
  'tfjs-backend-wasm',
  'bodypix/resnet50',
  '@techstark/opencv-js',
]

async function files(directory) {
  const output = []
  for (const name of await readdir(directory)) {
    const location = path.join(directory, name)
    if ((await stat(location)).isDirectory()) output.push(...await files(location))
    else output.push(location)
  }
  return output
}

const artifactFiles = await files(root)
for (const location of artifactFiles) {
  const relative = path.relative(root, location).replaceAll(path.sep, '/')
  if (forbidden.some((token) => relative.toLowerCase().includes(token.toLowerCase()))) {
    throw new Error(`Server camera build contains a browser-CV artifact: ${relative}`)
  }
  if (/\.(?:js|html|json)$/i.test(relative)) {
    const content = await readFile(location, 'utf8')
    const found = forbidden.find((token) => content.toLowerCase().includes(token.toLowerCase()))
    if (found) throw new Error(`Server camera build references browser-CV runtime data (${found}) in ${relative}`)
  }
}

console.log(`Server camera bundle verified: ${artifactFiles.length} files and zero browser-CV model/runtime references.`)
