import { expect, mock, test } from 'claude-code/testing'
import type { SessionUsage, TurnStepResult, TurnUsage } from 'claude-code'

import { FILLED_PATHS, ICON_COLOURS, ICON_PX, dividerSvg, iconSvg, type IconName } from './icons'

const NOW = Date.UTC(2026, 10, 25, 12, 0)
const SURFACES = ['terminal', 'desktop'] as const

const FULL: SessionUsage = {
  startedAt: NOW - 7_620_000,
  context: { tokens: 420_000, window: 1_000_000, percent: 42 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 63, resetsAt: new Date(NOW + 6_720_000).toISOString() },
    { kind: 'seven_day', percentUsed: 28, resetsAt: new Date(2026, 10, 26, 9, 0).toISOString() },
  ],
}

const EMPTY: SessionUsage = { startedAt: NOW, context: { window: 1_000_000 }, rateLimits: [] }

const USAGE: TurnUsage = {
  input_tokens: 100,
  output_tokens: 50,
  cache_creation_input_tokens: 1_000,
  cache_read_input_tokens: 90_000,
  ephemeral_5m_input_tokens: 0,
  ephemeral_1h_input_tokens: 1_000,
  model: 'm',
}

// All of the band's words in drawing order.
// An icon drawn as an Svg (desktop) reads as its alt, the emoji the terminal shows in its place.
const allText = async (ui: any) =>
  (await ui.findAll({}))
    .map((el: any) => (el.type === 'Text' ? el.text : el.type === 'Svg' ? String(el.props.alt) : ''))
    .join('')

const band = (surface: (typeof SURFACES)[number], hasSurvey = false) => ({
  plugin: 'usage-band',
  surface,
  component: 'AbovePrompt',
  props: {
    hasSurvey,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
}) as const

const GIT_DIRS_MAIN = '/repo/.git\n/repo/.git\n'
const GIT_DIRS_WORKTREE = '/repo/.git/worktrees/wt\n/repo/.git\n'

/**
 * A repository as the test's git sees it; null = not a repository.
 * `branch` null = detached HEAD; `upstream` null = no upstream; `counts` = `git rev-list --left-right
 * --count @{upstream}...HEAD` output ("behind\tahead").
 */
type Repo = { branch: string | null; upstream: string | null; counts: string; dirs: string } | null

const MAIN: Repo = { branch: 'main', upstream: 'origin/main', counts: '1\t2\n', dirs: GIT_DIRS_MAIN }

// Answers one git command the way git would for `repo`: exit code and stdout.
const gitAnswer = (repo: Repo, argv: string[]): { exitCode: number; stdout: string } => {
  if (repo === null) return { exitCode: 128, stdout: '' }
  if (argv.includes('symbolic-ref')) return repo.branch ? { exitCode: 0, stdout: `${repo.branch}\n` } : { exitCode: 1, stdout: '' }
  if (argv.includes('rev-list')) return repo.upstream ? { exitCode: 0, stdout: repo.counts } : { exitCode: 128, stdout: '' }
  if (argv.some(a => a.includes('@{upstream}'))) return repo.upstream ? { exitCode: 0, stdout: `${repo.upstream}\n` } : { exitCode: 128, stdout: '' }
  if (argv.includes('--git-dir')) return { exitCode: 0, stdout: repo.dirs }
  return { exitCode: 129, stdout: '' } // a command the band should not run
}

// Stands for the engine: /cost figures, the session's id, directory, model and prompt count, git, and
// the plugin's store (kept between sessions). Returns that store, so a test can read what was saved.
const answerUsage = (
  on: any,
  usage: SessionUsage,
  {
    cwd = '/Users/me/repos/my-app',
    model = 'claude-opus-5-5',
    turns = 12,
    git = () => MAIN,
    sessionId = () => 's1',
    stored = {},
  }: {
    cwd?: string
    model?: string
    turns?: number
    git?: (argv: string[], env: Record<string, string> | undefined) => Repo
    sessionId?: () => string
    stored?: Record<string, unknown>
  } = {},
) => {
  const store = new Map<string, unknown>(Object.entries(stored))

  on('session.usage', () => ({ value: usage }))
  on('session.id', () => ({ value: sessionId() }))
  on('session.cwd', () => ({ value: cwd }))
  on('session.model', () => ({ value: model }))
  on('session.turns', () => ({ value: turns }))
  on('store.get', (_: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: any, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_: any, e: any) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('process.run', (_: any, e: any) => {
    const { exitCode, stdout } = gitAnswer(git([...e.argv], e.init?.env), [...e.argv])

    return {
      value: {
        exitCode,
        stdout,
        stderr: exitCode === 0 ? '' : 'fatal',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', (_: any, e: any) => ({ sessionId: e.sessionId }))
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))

  return store
}

const startSession = ($: any) => $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

// Stands for the API answering one request, then runs it through the plugin.
const runStep = async ($: any, on: any, usage: TurnUsage | null, agentId?: string) => {
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage } as TurnStepResult
  })
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of stream) {
    // drain
  }
  return stream.result
}

