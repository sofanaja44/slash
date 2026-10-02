import { expect, test } from 'claude-code/testing'

import { classify } from '../hooks/classify'

const cases: readonly [prompt: string, tier: number][] = [
  ['perbaiki typo di README.md', 0],
  ['rename variabel x jadi count di utils.ts', 0],
  ['fix the typo in the README', 0],
  ['tambahkan unit test untuk fungsi parseDate', 1],
  ['write a function that parses ISO dates', 1],
  ['jelaskan apa itu closure di javascript?', 1],
  ['implementasikan fitur login dengan OAuth Google', 2],
  ['kenapa aplikasi saya crash waktu klik tombol simpan?', 2],
  ['ada race condition di worker queue, kadang gagal', 3],
  ['rancang arsitektur microservices untuk toko online', 3],
  ['design a distributed rate limiter', 3],
  ['refactor semua file di src/ supaya pakai async/await', 3],
  ['bangun aplikasi lengkap dari nol: backend, frontend, deploy', 4],
]

test('menilai tier prompt bahasa Indonesia dan Inggris', () => {
  for (const [prompt, tier] of cases) {
    expect(classify(prompt).tier, prompt).toBe(tier)
  }
})

test('sapaan dianggap ringan tapi tidak cukup yakin untuk ganti model', () => {
  const result = classify('hai')
  expect(result.tier).toBe(0)
  expect(result.kind).toBe('chat')
  expect(result.confidence < 0.7).toBe(true)
})

test('"ok lanjut" mewarisi tier tugas sebelumnya', () => {
  const previous = classify('ada race condition di worker queue, kadang gagal')
  const result = classify('ok lanjut', previous)
  expect(result.tier).toBe(3)
  expect(result.isContinuation).toBe(true)
})

test('lanjutan tanpa riwayat jatuh ke tier 1 dengan keyakinan rendah', () => {
  const result = classify('lanjut')
  expect(result.tier).toBe(1)
  expect(result.isContinuation).toBe(true)
  expect(result.confidence < 0.5).toBe(true)
})

test('stack trace membuat tugas minimal tier 2 jenis debug', () => {
  const result = classify('TypeError: cannot read properties of undefined\n    at render (src/app.ts:10:5)')
  expect(result.tier >= 2).toBe(true)
  expect(result.kind).toBe('debug')
})

test('ultrathink menaikkan ke tier 3', () => {
  const result = classify('ultrathink: kenapa hasil hitungan ini beda?')
  expect(result.tier).toBe(3)
  expect(result.reasons).toContain('ultrathink')
})

test('pertanyaan konsep pendek tetap ringan walau menyebut topik berat', () => {
  expect(classify('apa itu race condition?').tier).toBe(1)
})
