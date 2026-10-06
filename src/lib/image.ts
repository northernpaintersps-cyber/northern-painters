// Resizing photos before they are stored or sent.
//
// Site visit photos were kept at full resolution as base64 text in the
// database — a 4MB phone shot became ~5.5MB of string, and ten of them made a
// row that could not be saved. The same shrink was already written inside
// ai.ts for API requests; it lives here now so both paths use one copy.

/**
 * Shrink a large photo. A phone shot can be 10MB+, which makes a request slow
 * and can push it past the API's size limit; the service downscales past
 * ~1568px anyway, so nothing legible is lost.
 *
 * Returns the original file untouched when it is already small enough, when it
 * is not an image, or when the browser cannot decode it.
 */
export async function shrinkImage(
  file: File, maxEdge = 1568, quality = 0.92,
): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size < 4_000_000) { bitmap.close?.(); return file }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) { bitmap.close?.(); return file }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', quality))
  return blob && blob.size < file.size ? blob : file
}

const readDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error ?? new Error('Could not read the image'))
    r.readAsDataURL(blob)
  })

/**
 * A shrunk photo as a data URL, for storing rather than sending. Smaller and
 * harder-compressed than the API default: these are reference shots of a wall,
 * not documents to be read.
 */
export async function shrinkToDataUrl(
  file: File, maxEdge = 1280, quality = 0.8,
): Promise<string> {
  return readDataUrl(await shrinkImage(file, maxEdge, quality))
}
