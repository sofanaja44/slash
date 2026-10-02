// Klasifikasi tingkat kesulitan prompt secara lokal: heuristik kata kunci
// (Indonesia + Inggris) dan sinyal struktur. Tidak memanggil model, jadi 0 token.

export type Tier = 0 | 1 | 2 | 3 | 4

export type TaskKind = 'chat' | 'explain' | 'explore' | 'edit' | 'build' | 'debug' | 'design'

export type Classification = {
  tier: Tier
  kind: TaskKind
  /** 0..1. Router tidak mengganti model bila keyakinan rendah. */
  confidence: number
  /** Alasan singkat, untuk status line dan /slash. */
  reasons: string[]
  /** Prompt hanya melanjutkan tugas sebelumnya ("ok", "lanjut", ...). */
  isContinuation: boolean
}

export const TIER_LABEL: Readonly<Record<Tier, string>> = {
  0: 'sangat mudah',
  1: 'mudah',
  2: 'sedang',
  3: 'sulit',
  4: 'ekstrem',
}

type Rule = { id: string; kind: TaskKind; tier: Tier; weight: number; pattern: RegExp }

const RULES: readonly Rule[] = [
  // Tier 0: mekanis, jelas, lokal.
  { id: 'typo', kind: 'edit', tier: 0, weight: 2, pattern: /\b(typo|salah ketik|ejaan|spelling)\b/ },
  { id: 'rename', kind: 'edit', tier: 0, weight: 2, pattern: /\b(rename|ganti nama|ubah nama)\b/ },
  { id: 'format', kind: 'edit', tier: 0, weight: 2, pattern: /\b(format(ting)?|prettier|indent(asi)?|rapikan|lint(er)?)\b/ },
  { id: 'terjemah', kind: 'edit', tier: 0, weight: 2, pattern: /\b(translate|terjemah(kan)?)\b/ },
  { id: 'komentar', kind: 'edit', tier: 0, weight: 1, pattern: /\b(komentar|comments?|docstrings?|jsdoc)\b/ },
  { id: 'cari', kind: 'explore', tier: 0, weight: 1, pattern: /\b(di ?mana|where (is|are)|cari(kan)?|find|search|grep|locate|tampilkan|show me|baca(kan)?)\b/ },
  { id: 'ringkas', kind: 'explore', tier: 0, weight: 1, pattern: /\b(ringkas(kan)?|rangkum(kan)?|summari[sz]e|tl;?dr)\b/ },
  // Tier 1: perubahan kecil atau penjelasan.
  { id: 'definisi', kind: 'explain', tier: 1, weight: 1, pattern: /\b(apa (itu|maksud(nya)?)|what (is|are)|arti(nya)?|definisi|meaning of)\b/ },
  { id: 'jelaskan', kind: 'explain', tier: 1, weight: 1, pattern: /\b(jelaskan|explain|bagaimana cara|gimana cara|how (do|to|does))\b/ },
  { id: 'ubah-kecil', kind: 'edit', tier: 1, weight: 1, pattern: /\b(tambah(kan)?|add|ubah|change|update|ganti|replace|hapus|remove|delete|perbarui)\b/ },
  { id: 'buat', kind: 'build', tier: 1, weight: 1, pattern: /\b(buat(kan)?|bikin(kan)?|create|write|tulis(kan)?)\b/ },
  { id: 'unit-test', kind: 'edit', tier: 1, weight: 1, pattern: /\b(unit ?tests?|test cases?|tes unit)\b/ },
  { id: 'potongan-kode', kind: 'build', tier: 1, weight: 1, pattern: /\b(fungsi|function|snippet|script|regex|query sql|one-?liner)\b/ },
  // Tier 2: fitur, bug, banyak bagian.
  { id: 'fitur', kind: 'build', tier: 2, weight: 2, pattern: /\b(implement(asi(kan)?)?|fitur|features?|endpoints?|integrasi(kan)?|integrat(e|ion)|crud)\b/ },
  { id: 'ui', kind: 'build', tier: 2, weight: 1, pattern: /\b(halaman|pages?|komponen|components?|form(ulir)?|login|register|dashboard)\b/ },
  { id: 'bug', kind: 'debug', tier: 2, weight: 2, pattern: /\b(bugs?|errors?|exceptions?|crash(es|ed)?|gagal|broken|rusak|failing|not working|tidak (jalan|bisa|berfungsi)|(nggak|ngga|gak|ga|enggak) (jalan|bisa))\b/ },
  { id: 'refactor', kind: 'build', tier: 2, weight: 2, pattern: /\b(refactor(ing)?|refaktor|restruktur(isasi)?|restructure)\b/ },
  { id: 'optimasi', kind: 'build', tier: 2, weight: 1, pattern: /\b(optimi[sz]e|optimasi|lebih cepat|faster)\b/ },
  { id: 'infra', kind: 'build', tier: 2, weight: 1, pattern: /\b(docker|kubernetes|k8s|ci\/cd|pipeline|deploy(ment)?|migrasi|migrations?|schema|skema|auth(entication)?|oauth|jwt|websockets?)\b/ },
  // Tier 3: butuh penalaran berat.
  { id: 'arsitektur', kind: 'design', tier: 3, weight: 3, pattern: /\b(arsitektur|architecture|system design|desain sistem|rancang(an)? sistem|trade-?offs?|scalab\w*|skalab\w*|distributed|terdistribusi|microservices?)\b/ },
  { id: 'konkurensi', kind: 'debug', tier: 3, weight: 3, pattern: /\b(race conditions?|deadlocks?|concurren\w*|konkuren\w*|thread-?safe\w*|memory leaks?|kebocoran memori|heisenbugs?|flaky|intermittent\w*|kadang (gagal|error))\b/ },
  { id: 'performa', kind: 'debug', tier: 3, weight: 2, pattern: /\b(bottlenecks?|profil(ing|er)|latency|latensi|throughput)\b/ },
  { id: 'keamanan', kind: 'design', tier: 3, weight: 3, pattern: /\b(security audit|audit keamanan|threat model\w*|vulnerab\w*|kerentanan|exploits?|cryptograph\w*|kriptografi)\b/ },
  { id: 'akar-masalah', kind: 'debug', tier: 3, weight: 2, pattern: /\b(root cause|akar masalah|investigat\w*|selidiki|analisis mendalam|deep dive)\b/ },
  { id: 'algoritma', kind: 'design', tier: 3, weight: 2, pattern: /\b(algoritma|algorithms?|dynamic programming|kompleksitas waktu|time complexity)\b/ },
  // Tier 4: sangat besar atau terbuka.
  { id: 'dari-nol', kind: 'design', tier: 4, weight: 3, pattern: /\b(dari nol|from scratch|aplikasi lengkap|sistem lengkap|full[- ]stack app\w*|complete (app|application|system))\b/ },
  { id: 'tulis-ulang', kind: 'design', tier: 4, weight: 2, pattern: /\b(rewrite|tulis ulang|migrasi (seluruh|semua|total)|migrate (the )?(entire|whole))\b/ },
]

