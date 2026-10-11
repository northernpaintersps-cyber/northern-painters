// The forecast, for the crew calendar.
//
// Open-Meteo: a 16-day daily forecast, free at this scale, no API key, and
// CORS-enabled so the browser calls it directly. That last part is what makes it
// the only real option here — this app has no server to hold a key in.
//
// Dates never pass through UTC. `timezone=auto` makes the API return local
// YYYY-MM-DD strings, which is already the key format the rest of the app uses
// (see localDate in utils.ts), so nothing here constructs a Date at all.

import { useQuery } from '@tanstack/react-query'

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'

/** The horizon Open-Meteo's free daily forecast covers. */
export const FORECAST_DAYS = 16

/** Rain at or above this, on a day with work booked, is worth flagging. */
export const RAIN_WARN_MM = 2

export type WxGroup = 'clear' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm'

export interface DayWeather {
  date: string
  code: number
  group: WxGroup
  rainMm: number
  rainChance: number
  tempMax: number
  tempMin: number
  windMax: number
}

export type Forecast = Record<string, DayWeather>

export const isWet = (w: DayWeather): boolean => w.rainMm >= RAIN_WARN_MM

// ── WMO weather codes ────────────────────────────────────────
// One table for both the icon and the words, so the two can never disagree.

const CODES: Record<number, { group: WxGroup; label: string }> = {
  0:  { group: 'clear', label: 'Clear' },
  1:  { group: 'clear', label: 'Mainly clear' },
  2:  { group: 'cloud', label: 'Partly cloudy' },
  3:  { group: 'cloud', label: 'Overcast' },
  45: { group: 'fog',   label: 'Fog' },
  48: { group: 'fog',   label: 'Freezing fog' },
  51: { group: 'rain',  label: 'Light drizzle' },
  53: { group: 'rain',  label: 'Drizzle' },
  55: { group: 'rain',  label: 'Heavy drizzle' },
  56: { group: 'rain',  label: 'Light freezing drizzle' },
  57: { group: 'rain',  label: 'Freezing drizzle' },
  61: { group: 'rain',  label: 'Light rain' },
  63: { group: 'rain',  label: 'Rain' },
  65: { group: 'rain',  label: 'Heavy rain' },
  66: { group: 'rain',  label: 'Light freezing rain' },
  67: { group: 'rain',  label: 'Freezing rain' },
  71: { group: 'snow',  label: 'Light snow' },
  73: { group: 'snow',  label: 'Snow' },
  75: { group: 'snow',  label: 'Heavy snow' },
  77: { group: 'snow',  label: 'Snow grains' },
  80: { group: 'rain',  label: 'Light showers' },
  81: { group: 'rain',  label: 'Showers' },
  82: { group: 'rain',  label: 'Heavy showers' },
  85: { group: 'snow',  label: 'Snow showers' },
  86: { group: 'snow',  label: 'Heavy snow showers' },
  95: { group: 'storm', label: 'Thunderstorm' },
  96: { group: 'storm', label: 'Thunderstorm with hail' },
  99: { group: 'storm', label: 'Thunderstorm with heavy hail' },
}

export const wxGroup = (code: number): WxGroup => CODES[code]?.group ?? 'cloud'
export const codeLabel = (code: number): string => CODES[code]?.label ?? 'Unknown'

/** What the tooltip says. Built here so the badge holds no copy of its own. */
export function wxSummary(w: DayWeather): string {
  const rain = w.rainMm > 0
    ? `${w.rainMm.toFixed(1)}mm rain, ${Math.round(w.rainChance)}% chance`
    : `No rain forecast (${Math.round(w.rainChance)}% chance)`
  return [
    codeLabel(w.code),
    `${Math.round(w.tempMin)}–${Math.round(w.tempMax)}°C`,
    rain,
    `wind to ${Math.round(w.windMax)} km/h`,
  ].join(' · ')
}

// ── Geocoding ────────────────────────────────────────────────

