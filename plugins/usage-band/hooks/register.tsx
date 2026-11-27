import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionRateLimit } from 'claude-code'

import type { StoredLimits, Tally, Workspace } from '../types'
import {
  asSavedSession,
  asStoredLimits,
  branchLabel,
  folderName,
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
import { DIVIDER_PX, ICON_PX, dividerSvg, iconSvg, type IconColour, type IconName } from './icons'

/**
 * usage-band: a band above the prompt.
 *   top. workspace (folder, worktree mark, branch and its sync) | prompts, cost — then a divider
 *   then three rows in aligned columns — label | percent | bar | detail ······ session reading:
 *   1. context window (tokens in the window / window size)    ······ prompt-cache countdown (main thread)
 *   2. 5-hour limit (time to reset)                            ······ session time
 *   3. weekly limit (reset moment)                             ······ tokens sent and received (no cache reads)
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
  const folder = folderName(cwd)
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
/** Below this many cells a bar row and a session reading no longer fit side by side: the session readings get their own row. */
const NARROW_COLUMNS = 64
/** Icon and label of a bar row ("🧠 Context "), so the percentages start in one column. */
const LABEL_CELLS = 11
/** The percentage ("100%"), right-aligned, so the bars start in one column. */
const PERCENT_CELLS = 4
/** Icon and label of a session reading ("⏱️ Session "), so their values start in one column. */
const SESSION_LABEL_CELLS = 11
/** A whole session reading: label cell and the longest value ("1h52m"). */
const SESSION_CELLS = 18
const SEP_PAD = '    '
/** The top row (workspace, prompts, cost) is denser: a tighter divider. */
const HEADER_PAD = '  '
/** Between a bar and its detail (a reset time, the context token count). */
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
    // A divider between readings: a vertical rule. A thin Svg line where Svg can be drawn, else the │ character.
    const Rule = ({ pad }: { pad: string }) =>
      Svg ? (
        <Box flexDirection="row" alignItems="center">
          <Text>{pad}</Text>
          <Svg source={dividerSvg()} alt="│" width={3} height={DIVIDER_PX} />
          <Text>{pad}</Text>
        </Box>
      ) : (
        <Text dimColor>{`${pad}│${pad}`}</Text>
      )
    const Gap = () => <Rule pad={SEP_PAD} />
    const HeaderGap = () => <Rule pad={HEADER_PAD} />

    // A fixed-width cell, so the same column lines up on every row whatever the label or value.
    const Cell = ({ width, right, children }: { width: number; right?: boolean; children: RenderChildren }) => (
      <Box flexDirection="row" alignItems="center" width={width} justifyContent={right ? 'flex-end' : 'flex-start'}>
        {children}
      </Box>
    )

    // One bar row: icon and label | the bold percentage, right-aligned | a 10-cell bar | a detail.
    // Filled and empty cells are the same glyph (so they are the same height), the empty ones in the
    // theme's subtle colour; with no reading yet, "—" and an all-empty bar keep the columns in place.
    // Everything sits in an explicit row Box: the desktop app stacks loose siblings.
    const BarRow = ({ name, icon, emoji, label, value, detail }: {
      name: string; icon: IconName; emoji: string; label: string; value: number | undefined; detail: string | null
    }) => {
      const filled = value === undefined ? 0 : filledCells(value)
      const color = value === undefined ? 'subtle' : level(value)

      return (
        <Box key={`${name}-reading`} flexDirection="row" alignItems="center">
          <Cell width={LABEL_CELLS}>
            <Icon name={icon} emoji={emoji} />
            <Label>{`${label} `}</Label>
          </Cell>
          <Cell width={PERCENT_CELLS} right>
            {value === undefined ? <Text>—</Text> : <Text bold color={color}>{`${Math.round(value)}%`}</Text>}
          </Cell>
          <Text> </Text>
          <Box flexDirection="row">
            {filled > 0 ? <Text color={color}>{BAR_GLYPH.repeat(filled)}</Text> : null}
            {filled < BAR_CELLS ? <Text color="subtle">{BAR_GLYPH.repeat(BAR_CELLS - filled)}</Text> : null}
          </Box>
          {detail === null ? null : <Text>{AFTER_BAR}</Text>}
          {detail === null ? null : name === 'context' ? <Text>{detail}</Text> : <Text dimColor>{detail}</Text>}
        </Box>
      )
    }

    const windowOf = (kind: string): SessionRateLimit | undefined => rateLimits.find(r => r.kind === kind)
    const five = windowOf('five_hour')
    const week = windowOf('seven_day')
    const untilReset = (iso: string | undefined) =>
      iso === undefined || Number.isNaN(Date.parse(iso)) ? '—' : duration(Date.parse(iso) - now)

    // The session readings: icon and label in a fixed cell, then the value, so they line up as a column.
    const SessionReading = ({ name, icon, emoji, label, children }: {
      name: string; icon: IconName; emoji: string; label: string; children: RenderChildren
    }) => (
      <Box key={`${name}-reading`} flexDirection="row" alignItems="center">
        <Cell width={SESSION_LABEL_CELLS}>
          <Icon name={icon} emoji={emoji} />
          <Label>{`${label} `}</Label>
        </Cell>
        {children}
      </Box>
    )

    const left = cacheLeft(t, now)
    const cache =
      left !== null && left <= 0 ? (
        <Box key="cache-reading" flexDirection="row" alignItems="center">
          <Cell width={SESSION_LABEL_CELLS}>
            <Icon name="cold" emoji="🧊" />
            <Text color="inactive">Cold</Text>
          </Cell>
        </Box>
      ) : (
        <SessionReading name="cache" icon="cache" emoji="🔥" label="Cache">
          {left === null ? <Text>—</Text> : <Text bold color={cacheLevel(left)}>{duration(left)}</Text>}
        </SessionReading>
      )
    const session = (
      <SessionReading name="session" icon="session" emoji="⏱️" label="Session">
        <Text>{duration(now - startedAt)}</Text>
      </SessionReading>
    )
    const tokens = (
      <SessionReading name="tokens" icon="tokens" emoji="🪙" label="Tokens">
        <Text>{compactTokens(t.tokens)}</Text>
      </SessionReading>
    )

    const bars = [
      <BarRow key="context" name="context" icon="context" emoji="🧠" label="Context" value={context.percent}
        detail={`${context.tokens === undefined ? '—' : compactTokens(context.tokens)} / ${compactTokens(context.window)}`} />,
      <BarRow key="five" name="five" icon="fiveHour" emoji="⏳" label="5-hour" value={five?.percentUsed}
        detail={five ? `↻ ${untilReset(five.resetsAt)}` : null} />,
      <BarRow key="week" name="week" icon="week" emoji="📅" label="Week" value={week?.percentUsed}
        detail={week ? `↻ ${resetMoment(week.resetsAt, now)}` : null} />,
    ]
    const sessionReadings = [cache, session, tokens]

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
        {/* Each row: a bar reading left, a session reading pinned right. Narrow, the session readings
            move to a fourth row of their own. */}
        {isNarrow ? (
          <Box key="usage" flexDirection="column">
            {bars}
            <Box key="session-row" flexDirection="row" alignItems="center">
              {cache}
              <Gap />
              {session}
              <Gap />
              {tokens}
            </Box>
          </Box>
        ) : (
          <Box key="usage" flexDirection="column">
            {bars.map((bar, i) => (
              <Box key={`usage-row-${i}`} flexDirection="row" alignItems="center" justifyContent="space-between">
                {bar}
                <Box flexDirection="row" alignItems="center" width={SESSION_CELLS}>
                  {sessionReadings[i]}
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
