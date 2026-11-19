// Builds the single executable (docs/design/v1-core.md 5.5, D3): Node's single executable application (SEA) with
// dist/project-pm.cjs inside, for the system this runs on: dist/project-pm.exe on Windows, dist/project-pm
// elsewhere. Run `npm run build` first. macOS gets an ad-hoc signature (codesign --sign -): Apple Silicon does not
// run a program with none. That signature is not Apple's, and Gatekeeper still warns (5.5).
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const core = fileURLToPath(new URL('..', import.meta.url))
const dist = `${core}dist`
const bundle = `${dist}/project-pm.cjs`
if (!existsSync(bundle)) throw new Error('dist/project-pm.cjs is missing: run npm run build first')
const exe = `${dist}/project-pm${process.platform === 'win32' ? '.exe' : ''}`
const blob = `${dist}/sea-prep.blob`
const config = `${dist}/sea-config.json`
/**
 * Takes Node's own Authenticode signature off a Windows program (what `signtool remove /s` does): injecting the
 * blob breaks it, and a broken signature reads worse than none. The certificate table is the last thing in the file;
 * its entry in the PE header's data directories is cleared and the file cut before it.
 */
function stripSignature(file) {
  const bytes = readFileSync(file)
  const pe = bytes.readUInt32LE(0x3c)
  if (bytes.toString('latin1', pe, pe + 4) !== 'PE' + String.fromCharCode(0, 0)) throw new Error(`${file} is not a PE file`)
  const optional = pe + 24
  const magic = bytes.readUInt16LE(optional)
  const directories = optional + (magic === 0x20b ? 112 : 96)
  const security = directories + 4 * 8
  const at = bytes.readUInt32LE(security)
  const size = bytes.readUInt32LE(security + 4)
  if (!at || !size) return
  if (at + size !== bytes.length) throw new Error('the certificate table is not at the end of the file')
  bytes.writeUInt32LE(0, security)
  bytes.writeUInt32LE(0, security + 4)
  // The header checksum covered the signature; 0 means "not set", which Windows accepts for programs.
  bytes.writeUInt32LE(0, optional + 64)
  writeFileSync(file, bytes.subarray(0, at))
}

const run = (command, args) => execFileSync(command, args, { cwd: core, stdio: 'inherit' })

writeFileSync(config, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }, null, 2))
run(process.execPath, ['--experimental-sea-config', config])
rmSync(exe, { force: true })
copyFileSync(process.execPath, exe)
if (process.platform === 'darwin') run('codesign', ['--remove-signature', exe])
if (process.platform === 'win32') stripSignature(exe)
const postject = fileURLToPath(new URL('../node_modules/postject/dist/cli.js', import.meta.url))
const args = [postject, exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2']
if (process.platform === 'darwin') args.push('--macho-segment-name', 'NODE_SEA')
run(process.execPath, args)
if (process.platform === 'darwin') run('codesign', ['--sign', '-', exe])
if (process.platform !== 'win32') chmodSync(exe, 0o755)
rmSync(blob, { force: true })
rmSync(config, { force: true })
console.log(`${exe.slice(core.length)}: ${(statSync(exe).size / 1024 / 1024).toFixed(1)} MB (Node ${process.version}, ${process.platform}-${process.arch})`)