export interface Place { lat: number; lon: number; label: string }

const place = (hit: any, withCountry: boolean): Place => ({
  lat: hit.latitude,
  lon: hit.longitude,
  label: [hit.name, hit.admin1, withCountry ? hit.country : null].filter(Boolean).join(', '),
})

/** The biggest town of the candidates — "Lismore" is NSW, not the 407 in Victoria. */
const biggest = (hits: any[]): any =>
  hits.reduce((best, h) => ((h.population ?? 0) > (best.population ?? 0) ? h : best), hits[0])

async function search(params: string): Promise<any[]> {
  const res = await fetch(`${GEOCODE_URL}?${params}`)
  if (!res.ok) throw new Error(`Lookup failed (HTTP ${res.status})`)
  return (await res.json())?.results ?? []
}

/**
 * Resolve a town or suburb to a point. Town and suburb names resolve well;
 * a bare postcode often does not, which is what the Settings copy warns about.
 *
 * The filter parameter is `countryCode`. An unrecognised one is ignored rather
 * than rejected, and "Lismore" unfiltered is a town of 230 people in Minnesota —
 * a wrong point looks exactly like a right one on a calendar, so this searches
 * Australia first and only widens when nothing matches there.
 */
export async function geocode(query: string): Promise<Place | null> {
  const q = query.trim()
  if (!q) return null
  const name = encodeURIComponent(q)

  const au = await search(`name=${name}&count=5&language=en&countryCode=AU`)
  if (au.length) return place(biggest(au), false)

  // A bare postcode finds no town, and the unfiltered search then matches it as
  // a name: "2480" comes back as Dessel, Belgium. Fail instead, so the Settings
  // copy can say to type the town.
  if (/^\d+$/.test(q)) return null

  const any = await search(`name=${name}&count=5&language=en`)
  return any.length ? place(biggest(any), true) : null
}

// ── The forecast ─────────────────────────────────────────────

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Zip the parallel arrays Open-Meteo returns into a map keyed on the date. */
export function parseForecast(json: any): Forecast {
  const d = json?.daily
  const days: unknown[] = Array.isArray(d?.time) ? d.time : []
  const out: Forecast = {}
  days.forEach((date, i) => {
    if (typeof date !== 'string') return
    const code = num(d.weather_code?.[i])
    out[date] = {
      date,
      code,
      group: wxGroup(code),
      rainMm: num(d.precipitation_sum?.[i]),
      rainChance: num(d.precipitation_probability_max?.[i]),
      tempMax: num(d.temperature_2m_max?.[i]),
      tempMin: num(d.temperature_2m_min?.[i]),
      windMax: num(d.wind_speed_10m_max?.[i]),
    }
  })
  return out
}

export async function fetchForecast(lat: number, lon: number): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: [
      'weather_code', 'precipitation_sum', 'precipitation_probability_max',
      'temperature_2m_max', 'temperature_2m_min', 'wind_speed_10m_max',
    ].join(','),
    timezone: 'auto',
    forecast_days: String(FORECAST_DAYS),
  })
  const res = await fetch(`${FORECAST_URL}?${params}`)
  if (!res.ok) throw new Error(`Forecast failed (HTTP ${res.status})`)
  return parseForecast(await res.json())
}

/**
 * Keyed on the location, not on the month in view, so paging through the
 * calendar costs nothing.
 *
 * A failure is reported rather than swallowed. Returning an empty map on error
 * kept the calendar up, which was the point, but it made "no location set",
 * "the API is down" and "it is working, there is just no rain" look identical —
 * three different problems with one blank screen. The caller renders the
 * difference and the grid still never depends on the forecast arriving.
 */
export function useWeather(lat?: number | null, lon?: number | null) {
  return useQuery<Forecast>({
    queryKey: ['weather', lat ?? null, lon ?? null],
    queryFn: () => fetchForecast(lat!, lon!),
    enabled: lat != null && lon != null,
    staleTime: 30 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    retry: 1,
  })
}