test('draws three rows from the usage figures', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

    expect(await text(/Context/)).toBe('Context')
    expect(await text(/42%/)).toBe('42%')
    expect(await text(/\/ 1M/)).toBe('420k / 1M')
    expect(await text(/5-hour/)).toBe('5-hour')
    expect(await text(/63%/)).toBe('63%')
    expect(await text(/1h52m/)).toBe('↻ 1h52m')
    expect(await text(/Week/)).toBe('Week')
    expect(await text(/28%/)).toBe('28%')
    expect(await text(/09:00/)).toBe('↻ Thu 09:00')
    expect(await text(/Session/)).toBe('Session')
    expect(await text(/^2h07m$/)).toBe('2h07m')
    await ui.unmount()
  }
})

test('percentages are bold and take their level colour', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, {
    ...FULL,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 80, resetsAt: new Date(NOW + 6_720_000).toISOString() },
      { kind: 'seven_day', percentUsed: 95, resetsAt: new Date(NOW + 86_400_000).toISOString() },
    ],
  })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))

    for (const [re, color] of [[/^42%$/, '#5B9DF5'], [/^80%$/, 'warning'], [/^95%$/, 'error']] as const) {
      const found = await ui.find({ type: 'Text', text: re })
      expect(found?.props.bold).toBe(true)
      expect(found?.props.color).toBe(color)
    }
    await ui.unmount()
  }
})

test('shows dashes before any reading', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

    expect(await text(/\/ 1M/)).toBe('— / 1M')
    expect(await text(/Cache/)).toBe('Cache')
    expect(await allText(ui)).toContain('Tokens 0')
    expect(await text(/%/)).toBe(undefined)
    await ui.unmount()
  }
})

test('a main-thread step warms the cache and counts tokens without cache reads', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY)
  await runStep($, on, USAGE)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

    expect(await allText(ui)).toContain('Tokens 1k')
    expect(await text(/Cache/)).toBe('Cache')
    expect(await text(/^1h00m$/)).toBe('1h00m')
    await ui.unmount()
  }
})

test('a subagent step counts tokens but leaves the cache timer alone', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY)
  await runStep($, on, USAGE, 'a1')

  const ui = await $.ui.mount(band('desktop'))
  expect(await allText(ui)).toContain('Tokens 1k')
  expect((await ui.find({ type: 'Text', text: /Cache/ }))?.text).toBe('Cache')
  expect(await ui.find({ type: 'Text', text: /^\d+[smhd]/ })).toBe(undefined)
  await ui.unmount()
})

test('the cache goes cold after its lifetime', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY)
  await runStep($, on, { ...USAGE, ephemeral_5m_input_tokens: 1_000, ephemeral_1h_input_tokens: 0 })
  await clock.advance(301_000)

  const ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Text', text: /Cold/ }))?.text).toBe('Cold')
  await ui.unmount()
})

test('a step with no usage changes nothing', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY)
  await runStep($, on, null)

  const ui = await $.ui.mount(band('desktop'))
  expect(await allText(ui)).toContain('Tokens 0')
  expect((await ui.find({ type: 'Text', text: /Cache/ }))?.text).toBe('Cache')
  expect(await ui.find({ type: 'Text', text: /^\d+[smhd]/ })).toBe(undefined)
  await ui.unmount()
})

test('a reset time already past reads now', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, {
    ...FULL,
    rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(NOW - 1_000).toISOString() }],
  })

  const ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Text', text: /↻/ }))?.text).toBe('↻ now')
  await ui.unmount()
})

test('yields the band to a survey', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL)
  // Stands for the engine drawing the survey in the band.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>survey</Text>
  })

  const ui = await $.ui.mount(band('desktop', true))
  expect(await ui.find({ type: 'Text', text: /Context/ })).toBe(undefined)
  await ui.unmount()
})

