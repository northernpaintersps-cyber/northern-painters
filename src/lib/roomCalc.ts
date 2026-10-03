// Room dimensions to substrate quantities.
//
// The calculator used to emit ceilings and walls only, and threw away the
// perimeter it had already computed — which is exactly the number cornice and
// skirting are measured in. It also deducted nothing for openings, while the
// AI takeoff deducts 1.89 m2 a door, so the two paths disagreed on the same
// room by the area of its doorways.
//
// Pure, so the arithmetic can be checked without running the app.

export interface Room {
  id: string
  name: string
  /** Width, length and height in metres. */
  w: number
  l: number
  h: number
  /** Door and window openings, for the deductions. Absent means none counted. */
  doors?: number
  wins?: number
}

/** A standard door leaf, 0.9 x 2.1 — the figure the AI takeoff also deducts. */
export const DOOR_W = 0.9
export const DOOR_H = 2.1
export const DOOR_M2 = DOOR_W * DOOR_H
/** An unlabelled window, 1.2 x 1.0. */
export const WINDOW_M2 = 1.2
export const DEFAULT_HEIGHT = 2.4

export interface RoomTotals {
  /** m2 */
  ceilings: number
  /** m2, less openings */
  walls: number
  /** lineal metres — room perimeter */
  cornice: number
  /** lineal metres — perimeter less door openings */
  skirtings: number
  /** What was deducted, so the panel can say why the wall area is not w x l x h. */
  deductedM2: number
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** One room's figures. Negative results clamp to 0 — a room cannot owe area. */
export function roomTotals(r: Room): RoomTotals {
  const w = Math.max(0, num(r.w))
  const l = Math.max(0, num(r.l))
  const h = num(r.h) > 0 ? num(r.h) : DEFAULT_HEIGHT
  const doors = Math.max(0, num(r.doors))
  const wins = Math.max(0, num(r.wins))

  const perimeter = 2 * (w + l)
  const deducted = doors * DOOR_M2 + wins * WINDOW_M2

  return {
    ceilings: w * l,
    walls: Math.max(0, perimeter * h - deducted),
    cornice: perimeter,
    // A doorway has no skirting across it.
    skirtings: Math.max(0, perimeter - doors * DOOR_W),
    deductedM2: deducted,
  }
}

/** Every room added up. */
export function roomsTotal(rooms: Room[]): RoomTotals {
  return (rooms ?? []).reduce<RoomTotals>((acc, r) => {
    const t = roomTotals(r)
    return {
      ceilings: acc.ceilings + t.ceilings,
      walls: acc.walls + t.walls,
      cornice: acc.cornice + t.cornice,
      skirtings: acc.skirtings + t.skirtings,
      deductedM2: acc.deductedM2 + t.deductedM2,
    }
  }, { ceilings: 0, walls: 0, cornice: 0, skirtings: 0, deductedM2: 0 })
}

/**
 * The substrate quantities to apply, rounded. Areas to the nearest m2 and
 * lengths to the nearest 0.1 m — a perimeter rounded to a whole metre is a
 * visibly wrong number on a small room.
 */
export function roomQuantities(rooms: Room[]): Record<string, number> {
  const t = roomsTotal(rooms)
  const out: Record<string, number> = {}
  if (t.ceilings > 0) out.ceilings = Math.round(t.ceilings)
  if (t.walls > 0) out.walls = Math.round(t.walls)
  if (t.cornice > 0) out.cornice = Math.round(t.cornice * 10) / 10
  if (t.skirtings > 0) out.skirtings = Math.round(t.skirtings * 10) / 10
  return out
}
