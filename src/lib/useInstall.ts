import { useEffect, useState } from 'react'

// Chrome/Edge/Android fire this before showing their own install UI.
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type Platform = 'ios' | 'android' | 'desktop'

function detectPlatform(): Platform {
  const ua = navigator.userAgent
  // iPadOS 13+ reports as Mac, so check for touch as well
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

function detectInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as any).standalone === true
}

export function useInstall() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(detectInstalled)
  const platform = detectPlatform()

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()               // keep the event so we can trigger it from our own button
      setDeferred(e as InstallPromptEvent)
    }
    const onInstalled = () => { setInstalled(true); setDeferred(null) }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)

    const mq = window.matchMedia('(display-mode: standalone)')
    const onDisplayChange = (e: MediaQueryListEvent) => setInstalled(e.matches)
    mq.addEventListener('change', onDisplayChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      mq.removeEventListener('change', onDisplayChange)
    }
  }, [])

  async function install(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!deferred) return 'unavailable'
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'accepted') setInstalled(true)
    setDeferred(null)                  // the event can only be used once
    return outcome
  }

  return {
    platform,
    installed,
    /** True when the browser will show a one-tap install prompt. */
    canPrompt: !!deferred,
    install,
  }
}