test('/clear starts the tally over', async ($, on) => {
  mock.clock(on, { now: NOW })
  let id = 's1'
  answerUsage(on, EMPTY, { sessionId: () => id })
  await runStep($, on, USAGE)
  id = 's2' // /clear gives the conversation a new session id
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} as any })

  const ui = await $.ui.mount(band('desktop'))
  expect(await allText(ui)).toContain('Tokens 0')
  expect((await ui.find({ type: 'Text', text: /Cache/ }))?.text).toBe('Cache')
  expect(await ui.find({ type: 'Text', text: /^\d+[smhd]/ })).toBe(undefined)
  await ui.unmount()
})

test('leaving the session keeps the tally', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY)
  await runStep($, on, USAGE)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: {} as any })

  const ui = await $.ui.mount(band('desktop'))
  expect(await allText(ui)).toContain('Tokens 1k')
  await ui.unmount()
})

test('a weekly reset already past reads now', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, {
    ...FULL,
    rateLimits: [{ kind: 'seven_day', percentUsed: 100, resetsAt: new Date(NOW - 1_000).toISOString() }],
  })

  const ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Text', text: /↻/ }))?.text).toBe('↻ now')
  await ui.unmount()
})

/** The element keyed `key` in a drawn tree, searched depth first. */
const byKey = (node: any, key: string): any => {
  if (node?.props?.key === key) {
    return node
  }
  for (const child of node?.children ?? []) {
    const hit = byKey(child, key)
    if (hit) {
      return hit
    }
  }
  return undefined
}

/** Every Box under `node` (itself included) that has a fixed width, in drawing order. */
const sizedBoxes = (node: any): any[] => [
  ...(node?.type === 'Box' && node.props.width !== undefined ? [node] : []),
  ...(node?.children ?? []).flatMap(sizedBoxes),
]

test('each bar row carries a session reading on its right; narrow, those get a row of their own', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL)

  for (const surface of SURFACES) {
    const wide = await $.ui.mount(band(surface))
    const tree = await wide.drawn()
    for (const [i, bar, reading] of [[0, 'context', 'cache'], [1, 'five', 'session'], [2, 'week', 'tokens']] as const) {
      const row = byKey(tree, `usage-row-${i}`)
      expect(row?.props.flexDirection).toBe('row')
      expect(row?.props.justifyContent).toBe('space-between')
      expect(byKey(row, `${bar}-reading`)).not.toBe(undefined)
      expect(byKey(row, `${reading}-reading`)).not.toBe(undefined)
    }
    expect(byKey(tree, 'session-row')).toBe(undefined)
    await wide.unmount()

    const target = band(surface)
    const narrow = await $.ui.mount({ ...target, props: { ...target.props, bodyColumns: 50 } })
    const narrowTree = await narrow.drawn()
    expect(byKey(narrowTree, 'usage-row-0')).toBe(undefined)
    expect(byKey(narrowTree, 'session-row')?.props.flexDirection).toBe('row')
    expect(await allText(narrow)).toContain('Cache —    │    ⏱️ Session')
    await narrow.unmount()
  }
})

test('labels, percentages and bars line up in columns across the three rows', async ($, on) => {
  mock.clock(on, { now: NOW })
  // The 5-hour window has no reading: its row still keeps every column in place.
  answerUsage(on, { ...FULL, rateLimits: FULL.rateLimits.filter(r => r.kind !== 'five_hour') })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    const tree = await ui.drawn()
    for (const name of ['context', 'five', 'week']) {
      const cells = sizedBoxes(byKey(tree, `${name}-reading`))
      expect(cells.map(c => [c.props.width, c.props.justifyContent])).toEqual([[10, 'flex-start'], [4, 'flex-start']])
    }
    for (const name of ['cache', 'session', 'tokens']) {
      expect(sizedBoxes(byKey(tree, `${name}-reading`)).map(c => c.props.width)).toEqual([10, 5])
    }
    expect(await allText(ui)).toMatch(/⏳ 5-hour — ▰{10}/)
    await ui.unmount()
  }
})

