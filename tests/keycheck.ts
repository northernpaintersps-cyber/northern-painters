// Two queries on the same table, under the same cache key, returning
// different columns: whichever loads last wins, and the other page silently
// gets rows missing the fields it needs. That is what blanked the quote
// builder — the Pipeline's trimmed np_quotes query shared a key with the
// Quotes page's full one, so `state` disappeared.
//
// This reads the source rather than the running app, because the failure is
// in how the queries are declared.

import * as fs from 'fs'
import * as path from 'path'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }

const SRC = 'src'
const files: string[] = []
const walk = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.tsx?$/.test(e.name)) files.push(p)
  }
}
walk(SRC)

interface Q { file: string; key: string; projection: string | null }
const found: Q[] = []

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  // Each useQuery block: its key, and the .select() inside it if there is one.
  const re = /queryKey:\s*(\[[^\]]*\])([\s\S]{0,900}?)(?=queryKey:|\n\}\)|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const key = m[1].replace(/\s+/g, ' ')
    const sel = /\.select\(\s*'([^']*)'/.exec(m[2])
    found.push({ file: f.replace(/\\/g, '/'), key, projection: sel ? sel[1].replace(/\s+/g, '') : null })
  }
}

ok(found.length > 10, `found ${found.length} query declarations to check`)

// Group by key and compare what each returns.
const byKey = new Map<string, Q[]>()
for (const q of found) {
  const list = byKey.get(q.key)
  if (list) list.push(q); else byKey.set(q.key, [q])
}

const clashes: string[] = []
for (const [key, qs] of byKey) {
  if (qs.length < 2) continue
  const shapes = new Set(qs.map(q => q.projection ?? '*'))
  if (shapes.size > 1) {
    clashes.push(`${key}\n      ${qs.map(q => `${q.file}: ${q.projection ?? 'all columns'}`).join('\n      ')}`)
  }
}

ok(clashes.length === 0,
  clashes.length
    ? `queries sharing a key but returning different columns:\n    ${clashes.join('\n    ')}`
    : 'no two queries share a cache key while returning different columns')

// The specific pair that caused it, named so the fix cannot be undone quietly.
const quoteQueries = found.filter(q => /np_quotes/.test(q.key))
ok(quoteQueries.length >= 2, `${quoteQueries.length} np_quotes queries exist`)
ok(new Set(quoteQueries.map(q => q.key)).size === quoteQueries.length,
  'and each has its own key: ' + quoteQueries.map(q => q.key).join(' / '))

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