const CONTINUATION = /^((ok(e|ay)?|sip|siap|lanjut(kan)?|terus(kan)?|ya|iya|yes|yep|y|go|gas|next|continue|proceed|mantap|setuju|boleh|saja|aja|dong|deh|please|pls)[\s,.!]*)+$/

const GREETING = /^(hai|halo|hallo|hello|hi|hey|pagi|siang|sore|malam|selamat (pagi|siang|sore|malam)|terima ?kasih|makasih|thanks|thank you|thx)\b/

const QUESTION_START = /^(apa|apakah|bagaimana|gimana|what|how|kenapa|mengapa|why)\b/

const ULTRATHINK = /\b(ultrathink|think (hard|harder|deeply)|pikirkan (baik-baik|matang-matang|dengan matang|mendalam))\b/

const BROAD_SCOPE = /\b(semua file|seluruh|semuanya|entire|whole (codebase|project|repo)|all files|setiap file|project-wide|codebase)\b/

const STACK_TRACE = /(traceback \(most recent call last\)|^\s*at [\w$.<>]+ \(?[^\s)]+:\d+|panic:|segmentation fault|exception in thread|uncaught \w*error|\b\w*(error|exception): )/m

const FILE_PATH = /\b[\w./-]+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|cpp|cc|c|h|hpp|swift|json|ya?ml|toml|md|sql|sh|css|scss|html|vue|svelte)\b/g

