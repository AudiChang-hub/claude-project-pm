// Bundles the core into one CommonJS file, dist/project-pm.cjs: the npm package's bin, and what the single
// executable carries (scripts/sea.mjs). Nothing is left to load at run time but Node's own modules.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const core = fileURLToPath(new URL('..', import.meta.url))
execFileSync(process.execPath, ['scripts/web-assets.mjs'], { cwd: core, stdio: 'inherit' })
mkdirSync(`${core}dist`, { recursive: true })
const out = `${core}dist/project-pm.cjs`
const result = await build({
  entryPoints: [`${core}src/main.ts`],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
})
chmodSync(out, 0o755)
const inputs = Object.keys(result.metafile.inputs)
// The runtime depends on no npm package (docs/design/v1-plan.md): fail the build if one slipped in.
const packages = inputs.filter(file => file.includes('node_modules'))
if (packages.length) throw new Error(`the bundle pulls in npm packages: ${packages.join(', ')}`)
console.log(`dist/project-pm.cjs: ${Math.round(result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].bytes / 1024)} KiB from ${inputs.length} files`)
