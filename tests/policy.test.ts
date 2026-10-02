import { expect, test } from 'claude-code/testing'

import { classify } from '../hooks/classify'
import { familyOf, isEffortCacheSafe, isFirstPartyId, shortName } from '../hooks/models'
import { decideSwitch, effortFor, isCacheCold, mainFamilyFor, subagentFamilyFor, switchPenaltyUsd } from '../hooks/policy'

const base = { contextTokens: 0, cacheCold: false, confidence: 0.85, maxSwitchUsd: 0.25, ttl: '1h' } as const

test('cache dingin: turun model boleh dan malah lebih murah', () => {
  const decision = decideSwitch({ ...base, fromModel: 'claude-opus-5-5', toModel: 'claude-haiku-4-5', contextTokens: 100_000, cacheCold: true })
  expect(decision.isSwitch).toBe(true)
  expect(decision.penaltyUsd < 0).toBe(true)
})

test('cache hangat: turun model ditunda', () => {
  const decision = decideSwitch({ ...base, fromModel: 'claude-opus-5-5', toModel: 'claude-haiku-4-5', contextTokens: 100_000 })
  expect(decision.isSwitch).toBe(false)
})

test('cache hangat: naik model hanya bila biaya tulis ulang cache di bawah batas', () => {
  const small = decideSwitch({ ...base, fromModel: 'claude-sonnet-5-5', toModel: 'claude-opus-5-5', contextTokens: 30_000 })
  expect(small.isSwitch).toBe(true)
  const large = decideSwitch({ ...base, fromModel: 'claude-sonnet-5-5', toModel: 'claude-opus-5-5', contextTokens: 200_000 })
  expect(large.isSwitch).toBe(false)
  expect(large.reason).toMatch(/batas/)
})

test('keyakinan rendah tidak mengganti model', () => {
  const decision = decideSwitch({ ...base, fromModel: 'claude-opus-5-5', toModel: 'claude-haiku-4-5', cacheCold: true, confidence: 0.4 })
  expect(decision.isSwitch).toBe(false)
})

test('biaya pindah dihitung dari harga tulis cache model tujuan', () => {
  // 30K token × ($8 tulis 1 jam Opus − $0.20 baca Sonnet) / 1 juta = $0.234
  expect(Math.abs(switchPenaltyUsd(30_000, 'claude-sonnet-5-5', 'claude-opus-5-5', false, '1h') - 0.234) < 1e-9).toBe(true)
})

test('tier menentukan keluarga model dan effort', () => {
  expect(mainFamilyFor(0, { allowFable: false })).toBe('haiku')
  expect(mainFamilyFor(2, { allowFable: false })).toBe('sonnet')
  expect(mainFamilyFor(3, { allowFable: false })).toBe('opus')
  expect(mainFamilyFor(4, { allowFable: false })).toBe('opus')
  expect(mainFamilyFor(4, { allowFable: true })).toBe('fable')
  expect(effortFor(classify('perbaiki typo di README'))).toBe('low')
  expect(effortFor(classify('rancang arsitektur microservices'))).toBe('high')
})

test('subagent Explore tetap di model murah, general-purpose ikut tier', () => {
  const search = classify('Find every place the parseConfig function is called and list the files')
  expect(subagentFamilyFor(search, 'Explore', { allowFable: false })).toBe('haiku')
  const hard = classify('Investigate the root cause of the deadlock in the job scheduler')
  expect(subagentFamilyFor(hard, 'Explore', { allowFable: false })).toBe('sonnet')
  expect(subagentFamilyFor(hard, 'general-purpose', { allowFable: false })).toBe('opus')
})

test('cache dianggap dingin setelah TTL lewat atau belum pernah ada request', () => {
  expect(isCacheCold(null, 0, 60)).toBe(true)
  expect(isCacheCold(0, 59 * 60_000, 60)).toBe(false)
  expect(isCacheCold(0, 61 * 60_000, 60)).toBe(true)
})

test('mengenali keluarga dan format ID model', () => {
  expect(familyOf('claude-opus-5-5')).toBe('opus')
  expect(familyOf('claude-mythos-5-1')).toBe('fable')
  expect(familyOf('gpt-x')).toBe(null)
  expect(isFirstPartyId('claude-haiku-4-5-20251001')).toBe(true)
  expect(isFirstPartyId('anthropic.claude-opus-5-5')).toBe(false)
  expect(isFirstPartyId('claude-opus-4-6[1m]')).toBe(false)
  expect(shortName('claude-opus-5-5')).toBe('opus 5.5')
  expect(shortName('claude-haiku-4-5-20251001')).toBe('haiku 4.5')
  expect(isEffortCacheSafe('claude-sonnet-5-5')).toBe(true)
  expect(isEffortCacheSafe('claude-opus-5')).toBe(false)
})
