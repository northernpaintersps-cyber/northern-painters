// Speaking instead of typing, on a site where your hands are full.
//
// The old recorder set continuous = false and interimResults = false, so
// Chrome ended it at the first pause and only the first result was read: a
// walkthrough came out as one sentence. It also kept the recognizer in a local
// variable, so there was no way to stop it, a second tap started a competing
// instance, and closing the editor left the microphone live.
//
// Transcript only — no audio is captured or kept.

import { useCallback, useEffect, useRef, useState } from 'react'

type SR = any

const Recognition = (): SR | null =>
  (typeof window === 'undefined')
    ? null
    : (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null

export const dictationSupported = () => !!Recognition()

/** What went wrong, in words the person holding the phone can act on. */
function errorText(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Allow it for this site in your browser settings, then try again.'
    case 'audio-capture':
      return 'No microphone found.'
    case 'network':
      return 'Speech recognition needs a connection and could not reach the service. '
        + 'Type the note instead, or try again when you have signal.'
    case 'aborted':
      return ''
    default:
      return `Voice input failed (${code}).`
  }
}

export interface Dictation {
  supported: boolean
  listening: boolean
  /** What is being said right now, before it is finalised. */
  interim: string
  /** Begin. `onText` is called with each finalised phrase, in order. */
  start: (onText: (phrase: string) => void) => void
  stop: () => void
  error: string
}

export function useDictation(lang = 'en-AU'): Dictation {
  const recRef = useRef<SR>(null)
  /** The user's intent, as opposed to whether the recognizer happens to be up. */
  const wantRef = useRef(false)
  const onTextRef = useRef<(phrase: string) => void>(() => {})
  const restartsRef = useRef(0)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')

  const stop = useCallback(() => {
    wantRef.current = false
    setListening(false)
    setInterim('')
    try { recRef.current?.stop() } catch { /* already down */ }
  }, [])

  const begin = useCallback(() => {
    const Ctor = Recognition()
    if (!Ctor) return

    const rec: SR = new Ctor()
    rec.lang = lang
    // Both of these are the fix: keep going through pauses, and show the words
    // as they are recognised so it is obvious the microphone is live.
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onresult = (ev: any) => {
      restartsRef.current = 0
      let live = ''
      // Only the results from this event onwards are new; earlier ones have
      // already been handed over.
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]
        const text = r[0]?.transcript ?? ''
        if (r.isFinal) onTextRef.current(text.trim())
        else live += text
      }
      setInterim(live.trim())
    }

    rec.onerror = (ev: any) => {
      const msg = errorText(ev?.error ?? 'unknown')
      // A dropped connection or a silent stretch should not end the note; a
      // refused microphone should, since retrying cannot help.
      if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed' || ev?.error === 'audio-capture') {
        wantRef.current = false
        setListening(false)
      }
      if (msg && ev?.error !== 'no-speech') setError(msg)
    }

    rec.onend = () => {
      // Chrome ends the recognizer on its own after a stretch of silence even
      // with continuous set, which is what cut a walkthrough short. Start it
      // again until the user actually presses stop — but give up rather than
      // spin if it keeps dying with nothing recognised.
      if (!wantRef.current) { setListening(false); setInterim(''); return }
      if (restartsRef.current > 8) {
        wantRef.current = false
        setListening(false)
        setError('Voice input kept dropping out. Type the note instead.')
        return
      }
      restartsRef.current++
      try { rec.start() } catch { wantRef.current = false; setListening(false) }
    }

    recRef.current = rec
    try {
      rec.start()
      setListening(true)
      setError('')
    } catch (e: any) {
      wantRef.current = false
      setListening(false)
      setError(e?.message ?? 'Could not start the microphone.')
    }
  }, [lang])

  const start = useCallback((onText: (phrase: string) => void) => {
    onTextRef.current = onText
    if (wantRef.current) { stop(); return }   // a second tap stops, rather than stacking
    restartsRef.current = 0
    wantRef.current = true
    begin()
  }, [begin, stop])

  // Leaving the page with the microphone live is the one failure the user
  // cannot see and cannot undo.
  useEffect(() => () => {
    wantRef.current = false
    try { recRef.current?.abort() } catch { /* nothing to abort */ }
  }, [])

  return { supported: dictationSupported(), listening, interim, start, stop, error }
}

/** Append a dictated phrase to existing text, spacing and capitalising it. */
export function appendPhrase(existing: string, phrase: string): string {
  const p = phrase.trim()
  if (!p) return existing
  const base = existing.trim()
  if (!base) return p.charAt(0).toUpperCase() + p.slice(1)
  const joiner = /[.!?]$/.test(base) ? ' ' : '. '
  return base + joiner + p.charAt(0).toUpperCase() + p.slice(1)
}
