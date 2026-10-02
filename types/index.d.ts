// Kontrak nilai $.state milik plugin slash. Nilai ini milik percakapan:
// dikembalikan ke awal oleh /clear.

export type SlashTier = 0 | 1 | 2 | 3 | 4

export type SlashRoute = {
  /** Giliran yang dinilai (id dari turn.start). */
  turnId: string
  tier: SlashTier
  kind: 'chat' | 'explain' | 'explore' | 'edit' | 'build' | 'debug' | 'design'
  confidence: number
  reasons: string[]
  isContinuation: boolean
  /** `otomatis` dari classifier, `paksa` dari /slash 0-4. */
  source: 'otomatis' | 'paksa'
}

export type SlashMain = {
  /** Model yang dipasang plugin untuk loop utama; null = pilihan Claude Code. */
  pinnedModel: string | null
  /** Model yang terakhir dipilih Claude Code sendiri, untuk mendeteksi /model. */
  engineModel: string | null
  /** Model diganti di luar plugin (/model, fallback): auto-switch berhenti. */
  isUserPinned: boolean
  /** Waktu request utama terakhir (ms), null = belum ada atau cache dianggap dingin. */
  lastRequestAt: number | null
  /** Token input request utama terakhir (tanpa cache + tulis + baca). */
  lastContextTokens: number
  lastModel: string | null
  lastEffort: string | null
  /** Bagian input request terakhir yang dibaca dari cache, 0..1. */
  lastHitRate: number | null
  /** Catatan keputusan terakhir, untuk /slash. */
  lastDecision: string | null
}

export type SlashTotals = {
  turns: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number
}

declare module 'claude-code' {
  interface PluginState {
    slash: {
      route: SlashRoute | null
      main: SlashMain
      override: SlashTier | null
      totals: Record<string, SlashTotals>
    }
  }
}
