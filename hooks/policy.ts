// Kebijakan routing: tier → keluarga model dan effort, plus keputusan kapan
// mengganti model loop utama tanpa membuang prompt cache yang mahal.

import type { Classification, Tier } from './classify'
import { type Effort, type Family, RANK, familyOf } from './models'
import { type CacheTtl, priceFor, writePrice } from './pricing'

export const EFFORT_BY_TIER: Readonly<Record<Tier, Effort>> = {
  0: 'low',
  1: 'low',
  2: 'medium',
  3: 'high',
  4: 'xhigh',
}

export type PolicyOptions = { allowFable: boolean }

/** Keluarga model untuk loop utama pada tier tertentu. */
export function mainFamilyFor(tier: Tier, options: PolicyOptions): Family {
  if (tier === 0) return 'haiku'
  if (tier <= 2) return 'sonnet'
  if (tier === 3) return 'opus'
  return options.allowFable ? 'fable' : 'opus'
}

/**
 * Keluarga model untuk subagent bawaan. `Explore` hanya membaca, jadi
 * dibatasi di Haiku/Sonnet; tugas tier 1 yang sifatnya mencari atau
 * menjelaskan juga cukup di Haiku.
 */
export function subagentFamilyFor(route: Classification, subagentType: string, options: PolicyOptions): Family {
  if (subagentType === 'Explore') return route.tier <= 2 ? 'haiku' : 'sonnet'
  if (route.tier === 0) return 'haiku'
  if (route.tier === 1) return route.kind === 'explore' || route.kind === 'explain' ? 'haiku' : 'sonnet'
  return mainFamilyFor(route.tier, options)
}

export function effortFor(route: Classification): Effort {
  return EFFORT_BY_TIER[route.tier]
}

export function isCacheCold(lastRequestAt: number | null, now: number, ttlMinutes: number): boolean {
  return lastRequestAt === null || now - lastRequestAt > ttlMinutes * 60_000
}

export function ttlOf(ttlMinutes: number): CacheTtl {
  return ttlMinutes > 5 ? '1h' : '5m'
}

/**
 * Biaya tambahan (USD) giliran pertama setelah pindah model: konteks harus
 * ditulis ulang ke cache model baru. Saat cache hangat, pembandingnya adalah
 * membaca cache model lama; saat dingin, menulis ulang cache model lama.
 * Negatif berarti pindah justru lebih murah.
 */
export function switchPenaltyUsd(
  contextTokens: number,
  fromModel: string,
  toModel: string,
  cacheCold: boolean,
  ttl: CacheTtl,
): number {
  const from = priceFor(fromModel)
  const to = priceFor(toModel)
  if (from === null || to === null) return Number.POSITIVE_INFINITY
  const stay = cacheCold ? writePrice(from, ttl) : from.read
  return (contextTokens * (writePrice(to, ttl) - stay)) / 1_000_000
}

export type SwitchInput = {
  /** Model ID yang akan dipakai bila tidak pindah. */
  fromModel: string
  /** Model ID tujuan. */
  toModel: string
  /** Token input request terakhir (0 bila belum ada). */
  contextTokens: number
  cacheCold: boolean
  confidence: number
  maxSwitchUsd: number
  ttl: CacheTtl
}

export type SwitchDecision = { isSwitch: boolean; reason: string; penaltyUsd: number }

const usd = (value: number): string => `$${value.toFixed(value < 0.1 ? 3 : 2)}`

/**
 * Pindah model hanya di titik yang murah: cache sudah dingin (sesi baru,
 * jeda lama, setelah compact), atau naik model selama biaya tulis ulang
 * cache masih di bawah batas. Turun model saat cache hangat selalu ditunda,
 * karena membaca cache model mahal sering lebih murah daripada menulis
 * ulang seluruh konteks ke model murah.
 */
export function decideSwitch(input: SwitchInput): SwitchDecision {
  const from = familyOf(input.fromModel)
  const to = familyOf(input.toModel)
  if (from === null || to === null) return { isSwitch: false, reason: 'model tidak dikenali', penaltyUsd: 0 }
  if (from === to) return { isSwitch: false, reason: 'model sudah sesuai', penaltyUsd: 0 }

  const isUpgrade = RANK[to] > RANK[from]
  const penaltyUsd = switchPenaltyUsd(input.contextTokens, input.fromModel, input.toModel, input.cacheCold, input.ttl)
  if (input.confidence < (isUpgrade ? 0.5 : 0.7)) {
    return { isSwitch: false, reason: 'keyakinan klasifikasi rendah', penaltyUsd }
  }
  if (input.cacheCold) {
    return { isSwitch: true, reason: 'cache dingin, tidak ada cache yang terbuang', penaltyUsd }
  }
  if (!isUpgrade) {
    return { isSwitch: false, reason: 'turun model ditunda selama cache hangat', penaltyUsd }
  }
  if (penaltyUsd <= input.maxSwitchUsd) {
    return { isSwitch: true, reason: `naik model, biaya tulis ulang cache ≈ ${usd(penaltyUsd)}`, penaltyUsd }
  }
  return {
    isSwitch: false,
    reason: `naik model ditunda: biaya cache ≈ ${usd(penaltyUsd)} > batas ${usd(input.maxSwitchUsd)}`,
    penaltyUsd,
  }
}
