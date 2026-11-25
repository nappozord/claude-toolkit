import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { StoredLimits, Tally, Workspace } from '../types'
import {
  asSavedSession,
  asStoredLimits,
  branchLabel,
  cacheLeft,
  cacheLevel,
  cacheTtlOf,
  compactTokens,
  duration,
  filledCells,
  isExpired,
  level,
  parseCounts,
  price,
  rememberedLimits,
  resetMoment,
} from './format'
import { ICON_PX, LEVEL_ICON_COLOURS, iconSvg, type IconColour, type IconName } from './icons'

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
/** The last reading of the account-wide windows, from any session: shown until this one has its own. */
const limits = atom({ plugin: 'usage-band', key: 'limits' } as const, null as StoredLimits | null)

// ── Kept between sessions ($.store, ~/.claude/plugins/store/) ─────────────────────────────────────
// `session:<id>` holds a session's tally so a resume restores it; `limits` the latest window reading.
// Every store call is best-effort: a failure leaves the band as it would be without the store.
const sessionKey = (id: string) => `session:${id}`

/** Saves the current session's tally under its id. */
const saveTally = async ($: EngineInterface, t: Tally): Promise<void> => {
  const [id, now] = await Promise.all([$.session.id(), $.clock.now()])

  await $.store.set(sessionKey(id), { tally: t, savedAt: now })
}

/**
 * Loads the current session's saved tally. Missing or damaged: `otherwise` decides — the empty
 * tally for a conversation that just started, or the one in memory (a hot reload of a session that
 * was running before anything was saved).
 */
const restoreTally = async ($: EngineInterface, otherwise: 'empty' | 'keep'): Promise<void> => {
  const saved = asSavedSession(await $.store.get(sessionKey(await $.session.id())))

  if (saved) {
    await update($, tally, () => saved.tally)
  } else if (otherwise === 'empty') {
    await update($, tally, () => EMPTY_TALLY)
  }
  $.ui.invalidate('ui.render')
}

/** Drops saved sessions older than 30 days, or damaged ones. */
const pruneSaved = async ($: EngineInterface): Promise<void> => {
  const [keys, now] = await Promise.all([$.store.keys(), $.clock.now()])

  for (const key of keys.filter(k => k.startsWith('session:'))) {
    const saved = asSavedSession(await $.store.get(key))

    if (!saved || isExpired(saved.savedAt, now)) {
      await $.store.delete(key)
    }
  }
}

const quietly = (work: Promise<unknown>) => void work.catch(() => undefined)

const GIT_TIMEOUT_MS = 5_000

/** Reads the folder and git state into `workspace`; drawing only ever reads that. */
const refreshWorkspace = async ($: EngineInterface): Promise<void> => {
  const cwd = await $.session.cwd()
  const folder = cwd.split('/').filter(Boolean).pop() ?? cwd
  // The band opens git in whatever folder a session starts in, so it asks git only about its records
  // (HEAD, refs, commits) and never runs `status`, `diff` or anything else that refreshes the index:
  // those can run programs a repository's own config names (fsmonitor, clean filters). fsmonitor is
  // also forced off and optional locks skipped; repo hooks are already off for git a mod runs.
  // No network either: in a partial clone, counting commits could lazily fetch missing objects through
  // a transport the repo's config chooses, so lazy fetch is off and every transport protocol refused.
  const git = async (...args: string[]) => {
    try {
      const argv = ['git', '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never', '--no-optional-locks', ...args]
      const r = await $.process.run(argv, {
        cwd,
        env: { GIT_NO_LAZY_FETCH: '1' },
        timeoutMs: GIT_TIMEOUT_MS,
      })

      return r.exitCode === 0 ? r.stdout : null
    } catch {
      return null
    }
  }
  const [dirs, head, upstream] = await Promise.all([
    git('rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'),
    git('symbolic-ref', '--short', '-q', 'HEAD'),
    git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'),
  ])
  const counts = upstream === null ? null : await git('rev-list', '--left-right', '--count', '@{upstream}...HEAD')
  const [gitDir, commonDir] = (dirs ?? '').trim().split('\n')

  await update($, workspace, () => ({
    folder,
    isWorktree: gitDir !== undefined && commonDir !== undefined && gitDir !== commonDir,
    // Not a repository (or git unreadable): no branch. A detached HEAD has no symbolic ref.
    git:
      dirs === null
        ? null
        : {
            branch: head?.trim() || 'detached',
            ...parseCounts(counts ?? ''),
            hasUpstream: upstream !== null,
          },
  }))
  $.ui.invalidate('ui.render')
}

