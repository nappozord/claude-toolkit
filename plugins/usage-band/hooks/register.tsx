import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Tally, Workspace } from '../types'
import {
  branchLabel,
  cacheLeft,
  cacheLevel,
  cacheTtlOf,
  compactTokens,
  duration,
  filledCells,
  level,
  parseBranch,
  price,
  resetMoment,
} from './format'

/**
 * usage-band: a band above the prompt.
 *   top. workspace (folder, worktree mark, branch and its sync) | prompts, cost — then a divider
 *   1. context window: percent + bar, tokens in the window / window size
 *   2. rate limits: 5-hour percent + bar + time to reset, weekly percent + bar + reset moment
 *   3. session: prompt-cache countdown (main thread), session time, tokens sent and received (no cache reads)
 * See DESIGN.md for the why.
 */

const EMPTY_TALLY: Tally = { tokens: 0, lastRequestAt: null, cacheTtl: null }
const tally = atom({ plugin: 'usage-band', key: 'tally' } as const, EMPTY_TALLY)
const workspace = atom({ plugin: 'usage-band', key: 'workspace' } as const, null as Workspace | null)

const GIT_TIMEOUT_MS = 5_000

/** Reads the folder and git state into `workspace`; drawing only ever reads that. */
const refreshWorkspace = async ($: EngineInterface): Promise<void> => {
  const cwd = await $.session.cwd()
  const folder = cwd.split('/').filter(Boolean).pop() ?? cwd
  const git = async (...args: string[]) => {
    try {
      // fsmonitor off: a repository's own config could otherwise make `git status` run a program.
      // (Repo hooks are already off for git run by a mod.)
      const r = await $.process.run(['git', '-c', 'core.fsmonitor=false', ...args], { cwd, timeoutMs: GIT_TIMEOUT_MS })

      return r.exitCode === 0 ? r.stdout : null
    } catch {
      return null
    }
  }
  const [status, dirs] = await Promise.all([
    git('status', '--porcelain=v2', '--branch', '--untracked-files=no'),
    git('rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'),
  ])
  const [gitDir, commonDir] = (dirs ?? '').trim().split('\n')

  await update($, workspace, () => ({
    folder,
    isWorktree: gitDir !== undefined && commonDir !== undefined && gitDir !== commonDir,
    git: status === null ? null : parseBranch(status),
  }))
  $.ui.invalidate('ui.render')
}

