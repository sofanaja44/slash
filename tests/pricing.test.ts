import { expect, test } from 'claude-code/testing'

import { cacheHitRate, costUsd, priceFor } from '../hooks/pricing'

const near = (value: number | null, expected: number): void => {
  expect(value !== null && Math.abs(value - expected) < 1e-9).toBe(true)
}

test('mencocokkan harga per model ID, alias, dan ID bertanggal', () => {
  expect(priceFor('claude-opus-5-5')?.read).toBe(0.2)
  expect(priceFor('claude-opus-4-8')?.input).toBe(5)
  expect(priceFor('claude-sonnet-5-5')?.output).toBe(10)
  expect(priceFor('claude-haiku-4-5-20251001')?.input).toBe(1)
  expect(priceFor('claude-fable-5-1')?.read).toBe(0.25)
  expect(priceFor('claude-fable-5')?.read).toBe(1)
  expect(priceFor('opus')?.input).toBe(4)
  expect(priceFor('gpt-x')).toBe(null)
})

// Contoh di README: konteks 100 ribu token, giliran berikutnya 2 ribu token output.
test('pindah ke model "murah" di tengah percakapan justru lebih mahal', () => {
  const stayOpus = costUsd({ input_tokens: 0, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 0, output_tokens: 2_000 }, 'claude-opus-5-5')
  const toHaiku = costUsd({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 100_000, output_tokens: 2_000 }, 'claude-haiku-4-5')
  const toSonnet = costUsd({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 100_000, output_tokens: 2_000 }, 'claude-sonnet-5-5')
  near(stayOpus, 0.06)
  near(toHaiku, 0.135)
  near(toSonnet, 0.27)
})

test('menghitung hit rate cache dari usage', () => {
  near(cacheHitRate({ input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0, output_tokens: 5 }), 0.9)
  expect(cacheHitRate({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 5 })).toBe(null)
})
