// Photos in Supabase Storage rather than in the row.
//
// Site visit photos used to be full-resolution base64 text written twice into
// every row — once in the `photos` column and again inside the stringified
// state — so ten phone photos made a visit that could not be saved and a list
// page that downloaded every image to render a count.
//
// They now live in the private `np-photos` bucket at
//   <user_id>/<visit_id>/<photo_id>.jpg
// The first path segment is what the bucket's policies key off, so the shape
// is load-bearing, not decorative. See supabase/np-photos-bucket.sql.

import { supabase } from './supabase'
import { shrinkImage } from './image'

export const PHOTO_BUCKET = 'np-photos'

/** How long a read link lives. Long enough to work on, short enough to leak little. */
const SIGNED_URL_TTL = 60 * 60 * 4

/** A stored photo. `path` is in the bucket; `data` is a legacy inline data URL. */
export interface StoredPhoto {
  id: string
  /** Bucket path, for anything saved since the move to storage. */
  path?: string
  /** Inline data URL — older visits, and previews not yet uploaded. */
  data?: string
  tag?: string
  label?: string
}

export const photoPath = (userId: string, visitId: string, photoId: string) =>
  `${userId}/${visitId || 'loose'}/${photoId}.jpg`

/**
 * Shrink and upload. Returns the bucket path.
 * Throws with a readable message — the caller is usually mid-capture on a
 * phone and needs to know whether to try again.
 */
export async function uploadPhoto(
  file: File, userId: string, visitId: string, photoId: string,
): Promise<string> {
  const blob = await shrinkImage(file, 1280, 0.8)
  const path = photoPath(userId, visitId, photoId)
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(`Could not upload ${file.name}: ${error.message}`)
  return path
}

/**
 * Readable URLs for a set of photos, keyed by photo id.
 *
 * A photo that still carries an inline `data` URL is passed straight through,
 * so visits saved before the bucket existed keep working with no back-fill.
 */
export async function signPhotos(photos: StoredPhoto[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const needed: StoredPhoto[] = []

  for (const p of photos ?? []) {
    if (p.data) out[p.id] = p.data
    else if (p.path) needed.push(p)
  }
  if (!needed.length) return out

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(needed.map(p => p.path!), SIGNED_URL_TTL)
  if (error || !data) return out   // a missing link renders as a gap, not a crash

  data.forEach((row, i) => {
    const id = needed[i]?.id
    if (id && row.signedUrl) out[id] = row.signedUrl
  })
  return out
}

/** Remove photos from the bucket. Inline ones have nothing to remove. */
export async function deletePhotos(photos: StoredPhoto[]): Promise<void> {
  const paths = (photos ?? []).map(p => p.path).filter((p): p is string => !!p)
  if (!paths.length) return
  await supabase.storage.from(PHOTO_BUCKET).remove(paths)
}

/** True once the bucket exists and this user can read it. */
export async function photoStoreReady(): Promise<boolean> {
  const { error } = await supabase.storage.from(PHOTO_BUCKET).list('', { limit: 1 })
  return !error
}