const CODE_BLOCKS = /```[\s\S]*?```/g

function clampTier(value: number): Tier {
  return Math.max(0, Math.min(4, Math.round(value))) as Tier
}

/**
 * Menilai prompt. `previous` dipakai saat prompt hanya melanjutkan tugas
 * sebelumnya, supaya tier tidak turun hanya karena kata "ok".
 */
export function classify(text: string, previous?: Classification | null): Classification {
  const lower = text.trim().toLowerCase()
  const prose = lower.replace(CODE_BLOCKS, ' ')
  const words = prose.split(/\s+/).filter(word => word.length > 0)

  if (lower.length === 0 || (CONTINUATION.test(lower) && words.length <= 4)) {
    if (previous != null) {
      return { ...previous, reasons: ['lanjutan tugas sebelumnya'], isContinuation: true }
    }
    return { tier: 1, kind: 'chat', confidence: 0.3, reasons: ['lanjutan'], isContinuation: true }
  }

  if (GREETING.test(lower) && words.length <= 6) {
    return { tier: 0, kind: 'chat', confidence: 0.4, reasons: ['sapaan'], isContinuation: false }
  }

  const scores = [0, 0, 0, 0, 0]
  const matched: Rule[] = []
  for (const rule of RULES) {
    if (rule.pattern.test(prose)) {
      matched.push(rule)
      scores[rule.tier] = (scores[rule.tier] ?? 0) + rule.weight
    }
  }
  const scoreOf = (tier: number): number => scores[tier] ?? 0

  let tier: number
  let confidence: number
  const strongTier = [4, 3, 2, 1, 0].find(t => scoreOf(t) >= 2)
  if (strongTier !== undefined) {
    tier = strongTier
    confidence = scoreOf(strongTier) >= 4 ? 0.85 : 0.7
  } else if (matched.length > 0) {
    tier = Math.max(...matched.map(rule => rule.tier))
    confidence = 0.5
  } else {
    tier = 2
    confidence = 0.3
  }

  const isQuestion = lower.endsWith('?') || QUESTION_START.test(lower)
  const top = [...matched].sort((a, b) => b.tier * 10 + b.weight - (a.tier * 10 + a.weight))[0]
  let kind: TaskKind = top?.kind ?? (isQuestion ? 'explain' : 'build')
  const reasons = matched
    .filter(rule => rule.tier === tier || rule.weight >= 2)
    .slice(0, 3)
    .map(rule => rule.id)

  const hasCode = lower.includes('```')
  const hasTrace = STACK_TRACE.test(lower)

  // Pertanyaan konsep pendek ("apa itu closure?") cukup dijawab ringan.
  const has = (id: string): boolean => matched.some(rule => rule.id === id)
  const isShortQuestion = isQuestion && !hasCode && !hasTrace && words.length <= 25
  if (isShortQuestion && tier > 1 && (has('definisi') || (has('jelaskan') && scoreOf(3) + scoreOf(4) < 3))) {
    tier = 1
    kind = 'explain'
    reasons.unshift('pertanyaan konsep')
  }

  let bump = 0
  if (hasTrace) {
    if (tier < 2) tier = 2
    kind = 'debug'
    reasons.push('stack trace')
    confidence += 0.05
  }
  const files = new Set(prose.match(FILE_PATH) ?? [])
  if (files.size >= 3) {
    bump += 1
    reasons.push(`${files.size} file`)
  }
  if (BROAD_SCOPE.test(prose)) {
    bump += 1
    reasons.push('cakupan luas')
  }
  if (words.length > 120) {
    bump += 1
    reasons.push('spesifikasi panjang')
  }
  tier += Math.min(bump, 2)
  confidence += 0.05 * Math.min(bump, 2)

  if (ULTRATHINK.test(prose)) {
    tier = Math.max(tier, 3)
    reasons.push('ultrathink')
    confidence = Math.max(confidence, 0.8)
  }

  return {
    tier: clampTier(tier),
    kind,
    confidence: Math.min(0.95, Math.round(confidence * 100) / 100),
    reasons: reasons.length > 0 ? reasons : ['tanpa sinyal kuat'],
    isContinuation: false,
  }
}