test('the cache timer starts when the answer arrives, not when a retried request began', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY)
  // Stands for the API: a retry backoff of two minutes, then the answer streams.
  on('turn.step', async function* () {
    await clock.advance(120_000)
    yield { kind: 'text', index: 0, text: 'hi' }
    return {
      turnId: 't', index: 0, answer: 'hi', toolUses: [], stopReason: 'end_turn',
      usage: { ...USAGE, ephemeral_5m_input_tokens: 1_000, ephemeral_1h_input_tokens: 0 },
    } as TurnStepResult
  })
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })
  for await (const _ of stream) {
    // drain
  }

  const ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Text', text: /^5m$/ }))?.text).toBe('5m')
  await ui.unmount()
})

test('each reading sits on one line with a bar of equal segments', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))

    // Bars in drawing order: context, 5-hour, week; each a filled run then an empty run.
    const runs = await ui.findAll({ type: 'Text', text: /^▰+$/ })
    expect(runs.map(r => [r.text.length, r.props.color])).toEqual([
      [4, '#5B9DF5'], [6, 'subtle'],
      [6, '#5B9DF5'], [4, 'subtle'],
      [3, '#5B9DF5'], [7, 'subtle'],
    ])
    for (const name of ['context', 'five', 'week']) {
      expect((await ui.find({ type: 'Box', key: `${name}-reading` }))?.props.flexDirection).toBe('row')
    }
    expect(await ui.find({ type: 'Text', text: /▱/ })).toBe(undefined)
    await ui.unmount()
  }
})

test('the week reading has a calendar', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL)

  for (const bodyColumns of [120, 50]) {
    const target = band('desktop')
    const ui = await $.ui.mount({ ...target, props: { ...target.props, bodyColumns } })
    expect((await ui.find({ type: 'Text', text: /Week/ }))?.text).toBe('Week')
    await ui.unmount()
  }
})

test('the cache countdown turns yellow at 20 minutes and red at 10', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY)
  await runStep($, on, USAGE) // a 1-hour cache

  const colourOf = async (countdown: string) => {
    const ui = await $.ui.mount(band('desktop'))
    const color = (await ui.find({ type: 'Text', text: new RegExp(`^${countdown}$`) }))?.props.color
    await ui.unmount()
    return color
  }

  expect(await colourOf('1h00m')).toBe('#5B9DF5')
  await clock.advance(40 * 60_000)
  expect(await colourOf('20m')).toBe('warning')
  await clock.advance(10 * 60_000)
  expect(await colourOf('10m')).toBe('error')
})

test('Cache and Session are dim labels like Context', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))

    for (const label of [/Context/, /Cache/, /Session/]) {
      expect((await ui.find({ type: 'Text', text: label }))?.props.dimColor).toBe(true)
    }
    await ui.unmount()
  }
})

test('the cache reading is one row before any request', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY)

  const ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Box', key: 'cache-reading' }))?.props.flexDirection).toBe('row')
  await ui.unmount()
})

test('the cache reading is one row while warm', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY)
  await runStep($, on, USAGE)

  const ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Box', key: 'cache-reading' }))?.props.flexDirection).toBe('row')
  await ui.unmount()
})

test('the cache countdown is bold like the percentages', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY)
  await runStep($, on, USAGE)

  const ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Text', text: /^1h00m$/ }))?.props.bold).toBe(true)
  await ui.unmount()
})

const ICONS: [string, string][] = [
  ['📁', 'folder'], ['🌿', 'branch'], ['💬', 'prompts'], ['💵', 'cost'], ['🧠', 'context'],
  ['⏳', 'fiveHour'], ['📅', 'week'], ['🔥', 'cache'], ['⏱️', 'session'], ['🪙', 'tokens'],
]

test('on desktop every label icon is a Material Symbols Svg, its emoji kept as alt text', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, { ...FULL, cost: { usd: 1 } })
  await runStep($, on, USAGE)
  await startSession($)

  const ui = await $.ui.mount(band('desktop'))
  const svgs = (await ui.findAll({ type: 'Svg' })).filter((s: any) => s.props.alt !== '│') // label icons only
  expect(svgs.map((s: any) => s.props.alt).sort()).toEqual(ICONS.map(([emoji]) => emoji).sort())
  for (const [emoji, name] of ICONS) {
    const svg = svgs.find((s: any) => s.props.alt === emoji)
    expect(svg?.props.source).toBe(iconSvg(name as IconName))
    expect(svg?.props.width).toBe(ICON_PX)
    expect(svg?.props.height).toBe(ICON_PX)
  }
  // No emoji left in the text on desktop.
  expect(await ui.find({ type: 'Text', text: /[📁🌿💬💵🧠⏳📅🔥⏱🪙🧊]/u })).toBe(undefined)
  await ui.unmount()
})

