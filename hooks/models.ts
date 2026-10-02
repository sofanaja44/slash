// Keluarga model Claude, urutan kemampuannya, dan aturan kapan mengganti
// effort aman untuk prompt cache.

export type Family = 'haiku' | 'sonnet' | 'opus' | 'fable'

export const FAMILIES: readonly Family[] = ['haiku', 'sonnet', 'opus', 'fable']

/** Urutan kemampuan (dan harga): makin besar makin kuat. */
export const RANK: Readonly<Record<Family, number>> = { haiku: 0, sonnet: 1, opus: 2, fable: 3 }

/** Model ID first-party default per keluarga, bisa ditimpa lewat ANTHROPIC_DEFAULT_*_MODEL. */
export const DEFAULT_MODEL_ID: Readonly<Record<Family, string>> = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  fable: 'claude-fable-5-1',
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export function familyOf(model: string): Family | null {
  const id = model.toLowerCase()
  if (id.includes('mythos')) return 'fable'
  for (const family of FAMILIES) {
    if (id.includes(family)) return family
  }
  return null
}

/**
 * True untuk ID Claude API first-party seperti `claude-opus-5-5` atau
 * `claude-haiku-4-5-20251001`: tanpa prefix provider (`anthropic.`), tanpa
 * `@versi` dan tanpa sufiks seperti `[1m]`. Hanya ID begini yang aman diganti.
 */
export function isFirstPartyId(model: string): boolean {
  return /^claude-[a-z]+-\d+(-\d+)*$/.test(model)
}

/** Nama pendek untuk status line: `claude-opus-5-5` → `opus 5.5`. */
export function shortName(model: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(model)
  if (match === null) return model
  const [, family, major, minor] = match
  return minor === undefined ? `${family} ${major}` : `${family} ${major}.${minor}`
}

/**
 * Model yang mempertahankan prompt cache saat effort diganti di tengah sesi
 * (Claude Code memakai per-message effort di model ini, dengan API key atau
 * langganan Claude). Di model lain, ganti effort = seluruh riwayat dibaca ulang.
 */
export function isEffortCacheSafe(model: string): boolean {
  return /(opus-5-5|sonnet-5-5|fable-5-1|mythos-5-1)(?!\d)/.test(model.toLowerCase())
}
