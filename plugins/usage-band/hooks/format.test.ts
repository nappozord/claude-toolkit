import { expect, test } from 'claude-code/testing'

import { branchLabel, cacheLevel, filledCells, parseCounts, price, cacheLeft, cacheTtlOf, compactTokens, duration, level, resetMoment } from './format'

const usage = (extra: object) => ({
  input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
  model: 'm', ...extra,
})

test('level is blue under 75, yellow from 75, red from 90', async () => {
  expect(level(74.9)).toBe('suggestion')
  expect(level(75)).toBe('warning')
  expect(level(89.9)).toBe('warning')
  expect(level(90)).toBe('error')
  expect(level(100)).toBe('error')
})

test('cacheLevel is blue above 20 minutes left, yellow from 20, red from 10', async () => {
  expect(cacheLevel(20 * 60_000 + 1)).toBe('suggestion')
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
