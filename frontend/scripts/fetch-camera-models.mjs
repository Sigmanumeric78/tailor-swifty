import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modelsRoot = path.join(root, 'public/models')
const manifest = JSON.parse(await readFile(path.join(modelsRoot, 'camera-model-manifest.json'), 'utf8'))

for (const model of manifest.models.filter((item) => item.production_enabled)) {
  for (const file of model.files) {
    const destination = path.join(modelsRoot, file.path)
    try {
      const existing = await stat(destination)
      if (existing.size === file.byte_size) {
        const hash = createHash('sha256').update(await readFile(destination)).digest('hex')
        if (hash === file.sha256) continue
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await mkdir(path.dirname(destination), { recursive: true })
    const response = await fetch(file.url, { redirect: 'follow' })
    if (!response.ok) throw new Error(`${model.model_id}: download failed with HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    const declaredLength = Number(response.headers.get('content-length'))
    const encoded = response.headers.get('content-encoding')
    if ((!encoded && declaredLength && declaredLength !== bytes.byteLength) || bytes.byteLength !== file.byte_size) throw new Error(`${model.model_id}: invalid content length`)
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== file.sha256) throw new Error(`${model.model_id}: SHA-256 mismatch`)
    const temporary = `${destination}.partial`
    await writeFile(temporary, bytes, { flag: 'wx' })
    await rename(temporary, destination)
    console.log(`${model.model_id}: fetched ${file.path}`)
  }
}
