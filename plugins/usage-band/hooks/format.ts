import type { TurnUsage } from 'claude-code'

import type { CacheTtl, GitBranch, Tally } from '../types'

/** Theme keys for a level: blue (the theme's `suggestion`), yellow, red. */
export type Level = 'suggestion' | 'warning' | 'error'

const CELLS = 10
const TTL_MS: Record<CacheTtl, number> = { '5m': 300_000, '1h': 3_600_000 }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A percentage's level: blue under 75, yellow from 75, red from 90. */
export const level = (percent: number): Level =>
  percent >= 90 ? 'error' : percent >= 75 ? 'warning' : 'suggestion'

/** The cache countdown's level: blue above 20 minutes left, yellow from 20, red from 10. */
export const cacheLevel = (msLeft: number): Level =>
  msLeft <= 600_000 ? 'error' : msLeft <= 1_200_000 ? 'warning' : 'suggestion'

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

/** The branch header of `git status --porcelain=v2 --branch`; null when it has none. */
export const parseBranch = (porcelain: string): GitBranch | null => {
  const header = (name: string) => {
    const prefix = `# branch.${name} `

    return porcelain.split('\n').find(line => line.startsWith(prefix))?.slice(prefix.length)
  }
  const head = header('head')

  if (head === undefined) {
    return null
  }

  const ab = /^\+(\d+) -(\d+)$/.exec(header('ab') ?? '')

  return {
    branch: head === '(detached)' ? 'detached' : head,
    ahead: ab ? Number(ab[1]) : 0,
    behind: ab ? Number(ab[2]) : 0,
    hasUpstream: header('upstream') !== undefined,
  }
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
