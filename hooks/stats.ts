// Akumulasi pemakaian token per keluarga model dan format angka untuk tampilan.

import type { Usage } from './pricing'

export type Totals = {
  turns: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number
}

export const EMPTY_TOTALS: Totals = { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0 }

export function addTurn(totals: Totals | undefined, usage: Usage, usd: number): Totals {
  const base = totals ?? EMPTY_TOTALS
  return {
    turns: base.turns + 1,
    input: base.input + usage.input_tokens,
    output: base.output + usage.output_tokens,
    cacheRead: base.cacheRead + usage.cache_read_input_tokens,
    cacheWrite: base.cacheWrite + usage.cache_creation_input_tokens,
    usd: base.usd + usd,
  }
}

export function hitRateOf(totals: Totals): number | null {
  const all = totals.input + totals.cacheRead + totals.cacheWrite
  return all === 0 ? null : totals.cacheRead / all
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return String(count)
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(value < 1 ? 3 : 2)}`
}

export function formatPercent(rate: number | null): string {
  return rate === null ? '-' : `${Math.round(rate * 100)}%`
}

/** Baris ringkas satu keluarga model untuk laporan /slash. */
export function totalsLine(name: string, totals: Totals): string {
  return [
    name.padEnd(7),
    `${totals.turns} giliran`,
    `cache ${formatPercent(hitRateOf(totals))}`,
    `input ${formatTokens(totals.input)}`,
    `baca ${formatTokens(totals.cacheRead)}`,
    `tulis ${formatTokens(totals.cacheWrite)}`,
    `output ${formatTokens(totals.output)}`,
    `≈${formatUsd(totals.usd)}`,
  ].join(' · ')
}
