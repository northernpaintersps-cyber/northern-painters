// The forecast in a calendar day box: condition icon, and the rain in mm when
// there is any. Amber only when the rain lands on a day that has work booked —
// rain on an empty Saturday is weather, not information.

import { Sun, Cloud, CloudRain, CloudLightning, CloudFog, CloudSnow } from 'lucide-react'
import { isWet, wxSummary, type DayWeather, type WxGroup } from '@/lib/weather'

const ICONS: Record<WxGroup, typeof Sun> = {
  clear: Sun,
  cloud: Cloud,
  fog: CloudFog,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
}

export default function WeatherBadge({ wx, booked }: { wx?: DayWeather; booked: boolean }) {
  if (!wx) return null
  const Icon = ICONS[wx.group]
  const warn = booked && isWet(wx)
  const mm = Math.round(wx.rainMm)

  return (
    <span title={wxSummary(wx)}
      className={`shrink-0 flex items-center gap-0.5 text-[9px] leading-none tabular-nums
        ${warn ? 'text-amber-600 font-semibold' : 'text-gray-400'}`}>
      <Icon size={11} />
      {mm >= 1 && <span>{mm}mm</span>}
    </span>
  )
}