test('in the terminal, which has no Svg, the labels keep their emoji', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, { ...FULL, cost: { usd: 1 } })
  await runStep($, on, USAGE)
  await startSession($)

  const ui = await $.ui.mount(band('terminal'))
  const words = await allText(ui)
  for (const [emoji] of ICONS) {
    expect(words).toContain(emoji)
  }
  await ui.unmount()
})

test('a cold cache shows the snowflake icon', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY)
  await runStep($, on, { ...USAGE, ephemeral_5m_input_tokens: 1_000, ephemeral_1h_input_tokens: 0 })
  await clock.advance(301_000)

  const ui = await $.ui.mount(band('desktop'))
  const svg = (await ui.findAll({ type: 'Svg' })).find((s: any) => s.props.alt === '🧊')
  expect(svg?.props.source).toBe(iconSvg('cold'))
  expect(await allText(ui)).toContain('🧊 Cold')
  await ui.unmount()
})

test('an icon is the filled symbol in its own colour for each scheme, and carries only its path', async () => {
  const svg = iconSvg('context')
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"')).toBe(true)
  expect(svg).toContain(`d="${FILLED_PATHS.context}"`)
  expect(svg).toContain(`fill:${ICON_COLOURS.context.dark}`)
  expect(svg).toContain(`@media (prefers-color-scheme: light){path{fill:${ICON_COLOURS.context.light}}}`)
  expect(svg).not.toMatch(/<script|href|url\(/i)
})

test('the icons use the owner-chosen palette', async () => {
  expect(ICON_COLOURS.folder).toEqual({ dark: '#E8A54B', light: '#B7752A' }) // orange-yellow
  expect(ICON_COLOURS.branch).toEqual({ dark: '#5B9DF5', light: '#2F6FD6' }) // the band's blue
  expect(ICON_COLOURS.prompts).toEqual({ dark: '#4DB6C4', light: '#237F8C' }) // cyan-leaning teal
  expect(ICON_COLOURS.fiveHour).toEqual({ dark: '#D9B98A', light: '#9C7A45' }) // sand
  expect(ICON_COLOURS.week).toEqual({ dark: '#F07A9A', light: '#C2456A' }) // pink-red
  expect(ICON_COLOURS.cache).toEqual({ dark: '#F26B4F', light: '#C8432F' }) // red
  expect(ICON_COLOURS.session).toEqual({ dark: '#7A7A7A', light: '#4A4A4A' }) // dark grey
})

test('the cache flame stays red however much time is left', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY)
  await runStep($, on, USAGE) // a 1-hour cache

  const flame = async () => {
    const ui = await $.ui.mount(band('desktop'))
    const source = (await ui.findAll({ type: 'Svg' })).find((s: any) => s.props.alt === '🔥')?.props.source
    await ui.unmount()
    return source
  }

  expect(await flame()).toBe(iconSvg('cache'))
  await clock.advance(55 * 60_000) // 5m left
  expect(await flame()).toBe(iconSvg('cache'))
})

test('a cold cache is grey, apart from the blue of a calm reading', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY)
  await runStep($, on, { ...USAGE, ephemeral_5m_input_tokens: 1_000, ephemeral_1h_input_tokens: 0 })
  await clock.advance(301_000)

  const ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Text', text: /Cold/ }))?.props.color).toBe('inactive')
  await ui.unmount()
})

test('the right column reads Cache, Session, then Tokens with a dim label', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    expect(await allText(ui)).toMatch(/Cache .*Session .*Tokens 0$/)
    expect((await ui.find({ type: 'Text', text: /^Tokens$/ }))?.props.dimColor).toBe(true)
    await ui.unmount()
  }
})

test('the top row shows the workspace and, in the corner, price, prompts and model', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, { ...FULL, cost: { usd: 1.8449 } })
  await startSession($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    const words = await allText(ui)

    expect(words).toContain('📁 my-app')
    expect(words).toContain('🌿 main ↑2 ↓1')
    expect(words).toContain('💬 Prompts 12  │  💵 Cost $1.84')
    expect(words).not.toContain('≈')
    expect(words).not.toContain('Model')
    expect(words).not.toContain('🌳')
    expect(words.indexOf('📁')).toBeLessThan(words.indexOf('🧠'))
    for (const label of ['Prompts ', 'Cost ']) {
      expect((await ui.find({ type: 'Text', text: label }))?.props.dimColor).toBe(true)
    }
    await ui.unmount()
  }
})

