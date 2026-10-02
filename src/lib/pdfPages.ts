// Splitting a PDF in the browser, so a 40-sheet architectural set can be read.
//
// A full set hits two walls before it hits a cost problem: the API caps a
// request at 32MB (and base64 inflates by a third on the way), and an
// architectural sheet costs roughly 3,000-4,500 tokens once rasterised, so
// forty of them fill the context window with no room left to reason.
//
// pdf-lib rather than pdf.js: pdf.js renders pages to a canvas, it cannot emit
// a PDF, and what is needed here is to carve the set into smaller PDFs.

import { PDFDocument } from 'pdf-lib'

/** Raw bytes per request chunk. Base64 takes 32MB of payload to ~24MB of data. */
export const MAX_CHUNK_BYTES = 15 * 1024 * 1024

export class PdfReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfReadError'
  }
}

async function load(file: File): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
  } catch (e: any) {
    throw new PdfReadError(`Could not read ${file.name}: ${e?.message ?? 'unsupported or damaged PDF'}`)
  }
}

export async function pdfPageCount(file: File): Promise<number> {
  return (await load(file)).getPageCount()
}

/** A new PDF holding only `pages` (1-indexed), in the order given. */
export async function pdfSubset(file: File, pages: number[], name?: string): Promise<File> {
  const src = await load(file)
  const total = src.getPageCount()
  const wanted = [...new Set(pages)]
    .filter(p => Number.isInteger(p) && p >= 1 && p <= total)
    .sort((a, b) => a - b)
  if (!wanted.length) throw new PdfReadError(`No usable pages selected from ${file.name}`)

  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, wanted.map(p => p - 1))
  copied.forEach(p => out.addPage(p))
  const bytes = await out.save()
  return new File(
    // A fresh ArrayBuffer: the Uint8Array pdf-lib returns may be a view over a
    // larger buffer, and passing that to File would include the slack.
    [bytes.slice().buffer as ArrayBuffer],
    name ?? file.name.replace(/\.pdf$/i, '') + `-p${wanted[0]}-${wanted[wanted.length - 1]}.pdf`,
    { type: 'application/pdf' },
  )
}

export interface PdfChunk { file: File; firstPage: number; lastPage: number }

/**
 * Consecutive chunks of at most `size` pages, split further when a chunk would
 * exceed MAX_CHUNK_BYTES. A set of large scans can blow the request limit well
 * inside the page count, so both bounds are checked.
 */
export async function pdfChunks(file: File, size: number): Promise<PdfChunk[]> {
  const total = await pdfPageCount(file)
  if (total <= size && file.size <= MAX_CHUNK_BYTES) {
    return [{ file, firstPage: 1, lastPage: total }]
  }

  const out: PdfChunk[] = []
  let first = 1
  while (first <= total) {
    let last = Math.min(first + size - 1, total)
    let chunk = await pdfSubset(file, range(first, last))
    // Halve the span until it fits, down to a single page — one page over the
    // limit is unsplittable, and is sent anyway so the failure names itself.
    while (chunk.size > MAX_CHUNK_BYTES && last > first) {
      last = first + Math.floor((last - first) / 2)
      chunk = await pdfSubset(file, range(first, last))
    }
    out.push({ file: chunk, firstPage: first, lastPage: last })
    first = last + 1
  }
  return out
}

export const range = (a: number, b: number): number[] =>
  Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i)
