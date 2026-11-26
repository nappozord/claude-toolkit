import { expect, test } from 'claude-code/testing'

import { asSavedSession, folderName, asStoredLimits, branchLabel, isExpired, rememberedLimits, cacheLevel, filledCells, parseCounts, price, cacheLeft, cacheTtlOf, compactTokens, duration, level, resetMoment } from './format'

const usage = (extra: object) => ({
  input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
  model: 'm', ...extra,
})

test('level is blue under 75, yellow from 75, red from 90', async () => {
  expect(level(74.9)).toBe('#5B9DF5')
  expect(level(75)).toBe('warning')
  expect(level(89.9)).toBe('warning')
  expect(level(90)).toBe('error')
  expect(level(100)).toBe('error')
})

test('cacheLevel is blue above 20 minutes left, yellow from 20, red from 10', async () => {
  expect(cacheLevel(20 * 60_000 + 1)).toBe('#5B9DF5')
  expect(cacheLevel(20 * 60_000)).toBe('warning')
  expect(cacheLevel(10 * 60_000 + 1)).toBe('warning')
  expect(cacheLevel(10 * 60_000)).toBe('error')
  expect(cacheLevel(1)).toBe('error')
})

test('filledCells fills one of 10 cells per 10 % and clamps', async () => {
  expect(filledCells(42)).toBe(4)
  expect(filledCells(-5)).toBe(0)
  expect(filledCells(130)).toBe(10)
})

test('compactTokens shortens to k and M', async () => {
  expect(compactTokens(950)).toBe('950')
  expect(compactTokens(1_150)).toBe('1k')
  expect(compactTokens(420_000)).toBe('420k')
  expect(compactTokens(1_000_000)).toBe('1M')
  expect(compactTokens(1_250_000)).toBe('1.3M')
})

test('duration reads like a clock', async () => {
  expect(duration(45_000)).toBe('45s')
  expect(duration(2_280_000)).toBe('38m')
  expect(duration(6_720_000)).toBe('1h52m')
  expect(duration(7_620_000)).toBe('2h07m')
  expect(duration(3_600_000)).toBe('1h00m')
  expect(duration(183_600_000)).toBe('2d3h')
  expect(duration(0)).toBe('now')
  expect(duration(-1)).toBe('now')
})

test('resetMoment gives weekday and local time', async () => {
  const at = new Date(2026, 10, 26, 9, 5) // Thu 26 Nov 2026, 09:05 local
  expect(resetMoment(at.toISOString(), 0)).toBe('Thu 09:05')
  expect(resetMoment(undefined, 0)).toBe('—')
  expect(resetMoment('garbage', 0)).toBe('—')
})

test('cacheLeft counts down from the last request', async () => {
  expect(cacheLeft({ tokens: 0, lastRequestAt: null, cacheTtl: null }, 0)).toBe(null)
  expect(cacheLeft({ tokens: 0, lastRequestAt: 0, cacheTtl: '1h' }, 1_000)).toBe(3_599_000)
  expect(cacheLeft({ tokens: 0, lastRequestAt: 0, cacheTtl: null }, 1_000)).toBe(299_000)
})

test('cacheTtlOf reads the write, else keeps the previous', async () => {
  expect(cacheTtlOf(usage({ ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 0 }), null)).toBe('1h')
  expect(cacheTtlOf(usage({ ephemeral_1h_input_tokens: 10, ephemeral_5m_input_tokens: 3 }), '1h')).toBe('5m')
  expect(cacheTtlOf(usage({}), '1h')).toBe('1h')
  expect(cacheTtlOf(usage({}), null)).toBe('5m')
})

test('parseCounts reads git rev-list --left-right --count @{upstream}...HEAD', async () => {
  expect(parseCounts('1\t2\n')).toEqual({ behind: 1, ahead: 2 })
  expect(parseCounts('0\t0')).toEqual({ behind: 0, ahead: 0 })
  expect(parseCounts('')).toEqual({ behind: 0, ahead: 0 })
  expect(parseCounts('garbage')).toEqual({ behind: 0, ahead: 0 })
})