test('a worktree is marked with a tree', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL, { cwd: '/repo/wt', git: () => ({ ...MAIN, dirs: GIT_DIRS_WORKTREE }) })
  await startSession($)

  const ui = await $.ui.mount(band('desktop'))
  expect(await allText(ui)).toContain('📁 wt 🌳')
  await ui.unmount()
})

test('outside a git repository only the folder shows', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL, { cwd: '/tmp/scratch', git: () => null })
  await startSession($)

  const ui = await $.ui.mount(band('desktop'))
  const words = await allText(ui)
  expect(words).toContain('📁 scratch')
  expect(words).not.toContain('🌿')
  await ui.unmount()
})

test('no cost ledger hides the price', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL)
  await startSession($)

  const ui = await $.ui.mount(band('desktop'))
  const words = await allText(ui)
  expect(words).not.toContain('💵')
  expect(words).toContain('💬 Prompts 12')
  expect(words).not.toContain('│  💵')
  await ui.unmount()
})

test('a divider line spans the band under the top row', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL)
  await startSession($)

  // The terminal's columns are exact: the line is exactly as wide as the band.
  const term = await $.ui.mount(band('terminal'))
  expect((await term.find({ type: 'Text', text: /^─+$/ }))?.text.length).toBe(120)
  await term.unmount()

  // Desktop: a markdown rule, which the app draws full width and centred in its own space, with no
  // characters to count (its font does not match the column count it reports).
  const desk = await $.ui.mount(band('desktop'))
  expect((await desk.find({ type: 'Markdown' }))?.props.text).toBe('---')
  expect(await desk.find({ type: 'Text', text: /^─+$/ })).toBe(undefined)
  await desk.unmount()
})

test('the corner group sits on the right and wraps under the workspace only when it must', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL)
  await startSession($)

  for (const surface of SURFACES) {
    for (const bodyColumns of [120, 80]) {
      const target = band(surface)
      const ui = await $.ui.mount({ ...target, props: { ...target.props, bodyColumns } })
      const top = await ui.find({ type: 'Box', key: 'top' })
      expect(top?.props.flexDirection).toBe('row')
      expect(top?.props.flexWrap).toBe('wrap')
      expect(top?.props.justifyContent).toBe('space-between')
      await ui.unmount()
    }
  }
})

test('a Bash tool call refreshes the branch', async ($, on) => {
  mock.clock(on, { now: NOW })
  let repo: Repo = MAIN
  answerUsage(on, FULL, { git: () => repo })
  on('tool.call', () => ({ result: {} }))
  await startSession($)

  repo = { branch: 'feat/band', upstream: null, counts: '', dirs: GIT_DIRS_MAIN }
  await $.tool.call({ tool: 'Bash', command: 'git switch -c feat/band' })

  const ui = await $.ui.mount(band('desktop'))
  expect(await allText(ui)).toContain('🌿 feat/band (not pushed)')
  await ui.unmount()
})

test('the 30-second tick refreshes the branch', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let repo: Repo = MAIN
  answerUsage(on, FULL, { git: () => repo })
  await startSession($)

  repo = { ...MAIN, counts: '0\t0\n' }
  await clock.advance(30_000)

  const ui = await $.ui.mount(band('desktop'))
  expect(await allText(ui)).toContain('🌿 main ✓')
  await ui.unmount()
})

test('dividers are vertical rules in the top row; the usage rows are columns, not dividers', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, { ...FULL, cost: { usd: 1.8449 } })
  await startSession($)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    const words = await allText(ui)
    expect(words).toContain('📁 my-app  │  🌿 main ↑2 ↓1')
    expect(words).toContain('💬 Prompts 12  │  💵 Cost $1.84')
    expect(words).not.toContain('↻ 1h52m    │')
    expect(words).not.toContain('·')
    await ui.unmount()
  }
})

test('on desktop a divider is a thin Svg line; in the terminal the │ character', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL)

  await startSession($)
  const desk = await $.ui.mount(band('desktop'))
  const rules = (await desk.findAll({ type: 'Svg' })).filter((s: any) => s.props.alt === '│')
  expect(rules.length).toBeGreaterThan(0)
  for (const rule of rules) {
    expect(rule.props.source).toBe(dividerSvg())
  }
  expect(await desk.find({ type: 'Text', text: /│/ })).toBe(undefined)
  await desk.unmount()

  const term = await $.ui.mount(band('terminal'))
  expect(await term.find({ type: 'Text', text: /│/ })).not.toBe(undefined)
  expect((await term.findAll({ type: 'Svg' })).length).toBe(0)
  await term.unmount()
})

