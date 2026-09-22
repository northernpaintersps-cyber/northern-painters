import { useInstall } from '@/lib/useInstall'
import { Download, Check, Share, Plus, MoreVertical, Smartphone } from 'lucide-react'

// Per-platform steps for browsers that don't expose a programmatic install prompt.
const MANUAL: Record<string, { icon: React.ReactNode; text: React.ReactNode }[]> = {
  ios: [
    { icon: <Share size={13} />, text: <>Tap the <strong>Share</strong> button in Safari's toolbar</> },
    { icon: <Plus size={13} />, text: <>Choose <strong>Add to Home Screen</strong></> },
    { icon: <Check size={13} />, text: <>Tap <strong>Add</strong> — the icon appears on your home screen</> },
  ],
  android: [
    { icon: <MoreVertical size={13} />, text: <>Open the browser menu (⋮)</> },
    { icon: <Plus size={13} />, text: <>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong></> },
    { icon: <Check size={13} />, text: <>Confirm — the icon appears in your app drawer</> },
  ],
  desktop: [
    { icon: <Download size={13} />, text: <>Click the <strong>install icon</strong> in the address bar (right-hand side)</> },
    { icon: <Plus size={13} />, text: <>Or open the browser menu and choose <strong>Install Northern Painters</strong></> },
    { icon: <Check size={13} />, text: <>It opens in its own window and gets a desktop shortcut</> },
  ],
}

const PLATFORM_LABEL: Record<string, string> = {
  ios: 'On iPhone or iPad (Safari)',
  android: 'On Android',
  desktop: 'On this computer (Chrome or Edge)',
}

export default function InstallCard() {
  const { platform, installed, canPrompt, install } = useInstall()

  if (installed) {
    return (
      <div className="bg-white border border-black/[0.12] rounded-xl p-4">
        <div className="text-[13px] font-bold mb-1 flex items-center gap-1.5">
          <Smartphone size={14} className="text-[#2563eb]" /> App shortcut
        </div>
        <div className="flex items-center gap-1.5 text-[13px] text-[#166534]">
          <Check size={14} /> Installed — you're running the app from your home screen.
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-black/[0.12] rounded-xl p-4">
      <div className="text-[13px] font-bold mb-1 flex items-center gap-1.5">
        <Smartphone size={14} className="text-[#2563eb]" /> Install as an app
      </div>
      <div className="text-xs text-[#666] mb-3">
        Add Northern Painters to your home screen or desktop. It opens full screen without browser bars,
        and works on any device signed in to your account.
      </div>

      {canPrompt && (
        <button
          onClick={async () => {
            const r = await install()
            if (r === 'dismissed') alert('Install dismissed — you can run it again any time from here.')
          }}
          className="flex items-center gap-1.5 px-3 py-2 mb-3 text-[13px] bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg"
        >
          <Download size={14} /> Install app
        </button>
      )}

      <div className="bg-[#f5f4f0] rounded-lg px-3 py-2.5">
        <div className="text-[11px] font-bold uppercase tracking-wide text-[#666] mb-2">
          {canPrompt ? 'Or add it manually' : PLATFORM_LABEL[platform]}
        </div>
        {MANUAL[platform].map((step, i) => (
          <div key={i} className="flex items-start gap-2 py-1 text-xs">
            <span className="shrink-0 mt-px text-[#2563eb]">{step.icon}</span>
            <span>{step.text}</span>
          </div>
        ))}
      </div>

      {platform !== 'ios' && (
        <div className="text-[11px] text-[#666] mt-2.5">
          On a phone, open this site in the phone's browser first — then follow the steps above.
        </div>
      )}
    </div>
  )
}
