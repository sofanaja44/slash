// Harga resmi Claude API per 1 juta token (USD), dari
// https://platform.claude.com/docs/en/about-claude/pricing (dicek 2026-10-02).
// Perbarui tabel ini bila Anthropic mengubah harga.

import { DEFAULT_MODEL_ID, familyOf } from './models'

export type Price = {
  input: number
  /** Tulis cache dengan TTL 5 menit (1,25× input). */
  write5m: number
  /** Tulis cache dengan TTL 1 jam (2× input). */
  write1h: number
  /** Baca cache (hit/refresh). */
  read: number
  output: number
}

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export type CacheTtl = '5m' | '1h'

// Urutan penting: ID yang lebih spesifik dicek lebih dulu.
const PRICES: readonly { pattern: RegExp; price: Price }[] = [
  { pattern: /(fable|mythos)-5-1/, price: { input: 10, write5m: 12.5, write1h: 20, read: 0.25, output: 50 } },
  { pattern: /(fable|mythos)-5/, price: { input: 10, write5m: 12.5, write1h: 20, read: 1, output: 50 } },
  { pattern: /opus-5-5/, price: { input: 4, write5m: 5, write1h: 8, read: 0.2, output: 20 } },
  { pattern: /opus-(5|4-[5-8])/, price: { input: 5, write5m: 6.25, write1h: 10, read: 0.5, output: 25 } },
  { pattern: /sonnet-5/, price: { input: 2, write5m: 2.5, write1h: 4, read: 0.2, output: 10 } },
  { pattern: /sonnet-4-[56]/, price: { input: 3, write5m: 3.75, write1h: 6, read: 0.3, output: 15 } },
  { pattern: /haiku-4-5/, price: { input: 1, write5m: 1.25, write1h: 2, read: 0.1, output: 5 } },
]

/** Harga untuk model ID atau alias keluarga (`opus`, `haiku`, ...); null bila tidak dikenal. */
export function priceFor(model: string): Price | null {
  const id = model.toLowerCase()
  for (const row of PRICES) {
    if (row.pattern.test(id)) return row.price
  }
  const family = familyOf(id)
  if (family !== null && id === family) return priceFor(DEFAULT_MODEL_ID[family])
  return null
}

export function writePrice(price: Price, ttl: CacheTtl): number {
  return ttl === '1h' ? price.write1h : price.write5m
}

/** Biaya satu request atau giliran dalam USD; null bila harga model tidak dikenal. */
export function costUsd(usage: Usage, model: string, ttl: CacheTtl = '5m'): number | null {
  const price = priceFor(model)
  if (price === null) return null
  return (
    usage.input_tokens * price.input +
    usage.cache_creation_input_tokens * writePrice(price, ttl) +
    usage.cache_read_input_tokens * price.read +
    usage.output_tokens * price.output
  ) / 1_000_000
}

/** Total token input yang dibawa request: tanpa cache, ditulis, dan dibaca. */
export function contextTokens(usage: Usage): number {
  return usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
}

/** Bagian input yang dibaca dari cache, 0..1; null bila tidak ada input. */
export function cacheHitRate(usage: Usage): number | null {
  const total = contextTokens(usage)
  return total === 0 ? null : usage.cache_read_input_tokens / total
}
