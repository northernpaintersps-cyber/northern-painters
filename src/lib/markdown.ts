// Just enough markdown for an AI reply.
//
// Moved out of Insights.tsx, where it was inline, and given tables — the
// assistant's prompt asks for a table when comparing more than about three
// things, and without this that arrives as rows of pipe characters.
//
// Everything is escaped first, so a client name with an angle bracket in it
// cannot put markup on the page.

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const inline = (s: string) => s
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,.06);padding:1px 4px;border-radius:3px">$1</code>')

const TD = 'padding:3px 8px;border-bottom:1px solid rgba(0,0,0,.08)'
const TH = `${TD};font-weight:700;color:#666;text-align:left;white-space:nowrap`

const cells = (line: string): string[] =>
  line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())

/** A row of dashes under the header is what makes a pipe table a table. */
const isDivider = (line: string): boolean =>
  /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-')

export function mdHTML(src: string): string {
  const lines = esc(src).split('\n')
  const out: string[] = []
  let inList = false
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false } }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]

    // A table: a pipe row, then a divider, then rows until the pipes stop.
    if (raw.includes('|') && isDivider(lines[i + 1] ?? '')) {
      closeList()
      const head = cells(raw)
      out.push('<table style="border-collapse:collapse;margin:8px 0;font-size:12px;width:100%">')
      out.push(`<thead><tr>${head.map(c => `<th style="${TH}">${inline(c)}</th>`).join('')}</tr></thead><tbody>`)
      i += 2
      while (i < lines.length && lines[i].includes('|')) {
        const row = cells(lines[i])
        // Numbers right-align and sit on tabular figures, so a column of
        // dollars reads as a column.
        out.push(`<tr>${row.map(c => {
          const num = /^[-+]?[$]?[\d,.]+%?$/.test(c.trim())
          return `<td style="${TD}${num ? ';text-align:right;font-variant-numeric:tabular-nums' : ''}">${inline(c)}</td>`
        }).join('')}</tr>`)
        i++
      }
      i--
      out.push('</tbody></table>')
      continue
    }

    const line = inline(raw)
    const li = line.match(/^\s*[-•]\s+(.*)$/)
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/)
    const h = line.match(/^(#{1,4})\s+(.*)$/)

    if (li || num) {
      if (!inList) { out.push('<ul style="margin:4px 0;padding-left:18px">'); inList = true }
      out.push(`<li style="margin:2px 0">${(li ?? num)![1]}</li>`)
      continue
    }
    closeList()
    if (h) { out.push(`<div style="font-weight:700;margin:8px 0 4px">${h[2]}</div>`); continue }
    if (!line.trim()) { out.push('<div style="height:6px"></div>'); continue }
    out.push(`<div>${line}</div>`)
  }
  closeList()
  return out.join('')
}