const TICK_MS = 30_000
const BAR_CELLS = 10
const BAR_GLYPH = '▰'
/** Below this many cells the 5-hour and weekly readings no longer fit one row: they stack. */
const NARROW_COLUMNS = 80
const SEP = '    ·    '
/** The top row (workspace, prompts, cost) is denser: a tighter divider. */
const HEADER_SEP = '  ·  '
/** Between a bar and what follows it (a reset time, the context token count). */
const AFTER_BAR = '  '

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    // A resumed session gets its tokens and cache timer back; every session shows the last known
    // 5-hour and weekly readings until its own first reply brings fresh ones.
    try {
      await restoreTally($, 'keep')
      const remembered = asStoredLimits(await $.store.get('limits'))

      if (remembered) {
        await update($, limits, () => remembered)
      }
      await pruneSaved($)
    } catch {
      // No store: the band simply starts empty.
    }

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

      const next_ = await update($, tally, t => ({
        tokens: t.tokens + sent,
        lastRequestAt: isMain ? at : t.lastRequestAt,
        cacheTtl: isMain ? cacheTtlOf(usage, t.cacheTtl) : t.cacheTtl,
      }))

      try {
        await saveTally($, next_)
      } catch {
        // Not saved: a later resume starts this session from the last saved count.
      }
    }

    return result
  })

  // /clear starts a new conversation in this process, and an in-process resume switches to another:
  // either way the process now runs under another session id, whose saved tally (if any) is loaded.
  on('session.end', async ($, e, next) => {
    const ended = await next(e)

    if (e.reason === 'clear' || e.reason === 'resume') {
      try {
        await restoreTally($, 'empty')
      } catch {
        await update($, tally, () => EMPTY_TALLY)
        $.ui.invalidate('ui.render')
      }
    }

    return ended
  })

  // A measurement with window readings is the freshest: remember it for every later session.
  on('session.measure', async ($, e, next) => {
    if (e.rateLimits.length > 0) {
      const remembered: StoredLimits = {
        at: await $.clock.now(),
        rateLimits: e.rateLimits.map(l =>
          l.resetsAt === undefined
            ? { kind: l.kind, percentUsed: l.percentUsed }
            : { kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt },
        ),
      }

      await update($, limits, () => remembered)
      quietly($.store.set('limits', remembered))
    }
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const elements = $.ui.resolve(e)
    const { Box, Markdown, Text } = elements
    // Graphical surfaces draw Svg; the terminal has none, so there each icon stays an emoji.
    // (Decided by surface: the terminal's table still answers for `Svg`, drawing nothing.)
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
    const [t, ws, remembered, usage, now, turns] = await Promise.all([
      read($, tally),
      read($, workspace),
      read($, limits),
      $.session.usage(),
      $.clock.now(),
      $.session.turns(),
    ])
    const { context, startedAt, cost } = usage
    // This session's own readings once it has them; before its first reply, the last known ones.
    const rateLimits: readonly SessionRateLimit[] =
      usage.rateLimits.length > 0 ? usage.rateLimits : rememberedLimits(remembered?.rateLimits ?? [], now)
    const isNarrow = e.props.bodyColumns < NARROW_COLUMNS

    const Label = ({ children }: { children: string }) => <Text dimColor>{children}</Text>
    // A label's icon: a Material Symbols Svg where it can be drawn (its emoji as the alt text), else the emoji.
    const Icon = ({ name, emoji, colour }: { name: IconName; emoji: string; colour?: IconColour }) =>
      Svg ? (
        <Box flexDirection="row" alignItems="center">
          <Svg source={iconSvg(name, colour)} alt={emoji} width={ICON_PX} height={ICON_PX} />
          <Text> </Text>
        </Box>
      ) : (
        <Text dimColor>{`${emoji} `}</Text>
      )
    const Gap = () => <Text dimColor>{SEP}</Text>
    const HeaderGap = () => <Text dimColor>{HEADER_SEP}</Text>

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
          <Icon name="cache" emoji="🔥" />
          <Label>Cache </Label>
          <Text>—</Text>
        </Box>
      ) : left > 0 ? (
        <Box key="cache-reading" flexDirection="row">
          <Icon name="cache" emoji="🔥" colour={LEVEL_ICON_COLOURS[cacheLevel(left)]} />
          <Label>Cache </Label>
          <Text bold color={cacheLevel(left)}>{duration(left)}</Text>
        </Box>
      ) : (
        <Box flexDirection="row" alignItems="center">
          <Icon name="cold" emoji="🧊" />
          <Text color="inactive">Cold</Text>
        </Box>
      )

    return (
      <Box flexDirection="column">
        {/* Workspace left, session corner right; the corner wraps under only when it does not fit. */}
        <Box key="top" flexDirection="row" flexWrap="wrap" justifyContent="space-between">
          <Box flexDirection="row" alignItems="center">
            {ws ? <Icon name="folder" emoji="📁" /> : null}
            {ws ? <Text>{ws.isWorktree ? `${ws.folder} 🌳` : ws.folder}</Text> : null}
            {ws?.git ? <HeaderGap /> : null}
            {ws?.git ? <Icon name="branch" emoji="🌿" /> : null}
            {ws?.git ? <Text>{branchLabel(ws.git)}</Text> : null}
          </Box>
          <Box flexDirection="row" alignItems="center">
            <Icon name="prompts" emoji="💬" />
            <Label>Prompts </Label>
            <Text>{String(turns)}</Text>
            {cost ? <HeaderGap /> : null}
            {cost ? <Icon name="cost" emoji="💵" /> : null}
            {cost ? <Label>Cost </Label> : null}
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
          <Icon name="context" emoji="🧠" />
          <Label>Context </Label>
          <Percent name="context" value={context.percent} />
          <Text>{AFTER_BAR}</Text>
          <Text>{`${context.tokens === undefined ? '—' : compactTokens(context.tokens)} / ${compactTokens(context.window)}`}</Text>
        </Box>
        <Box key="limits" flexDirection={isNarrow ? 'column' : 'row'}>
          <Box flexDirection="row" alignItems="center">
            <Icon name="fiveHour" emoji="⏳" />
            <Label>5-hour </Label>
            <Percent name="five" value={five?.percentUsed} />
            {five ? <Text>{AFTER_BAR}</Text> : null}
            {five ? <Text dimColor>{`↻ ${untilReset(five.resetsAt)}`}</Text> : null}
          </Box>
          {isNarrow ? null : <Gap />}
          <Box flexDirection="row" alignItems="center">
            <Icon name="week" emoji="📅" />
            <Label>Week </Label>
            <Percent name="week" value={week?.percentUsed} />
            {week ? <Text>{AFTER_BAR}</Text> : null}
            {week ? <Text dimColor>{`↻ ${resetMoment(week.resetsAt, now)}`}</Text> : null}
          </Box>
        </Box>
        <Box flexDirection="row" alignItems="center">
          {cache}
          <Gap />
          <Icon name="session" emoji="⏱️" />
          <Label>Session </Label>
          <Text>{duration(now - startedAt)}</Text>
          <Gap />
          <Icon name="tokens" emoji="🪙" />
          <Label>Tokens </Label>
          <Text>{compactTokens(t.tokens)}</Text>
        </Box>
      </Box>
    )
  })
}
