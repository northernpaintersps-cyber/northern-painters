// A job's weather exposure, as an icon on a calendar chip or a tag in a table.
//
// Shield glyphs rather than clouds: the forecast badge in the same calendar cell
// already owns the cloud and sun icons, and one glyph meaning two things in one
// box is worse than no glyph.

import { Shield, ShieldHalf, ShieldOff } from 'lucide-react'
import {
  jobExposure, isInferred, EXPOSURE_HINT, EXPOSURE_SHORT, EXPOSURE_TAG,
  EXPOSURE_ICON_COLOR, type Exposure,
} from '@/lib/exposure'

const ICONS: Record<Exposure, typeof Shield> = {
  none: Shield,
  partly: ShieldHalf,
  full: ShieldOff,
}

type JobLike = { weather?: string | null; type?: string | null }

const tip = (e: Exposure, inferred: boolean) =>
  `${EXPOSURE_SHORT[e]} — ${EXPOSURE_HINT[e]}${inferred ? ' Taken from the job type; set it on the job to be sure.' : ''}`

/**
 * The icon alone, for a calendar chip where the colour is already spoken for.
 * Wrapped in a span because `title` on an SVG element is not a tooltip —
 * SVG wants a <title> child, and the attribute silently does nothing.
 */
export function ExposureIcon({ job, size = 10 }: { job: JobLike; size?: number }) {
  const e = jobExposure(job)
  const Icon = ICONS[e]
  return (
    <span title={tip(e, isInferred(job))} className={`shrink-0 flex ${EXPOSURE_ICON_COLOR[e]}`}>
      <Icon size={size} />
    </span>
  )
}

/** Icon and word, for a table row. */
export default function ExposureMark({ job }: { job: JobLike }) {
  const e = jobExposure(job)
  const Icon = ICONS[e]
  const inferred = isInferred(job)
  return (
    <span title={tip(e, inferred)}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] whitespace-nowrap
        ${EXPOSURE_TAG[e]} ${inferred ? 'opacity-70 border-dashed' : ''}`}>
      <Icon size={10} />
      {EXPOSURE_SHORT[e]}
    </span>
  )
}