test('the divider line is a dim grey in either colour scheme and nothing else', async () => {
  const svg = dividerSvg()
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
  expect(svg).toContain('prefers-color-scheme: light')
  expect(svg).not.toMatch(/<script|href|url\(/i)
})

test('the context bar runs straight into its token count, with no divider', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL)

  const ui = await $.ui.mount(band('desktop'))
  expect(await allText(ui)).toMatch(/🧠 Context 42% ▰{10}  420k \/ 1M/)
  await ui.unmount()
})

test('a reset time sits two spaces after its bar', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL)

  const ui = await $.ui.mount(band('desktop'))
  const words = await allText(ui)
  expect(words).toMatch(/63% ▰{10}  ↻ 1h52m/)
  expect(words).toMatch(/28% ▰{10}  ↻ Thu 09:00/)
  await ui.unmount()
})

test('git is only asked about its records, never the working tree, so repo config cannot run a program', async ($, on) => {
  mock.clock(on, { now: NOW })
  const argvs: string[][] = []
  const envs: (Record<string, string> | undefined)[] = []
  answerUsage(on, FULL, { git: (argv, env) => (argvs.push(argv), envs.push(env), MAIN) })
  await startSession($)

  const ui = await $.ui.mount(band('desktop'))
  expect(await allText(ui)).toContain('🌿 main ↑2 ↓1')
  await ui.unmount()

  // `status`, `diff` and friends refresh the index, which can run a repo's fsmonitor or clean filters.
  const ALLOWED = ['symbolic-ref', 'rev-parse', 'rev-list']
  expect(argvs.length).toBeGreaterThan(0)
  for (const argv of argvs) {
    expect(argv.slice(0, 6)).toEqual(['git', '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never', '--no-optional-locks'])
    expect(ALLOWED).toContain(argv[6])
  }
  // A partial clone would otherwise fetch missing objects (running the repo's transport) to count commits.
  for (const env of envs) {
    expect(env?.GIT_NO_LAZY_FETCH).toBe('1')
  }
})

test('a detached HEAD reads detached', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL, { git: () => ({ branch: null, upstream: null, counts: '', dirs: GIT_DIRS_MAIN }) })
  await startSession($)

  const ui = await $.ui.mount(band('desktop'))
  expect(await allText(ui)).toContain('🌿 detached (not pushed)')
  await ui.unmount()
})

const DAY = 86_400_000
const LIMITS = [
  { kind: 'five_hour', percentUsed: 63, resetsAt: new Date(NOW + 6_720_000).toISOString() },
  { kind: 'seven_day', percentUsed: 28, resetsAt: new Date(2026, 10, 26, 9, 0).toISOString() },
]

test('limits remembered from an earlier session show before the first reply', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY, { stored: { limits: { at: NOW - 60_000, rateLimits: LIMITS } } })
  await startSession($)

  const ui = await $.ui.mount(band('desktop'))
  const words = await allText(ui)
  expect(words).toContain('5-hour 63%')
  expect(words).toContain('Week 28%')
  expect(words).toContain('↻ 1h52m')
  await ui.unmount()
})

test('a remembered window whose reset has passed reads 0%', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY, {
    stored: { limits: { at: NOW - 6 * 3_600_000, rateLimits: [{ kind: 'five_hour', percentUsed: 97, resetsAt: new Date(NOW - 1_000).toISOString() }] } },
  })
  await startSession($)

  const ui = await $.ui.mount(band('desktop'))
  expect(await allText(ui)).toContain('5-hour 0%')
  await ui.unmount()
})

test('live limits win over remembered ones and are remembered for the next session', async ($, on) => {
  mock.clock(on, { now: NOW })
  const live = { ...FULL, rateLimits: [{ kind: 'five_hour', percentUsed: 70, resetsAt: LIMITS[0]!.resetsAt }] }
  const store = answerUsage(on, live, { stored: { limits: { at: NOW - 60_000, rateLimits: LIMITS } } })
  await startSession($)
  await $.session.measure({ context: live.context, rateLimits: live.rateLimits, changed: ['rateLimits'] })

  const ui = await $.ui.mount(band('desktop'))
  expect(await allText(ui)).toContain('5-hour 70%')
  await ui.unmount()
  expect(store.get('limits')).toEqual({ at: NOW, rateLimits: live.rateLimits })
})