const TICK_MS = 30_000
const BAR_CELLS = 10
const BAR_GLYPH = '▰'
/** Below this many cells the 5-hour and weekly readings no longer fit one row: they stack. */
const NARROW_COLUMNS = 80
const SEP = '    ·    '

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    $.clock.every(TICK_MS, () => {
      $.ui.invalidate('ui.render')
      void refreshWorkspace($).catch(() => undefined)
    })
    void refreshWorkspace($).catch(() => undefined)

    return started
  })

  // Branch switches, commits, pushes and pulls run through Bash: read git again after one.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)

    void refreshWorkspace($).catch(() => undefined)

    return result
  })

  on('turn.step', async function* ($, e, next) {
    // The cache lifetime counts from the request the API answered: stamp the time at the first
    // chunk of the answer, past any retry backoff (engine chunks are envelopes and retry markers).
    let at: number | null = null
    const stream = next(e)

    for await (const chunk of stream) {
      if (at === null && chunk.kind !== 'engine') {
        at = await $.clock.now()
      }

      yield chunk
    }

    const result = await stream.result
    const usage = result.usage
    at ??= await $.clock.now()

    if (usage) {
      const sent = usage.input_tokens + usage.output_tokens + usage.cache_creation_input_tokens
      const isMain = e.agentId === undefined

      await update($, tally, t => ({
        tokens: t.tokens + sent,
        lastRequestAt: isMain ? at : t.lastRequestAt,
        cacheTtl: isMain ? cacheTtlOf(usage, t.cacheTtl) : t.cacheTtl,
      }))
    }

    return result
  })

  // /clear and a resume start another conversation in this process: its tokens and cache are new.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, tally, () => EMPTY_TALLY)
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('session.measure', ($, e, next) => {
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Markdown, Text } = $.ui.resolve(e)
    const [t, ws, usage, now, turns] = await Promise.all([
      read($, tally),
      read($, workspace),
      $.session.usage(),
      $.clock.now(),
      $.session.turns(),
    ])
    const { context, rateLimits, startedAt, cost } = usage
    const isNarrow = e.props.bodyColumns < NARROW_COLUMNS

    const Label = ({ children }: { children: string }) => <Text dimColor>{children}</Text>
    const Gap = () => <Text dimColor>{SEP}</Text>

    // One reading: the bold percentage, then a 10-cell bar. Filled and empty cells are the same glyph
    // (so they are the same height), the empty ones in the theme's subtle colour.
    // Everything sits in an explicit row Box: the desktop app stacks loose siblings.
    const Percent = ({ name, value }: { name: string; value: number | undefined }) => {
      if (value === undefined) {
        return <Text>—</Text>
      }

      const filled = filledCells(value)
      const color = level(value)

      return (
        <Box key={`${name}-reading`} flexDirection="row" alignItems="center" columnGap={1}>
          <Text bold color={color}>{`${Math.round(value)}%`}</Text>
          <Box flexDirection="row">
            {filled > 0 ? <Text color={color}>{BAR_GLYPH.repeat(filled)}</Text> : null}
            {filled < BAR_CELLS ? <Text color="subtle">{BAR_GLYPH.repeat(BAR_CELLS - filled)}</Text> : null}
          </Box>
        </Box>
      )
    }

    const windowOf = (kind: string): SessionRateLimit | undefined => rateLimits.find(r => r.kind === kind)
    const five = windowOf('five_hour')
    const week = windowOf('seven_day')
    const untilReset = (iso: string | undefined) =>
      iso === undefined || Number.isNaN(Date.parse(iso)) ? '—' : duration(Date.parse(iso) - now)

    const left = cacheLeft(t, now)
    const cache =
      left === null ? (
        <Box key="cache-reading" flexDirection="row">
          <Label>🔥 Cache </Label>
          <Text>—</Text>
        </Box>
      ) : left > 0 ? (
        <Box key="cache-reading" flexDirection="row">
          <Label>🔥 Cache </Label>
          <Text bold color={cacheLevel(left)}>{duration(left)}</Text>
        </Box>
      ) : (
        <Text color="inactive">🧊 Cold</Text>
      )

    return (
      <Box flexDirection="column">
        {/* Workspace left, session corner right; the corner wraps under only when it does not fit. */}
        <Box key="top" flexDirection="row" flexWrap="wrap" justifyContent="space-between">
          <Box flexDirection="row" alignItems="center">
            {ws ? <Label>📁 </Label> : null}
            {ws ? <Text>{ws.isWorktree ? `${ws.folder} 🌳` : ws.folder}</Text> : null}
            {ws?.git ? <Gap /> : null}
            {ws?.git ? <Label>🌿 </Label> : null}
            {ws?.git ? <Text>{branchLabel(ws.git)}</Text> : null}
          </Box>
          <Box flexDirection="row" alignItems="center">
            <Label>💬 Prompts </Label>
            <Text>{String(turns)}</Text>
            {cost ? <Gap /> : null}
            {cost ? <Label>💵 Cost </Label> : null}
            {cost ? <Text>{price(cost.usd)}</Text> : null}
          </Box>
        </Box>
        {/* The terminal's columns are exact; graphical surfaces draw a markdown rule full width. */}
        {e.surface === 'terminal' ? (
          <Text dimColor>{'─'.repeat(e.props.bodyColumns)}</Text>
        ) : (
          <Markdown text="---" dimColor />
        )}
        <Box flexDirection="row" alignItems="center">
          <Label>🧠 Context </Label>
          <Percent name="context" value={context.percent} />
          <Gap />
          <Text>{`${context.tokens === undefined ? '—' : compactTokens(context.tokens)} / ${compactTokens(context.window)}`}</Text>
        </Box>
        <Box key="limits" flexDirection={isNarrow ? 'column' : 'row'}>
          <Box flexDirection="row" alignItems="center">
            <Label>⏳ 5-hour </Label>
            <Percent name="five" value={five?.percentUsed} />
            {five ? <Text> </Text> : null}
            {five ? <Text dimColor>{`↻ ${untilReset(five.resetsAt)}`}</Text> : null}
          </Box>
          {isNarrow ? null : <Gap />}
          <Box flexDirection="row" alignItems="center">
            <Label>📅 Week </Label>
            <Percent name="week" value={week?.percentUsed} />
            {week ? <Text> </Text> : null}
            {week ? <Text dimColor>{`↻ ${resetMoment(week.resetsAt, now)}`}</Text> : null}
          </Box>
        </Box>
        <Box flexDirection="row" alignItems="center">
          {cache}
          <Gap />
          <Label>⏱️ Session </Label>
          <Text>{duration(now - startedAt)}</Text>
          <Gap />
          <Label>🪙 Tokens </Label>
          <Text>{compactTokens(t.tokens)}</Text>
        </Box>
      </Box>
    )
  })
}
