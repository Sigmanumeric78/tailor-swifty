import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(root, 'public/models/camera-model-manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
let failures = 0
const requiredFields = ['model_id', 'model_name', 'task', 'architecture', 'source_repository', 'source_url', 'source_version_or_commit', 'upstream_filename', 'local_path', 'runtime_package', 'runtime_version', 'sha256', 'byte_size', 'licence', 'production_enabled', 'notes']

for (const model of manifest.models.filter((item) => item.production_enabled)) {
  const missingFields = requiredFields.filter((field) => model[field] === undefined || model[field] === null)
  if (missingFields.length) { failures += 1; console.error(`${model.model_id || 'unknown-model'}: FAILED (missing manifest fields: ${missingFields.join(', ')})`); continue }
  const fileRecords = []
  for (const file of model.files) {
    const localPath = path.join(root, 'public/models', file.path)
    try {
      const bytes = await readFile(localPath)
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (bytes.byteLength !== file.byte_size || hash !== file.sha256) throw new Error('integrity mismatch')
      fileRecords.push(`${hash}  ${path.basename(file.path)}\n`)
    } catch (error) {
      failures += 1
      console.error(`${model.model_id}: FAILED (${file.path}: ${error.message})`)
    }
  }
  const totalBytes = model.files.reduce((sum, file) => sum + file.byte_size, 0)
  const aggregate = model.files.length === 1 ? model.files[0].sha256 : createHash('sha256').update(fileRecords.join('')).digest('hex')
  if (totalBytes !== model.byte_size || aggregate !== model.sha256) { failures += 1; console.error(`${model.model_id}: FAILED (aggregate manifest mismatch)`) }
  if (!failures) console.log(`${model.model_id}: VERIFIED`)
}

if (failures) process.exitCode = 1