test('a session saves its tokens and cache timer after each reply', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = answerUsage(on, EMPTY, { sessionId: () => 'abc' })
  await runStep($, on, USAGE)

  expect(store.get('session:abc')).toEqual({
    tally: { tokens: 1_150, lastRequestAt: NOW, cacheTtl: '1h' },
    savedAt: NOW,
  })
})

test('resuming a saved session shows its tokens and a still-warm cache', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY, {
    sessionId: () => 'abc',
    stored: { 'session:abc': { tally: { tokens: 254_000, lastRequestAt: NOW - 20 * 60_000, cacheTtl: '1h' }, savedAt: NOW - 20 * 60_000 } },
  })
  await startSession($)

  const ui = await $.ui.mount(band('desktop'))
  const words = await allText(ui)
  expect(words).toContain('Tokens 254k')
  expect(words).toContain('Cache 40m')
  await ui.unmount()
})

test('resuming a saved session whose cache has expired shows cold', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY, {
    sessionId: () => 'abc',
    stored: { 'session:abc': { tally: { tokens: 9_000, lastRequestAt: NOW - 2 * 3_600_000, cacheTtl: '1h' }, savedAt: NOW - 2 * 3_600_000 } },
  })
  await startSession($)

  const ui = await $.ui.mount(band('desktop'))
  const words = await allText(ui)
  expect(words).toContain('Tokens 9k')
  expect(words).toContain('🧊 Cold')
  await ui.unmount()
})

test('a damaged saved entry is ignored', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, EMPTY, { sessionId: () => 'abc', stored: { 'session:abc': { tally: 'nope' }, limits: 42 } })
  await startSession($)

  const ui = await $.ui.mount(band('desktop'))
  const words = await allText(ui)
  expect(words).toContain('Tokens 0')
  expect(words).toContain('5-hour —')
  await ui.unmount()
})

test('saved sessions older than 30 days are dropped at start', async ($, on) => {
  mock.clock(on, { now: NOW })
  const tally = { tokens: 1, lastRequestAt: null, cacheTtl: null }
  const store = answerUsage(on, EMPTY, {
    sessionId: () => 'new',
    stored: {
      'session:old': { tally, savedAt: NOW - 31 * DAY },
      'session:recent': { tally, savedAt: NOW - 2 * DAY },
      limits: { at: NOW - 40 * DAY, rateLimits: LIMITS },
    },
  })
  await startSession($)

  expect(store.has('session:old')).toBe(false)
  expect(store.has('session:recent')).toBe(true)
  expect(store.has('limits')).toBe(true)
})

test('/clear starts the new conversation from zero and saves under its new id', async ($, on) => {
  mock.clock(on, { now: NOW })
  let id = 'first'
  const store = answerUsage(on, EMPTY, { sessionId: () => id })
  await runStep($, on, USAGE)

  id = 'second'
  await $.session.end({ reason: 'clear', sessionId: 'first', resume: {} as any })

  const ui = await $.ui.mount(band('desktop'))
  expect(await allText(ui)).toContain('Tokens 0')
  await ui.unmount()
  expect((store.get('session:first') as any)?.tally.tokens).toBe(1_150)
})

test('an in-process resume restores the resumed session', async ($, on) => {
  mock.clock(on, { now: NOW })
  let id = 'current'
  answerUsage(on, EMPTY, {
    sessionId: () => id,
    stored: { 'session:older': { tally: { tokens: 77_000, lastRequestAt: null, cacheTtl: null }, savedAt: NOW - DAY } },
  })
  await startSession($)

  id = 'older'
  await $.session.end({ reason: 'resume', sessionId: 'current', resume: {} as any })

  const ui = await $.ui.mount(band('desktop'))
  expect(await allText(ui)).toContain('Tokens 77k')
  await ui.unmount()
})

test('on Windows the folder is the last folder of the path, not the whole path', async ($, on) => {
  mock.clock(on, { now: NOW })
  answerUsage(on, FULL, { cwd: 'C:\\Users\\me\\repos\\my-app' })
  await startSession($)

  const ui = await $.ui.mount(band('desktop'))
  const words = await allText(ui)
  expect(words).toContain('📁 my-app')
  expect(words).not.toContain('C:\\')
  await ui.unmount()
})
