// Passing a job from one page to another.
//
// Several actions start on one page and finish on another — book a site visit
// for this job, raise an invoice for this job. The target page owns its own
// modal, so the source page hands over a payload and the target opens itself.
//
// sessionStorage rather than the URL: these payloads carry client names and
// addresses, and a URL is bookmarked, logged and shared. `?new=1` stays in the
// URL purely as the signal that a handoff is waiting, and is cleared on
// arrival so a refresh does not reopen the modal.

/** Write the payload and return the path to navigate to. */
export function handOff(key: string, payload: unknown): string | null {
  try {
    sessionStorage.setItem(key, JSON.stringify(payload))
    return '?new=1'
  } catch {
    return '?new=1'   // the modal still opens, just empty
  }
}

/**
 * Read a pending handoff, exactly once. Returns null when the page was not
 * opened by one. Clears both the payload and the `?new=1` marker, so a
 * refresh lands on the plain page.
 */
export function takeHandoff<T = any>(key: string): Partial<T> | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  if (params.get('new') !== '1') return null
  let payload: Partial<T> = {}
  try {
    const raw = sessionStorage.getItem(key)
    if (raw) payload = JSON.parse(raw)
    sessionStorage.removeItem(key)
  } catch {}
  window.history.replaceState({}, '', window.location.pathname)
  return payload
}
