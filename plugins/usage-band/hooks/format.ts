import type { TurnUsage } from 'claude-code'

import type { CacheTtl, GitBranch, RememberedLimit, SavedSession, StoredLimits, Tally } from '../types'

/**
 * The calm level's fixed blue. Not a theme key: the desktop app greys the theme's `suggestion` blue
 * out while its window is unfocused, and the band should read the same either way.
 */
export const CALM_BLUE = '#5B9DF5'

/** A level's colour: the fixed calm blue, then the theme's `warning` (yellow) and `error` (red). */
export type Level = typeof CALM_BLUE | 'warning' | 'error'

const CELLS = 10
const TTL_MS: Record<CacheTtl, number> = { '5m': 300_000, '1h': 3_600_000 }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A percentage's level: blue under 75, yellow from 75, red from 90. */
export const level = (percent: number): Level =>
  percent >= 90 ? 'error' : percent >= 75 ? 'warning' : CALM_BLUE

/** The cache countdown's level: blue above 20 minutes left, yellow from 20, red from 10. */
export const cacheLevel = (msLeft: number): Level =>
  msLeft <= 600_000 ? 'error' : msLeft <= 1_200_000 ? 'warning' : CALM_BLUE

/** How many of a bar's 10 cells a percentage fills, one per 10 %. */
export const filledCells = (percent: number): number =>
  Math.min(CELLS, Math.max(0, Math.round(percent / 10)))

/** 950, 1k, 420k, 1M, 1.3M */
export const compactTokens = (n: number): string => {
  if (n >= 1_000_000) {
    return `${Number((n / 1_000_000).toFixed(1))}M`
  }

  return n >= 1_000 ? `${Math.round(n / 1_000)}k` : `${n}`
}

/** 45s, 38m, 1h52m, 2d3h; zero or less is "now". */
export const duration = (ms: number): string => {
  if (ms <= 0) {
    return 'now'
  }

  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days}d${hours % 24}h`
  }

  if (hours > 0) {
    return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
  }

  return minutes > 0 ? `${minutes}m` : `${Math.floor(ms / 1_000)}s`
}

/** The weekday and local 24-hour time a window resets at: "Thu 09:00"; "now" once it has passed. */
export const resetMoment = (iso: string | undefined, now: number): string => {
  const at = iso === undefined ? NaN : Date.parse(iso)

  if (Number.isNaN(at)) {
    return '—'
  }

  if (at <= now) {
    return 'now'
  }

  const d = new Date(at)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')

  return `${DAYS[d.getDay()]} ${hh}:${mm}`
}

/** Milliseconds the main thread's cache has left; null before any request, ≤ 0 once cold. */
export const cacheLeft = (t: Tally, now: number): number | null =>
  t.lastRequestAt === null ? null : t.lastRequestAt + TTL_MS[t.cacheTtl ?? '5m'] - now

/** The lifetime a request's cache write got (the shorter when it wrote both); a read alone keeps the previous. */
export const cacheTtlOf = (u: TurnUsage, previous: CacheTtl | null): CacheTtl => {
  if ((u.ephemeral_5m_input_tokens ?? 0) > 0) {
    return '5m'
  }

  if ((u.ephemeral_1h_input_tokens ?? 0) > 0) {
    return '1h'
  }

  return previous ?? '5m'
}

/** `git rev-list --left-right --count @{upstream}...HEAD` ("behind\tahead"); zeros when unreadable. */
export const parseCounts = (out: string): { behind: number; ahead: number } => {
  const m = /^(\d+)\s+(\d+)/.exec(out.trim())

  return m ? { behind: Number(m[1]), ahead: Number(m[2]) } : { behind: 0, ahead: 0 }
}

/** "main ↑2 ↓0", "main ✓" in sync, "feat/x (not pushed)" with no upstream. */
export const branchLabel = (g: GitBranch): string => {
  if (!g.hasUpstream) {
    return `${g.branch} (not pushed)`
  }

  return g.ahead === 0 && g.behind === 0 ? `${g.branch} ✓` : `${g.branch} ↑${g.ahead} ↓${g.behind}`
}

/** The session's cost as `/cost` estimates it, in dollars: "$1.84". */
export const price = (usd: number): string => `$${usd.toFixed(2)}`

// ── Saved data ────────────────────────────────────────────────────────────────────────────────────
// The store hands back plain JSON, possibly written by an older version or damaged: nothing is
// trusted until its shape is checked. A value that fails is treated as absent.

const SAVED_DAYS = 30
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const asTally = (v: unknown): Tally | null =>
  isObject(v) &&
  isNumber(v.tokens) &&
  (v.lastRequestAt === null || isNumber(v.lastRequestAt)) &&
  (v.cacheTtl === null || v.cacheTtl === '5m' || v.cacheTtl === '1h')
    ? { tokens: v.tokens, lastRequestAt: v.lastRequestAt, cacheTtl: v.cacheTtl }
    : null

/** A `session:<id>` store entry, or null when it is not one. */
export const asSavedSession = (v: unknown): SavedSession | null => {
  const tally = isObject(v) ? asTally(v.tally) : null

  return tally && isObject(v) && isNumber(v.savedAt) ? { tally, savedAt: v.savedAt } : null
}

const asLimit = (v: unknown): RememberedLimit | null =>
  isObject(v) && typeof v.kind === 'string' && isNumber(v.percentUsed) && (v.resetsAt === undefined || typeof v.resetsAt === 'string')
    ? v.resetsAt === undefined
      ? { kind: v.kind, percentUsed: v.percentUsed }
      : { kind: v.kind, percentUsed: v.percentUsed, resetsAt: v.resetsAt }
    : null

/** The `limits` store entry, or null when it is not one. */
export const asStoredLimits = (v: unknown): StoredLimits | null => {
  if (!isObject(v) || !isNumber(v.at) || !Array.isArray(v.rateLimits)) {
    return null
  }

  const rateLimits = v.rateLimits.map(asLimit)

  return rateLimits.every(l => l !== null) ? { at: v.at, rateLimits: rateLimits as RememberedLimit[] } : null
}

/** A saved session is dropped once it is more than 30 days old. */
export const isExpired = (savedAt: number, now: number): boolean => now - savedAt > SAVED_DAYS * 86_400_000

/** Remembered windows as of `now`: one whose reset has passed has started over, so it reads 0 %. */
export const rememberedLimits = (limits: readonly RememberedLimit[], now: number): RememberedLimit[] =>
  limits.map(l => {
    const at = l.resetsAt === undefined ? NaN : Date.parse(l.resetsAt)

    return !Number.isNaN(at) && at <= now ? { kind: l.kind, percentUsed: 0 } : l
  })