test('branchLabel shows sync with the remote', async () => {
  expect(branchLabel({ branch: 'main', ahead: 2, behind: 0, hasUpstream: true })).toBe('main ↑2 ↓0')
  expect(branchLabel({ branch: 'main', ahead: 0, behind: 3, hasUpstream: true })).toBe('main ↑0 ↓3')
  expect(branchLabel({ branch: 'main', ahead: 0, behind: 0, hasUpstream: true })).toBe('main ✓')
  expect(branchLabel({ branch: 'feat/x', ahead: 0, behind: 0, hasUpstream: false })).toBe('feat/x (not pushed)')
})

test('price is dollars with two decimals', async () => {
  expect(price(1.8449)).toBe('$1.84')
  expect(price(0)).toBe('$0.00')
  expect(price(123.456)).toBe('$123.46')
})


test('resetMoment uses the 24-hour clock', async () => {
  const at = new Date(2026, 10, 26, 16, 0) // Thu 26 Nov 2026, 4 pm local
  expect(resetMoment(at.toISOString(), 0)).toBe('Thu 16:00')
})

test('asSavedSession accepts only a well-formed saved session', async () => {
  const good = { tally: { tokens: 1200, lastRequestAt: 5, cacheTtl: '1h' }, savedAt: 9 }
  expect(asSavedSession(good)).toEqual(good)
  expect(asSavedSession({ tally: { tokens: 3, lastRequestAt: null, cacheTtl: null }, savedAt: 1 })).not.toBe(null)
  for (const bad of [undefined, null, 7, 'x', {}, { tally: good.tally }, { tally: { tokens: '1' }, savedAt: 1 },
    { tally: { tokens: 1, lastRequestAt: 'x', cacheTtl: null }, savedAt: 1 },
    { tally: { tokens: 1, lastRequestAt: null, cacheTtl: '2h' }, savedAt: 1 }]) {
    expect(asSavedSession(bad)).toBe(null)
  }
})

test('asStoredLimits accepts only well-formed remembered limits', async () => {
  const good = { at: 1, rateLimits: [{ kind: 'five_hour', percentUsed: 63, resetsAt: '2026-11-25T14:00:00.000Z' }] }
  expect(asStoredLimits(good)).toEqual(good)
  expect(asStoredLimits({ at: 1, rateLimits: [{ kind: 'seven_day', percentUsed: 5 }] })).not.toBe(null)
  for (const bad of [undefined, {}, { at: 1 }, { at: 1, rateLimits: 'x' }, { at: 1, rateLimits: [{ kind: 1, percentUsed: 2 }] }]) {
    expect(asStoredLimits(bad)).toBe(null)
  }
})

test('isExpired after 30 days', async () => {
  const DAY = 86_400_000
  expect(isExpired(0, 30 * DAY)).toBe(false)
  expect(isExpired(0, 30 * DAY + 1)).toBe(true)
})

test('rememberedLimits zeroes a window whose reset has passed', async () => {
  const now = Date.UTC(2026, 10, 25, 12)
  const later = new Date(now + 3_600_000).toISOString()
  const earlier = new Date(now - 1).toISOString()
  expect(rememberedLimits([
    { kind: 'five_hour', percentUsed: 63, resetsAt: earlier },
    { kind: 'seven_day', percentUsed: 28, resetsAt: later },
  ], now)).toEqual([
    { kind: 'five_hour', percentUsed: 0 },
    { kind: 'seven_day', percentUsed: 28, resetsAt: later },
  ])
})

test('folderName takes the last folder of a path, with either separator', async () => {
  expect(folderName('/Users/me/repos/my-app')).toBe('my-app')
  expect(folderName('/Users/me/repos/my-app/')).toBe('my-app')
  expect(folderName('C:\\Users\\me\\repos\\my-app')).toBe('my-app')
  expect(folderName('C:\\Users\\me\\repos\\my-app\\')).toBe('my-app')
  expect(folderName('\\\\server\\share\\my-app')).toBe('my-app')
  expect(folderName('C:/Users/me/repos/my-app')).toBe('my-app')
  expect(folderName('C:\\')).toBe('C:')
  expect(folderName('/')).toBe('/')
})
