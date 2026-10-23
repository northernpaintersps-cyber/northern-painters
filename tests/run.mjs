// Run every check suite.
//
//   npm test            every suite
//   npm test cash fy    only the suites whose name contains "cash" or "fy"
//
// There is no test runner in this project and these are not unit tests in
// the usual sense: each suite is a TypeScript file that imports the app's
// own modules, asserts against them and prints a line per assertion. They
// are bundled with esbuild — which resolves the `@/` alias and strips the
// types — and run under node.
//
// Two rules this runner exists to enforce:
//
//   Always rebuild. A stale bundle once reported "all passed" against a
//   version of the code that no longer existed, hiding nineteen real
//   failures. Nothing here is ever reused between runs.
//
//   Fail loudly. A suite that will not bundle, or that throws, is a failure
//   and not a skip. The exit code is what CI or a hook would read.
//
// The bundles go to a temp directory, not into the repo.

import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const out = mkdtempSync(join(tmpdir(), 'np-checks-'))

// The app reads these at import time and throws without them. They are not
// real — nothing here talks to Supabase.
const ENV = JSON.stringify({
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'test-anon-key',
})

const filters = process.argv.slice(2).filter(a => !a.startsWith('-'))
const suites = readdirSync(here)
  .filter(f => f.endsWith('check.ts'))
  .map(f => basename(f, '.ts'))
  .filter(name => !filters.length || filters.some(f => name.includes(f)))
  .sort()

if (!suites.length) {
  console.error(filters.length ? `No suite matches: ${filters.join(', ')}` : 'No suites found.')
  process.exit(1)
}

// esbuild through its API rather than its command line: spawning `npx` is
// not portable to Windows, where it is a .cmd and needs a shell.
const bundleSuite = (name, outfile) => build({
  entryPoints: [join(here, `${name}.ts`)],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  alias: { '@': join(root, 'src') },
  define: { 'import.meta.env': ENV },
  logLevel: 'error',
  absWorkingDir: root,
})

// spawnSync rather than execFileSync: a failing suite exits 1 by design, and
// execFileSync throws on that — which reported every real failure as a crash
// and swallowed the summary the suite had just printed.
const runNode = file =>
  spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8' })

let failed = 0
const width = Math.max(...suites.map(s => s.length)) + 2

for (const name of suites) {
  const bundle = join(out, `${name}.cjs`)
  try {
    await bundleSuite(name, bundle)
  } catch (e) {
    failed++
    console.log(`${name.padEnd(width)}WILL NOT BUILD`)
    console.log(String(e.stderr || e.stdout || e.message).trim())
    continue
  }

  const { status, stdout = '', stderr = '' } = runNode(bundle)
  const last = stdout.trimEnd().split('\n').pop() ?? ''
  const passed = status === 0 && last.endsWith('passed')

  console.log(`${name.padEnd(width)}${last.trim() || (status === 0 ? 'no output' : 'THREW')}`)
  if (!passed) {
    failed++
    // Only the failing assertions, so a green run stays one line per suite.
    for (const line of stdout.split('\n')) if (line.startsWith('FAIL')) console.log(`  ${line}`)
    // A suite that fell over before it could report has nothing but stderr.
    if (stderr.trim()) console.log(stderr.trim().split('\n').slice(0, 8).map(l => `  ${l}`).join('\n'))
  }
}

rmSync(out, { recursive: true, force: true })

console.log('—'.repeat(width + 12))
console.log(failed ? `${failed} of ${suites.length} SUITES FAILED` : `all ${suites.length} suites passed`)
process.exit(failed ? 1 : 0)
