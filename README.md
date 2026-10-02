# slash: plugin Claude Code untuk hemat token

Plugin [Claude Code](https://code.claude.com) yang memilih **model** dan **effort** secara otomatis sesuai tingkat kesulitan tugas, tanpa membuang prompt cache yang sudah terbayar.

- Setiap prompt dinilai secara lokal (0 token) ke tier 0 (sangat mudah) sampai 4 (ekstrem), dalam bahasa Indonesia maupun Inggris.
- Effort diatur per giliran (`low` sampai `xhigh`) di model yang tetap memakai cache saat effort berubah: Opus 5.5, Sonnet 5.5, dan Fable 5.1.
- Model loop utama hanya diganti di titik yang murah, yaitu saat cache sudah dingin, atau saat naik model dengan biaya tulis ulang cache di bawah batas.
- Subagent bawaan (`Explore`, `general-purpose`) dipilihkan model dari tugas yang didelegasikan. Plugin juga membawa tiga agen bertingkat: `slash:scout`, `slash:quick`, dan `slash:deep`.
- Status line menampilkan tier, model/effort, hit rate cache, dan biaya sesi. Perintah `/slash` menampilkan laporan per model tanpa memakan token konteks.

## Kenapa tidak asal ganti model tiap giliran

Setiap model punya prompt cache sendiri. Begitu model diganti di tengah percakapan, seluruh riwayat dibaca ulang tanpa cache. Harga resmi per 1 juta token ([sumber](https://platform.claude.com/docs/en/about-claude/pricing), dicek 2 Oktober 2026):

| Model | Input | Tulis cache 5 mnt / 1 jam | Baca cache | Output |
|---|---|---|---|---|
| Haiku 4.5 | $1 | $1.25 / $2 | $0.10 | $5 |
| Sonnet 5.5 | $2 | $2.50 / $4 | $0.20 | $10 |
| Opus 5.5 | $4 | $5 / $8 | $0.20 | $20 |
| Fable 5.1 | $10 | $12.50 / $20 | $0.25 | $50 |

Contoh: percakapan sudah berisi 100 ribu token, dan giliran berikutnya menghasilkan 2 ribu token output (cache 5 menit).

| Pilihan | Biaya giliran itu |
|---|---|
| Tetap di Opus 5.5 (cache hangat) | **$0.06** |
| Pindah ke Haiku 4.5, yang katanya lebih murah | **$0.135**, 2,3× lebih mahal |
| Pindah ke Sonnet 5.5 | **$0.27**, 4,5× lebih mahal |

Di sesi agentik, biaya terbesar adalah membaca ulang konteks. Harga baca cache Opus 5.5 dan Sonnet 5.5 bahkan sama. Karena itu plugin ini:

1. mengatur **effort** setiap giliran, karena mengganti effort di model-model di atas tidak merusak cache;
2. mengganti **model** hanya di batas tugas: sesi baru, setelah jeda lebih lama dari umur cache, setelah `/compact`, atau lewat subagent yang memang mulai dengan konteks kosong.

## Cara kerja

| Tier | Contoh tugas | Model utama | Effort | Subagent `general-purpose` |
|---|---|---|---|---|
| 0 sangat mudah | typo, rename, format, terjemah | Haiku 4.5 | (tanpa effort) | Haiku |
| 1 mudah | ubah satu fungsi, unit test, penjelasan | Sonnet 5.5 | low | Haiku (cari/jelaskan) atau Sonnet |
| 2 sedang | fitur, bug biasa, refactor satu modul | Sonnet 5.5 | medium | Sonnet |
| 3 sulit | arsitektur, race condition, performa, keamanan | Opus 5.5 | high | Opus |
| 4 ekstrem | aplikasi lengkap dari nol, tulis ulang total | Opus 5.5 (Fable 5.1 bila diizinkan) | xhigh | Opus atau Fable |

Subagent `Explore` hanya membaca, jadi selalu dibatasi di Haiku (tier 0-2) atau Sonnet (tier 3-4).

Aturan pergantian model loop utama (mode `hemat-cache`):

- **Cache dingin** (giliran pertama, jeda di atas `cache_ttl_minutes`, atau setelah `/compact`): pindah ke model yang sesuai tier, naik maupun turun.
- **Cache hangat, naik model**: boleh bila biaya menulis ulang konteks ke cache model baru tidak lebih dari `max_switch_usd` (default $1).
- **Cache hangat, turun model**: selalu ditunda. Membaca cache model mahal biasanya lebih murah daripada menulis ulang konteks ke model murah.
- Pergantian butuh keyakinan klasifikasi yang cukup. Sapaan seperti "hai" tidak memicu pergantian, dan "ok, lanjut" mewarisi tier tugas sebelumnya.
- Kalau model kamu ganti sendiri lewat `/model` (atau Claude Code memakai model fallback), plugin mengikuti pilihan itu dan berhenti mengganti model untuk percakapan tersebut. `/slash auto` mengaktifkannya lagi.

Ada juga uji diri: kalau setelah effort berubah ternyata cache meleset di suatu model, effort otomatis dimatikan untuk model itu dan plugin menulis catatan di transcript.

## Pasang

Butuh Claude Code **v2.1.287 atau lebih baru**, karena plugin ini memakai [mods](https://code.claude.com/docs/en/plugins/mods/reference) (function hooks). Plugin berjalan di dalam Claude Code, jadi bisa dipakai dengan login langganan Claude (Pro/Max/Team/Enterprise) maupun API key, tanpa login terpisah.

Di dalam Claude Code:

```
/plugin marketplace add sofanaja44/slash
/plugin install slash@slash
```

Atau dari terminal:

```bash
claude plugin marketplace add sofanaja44/slash
claude plugin install slash@slash
```

Untuk mencoba tanpa memasang, jalankan `claude --plugin-dir /path/ke/slash`.

## Pemakaian

Setelah terpasang, semuanya berjalan otomatis. Di bawah prompt muncul status seperti:

```
slash · T2 sedang · sonnet 5.5/medium · cache 94% · $0.31
```

Notifikasi singkat muncul saat model loop utama atau model subagent diganti.

| Perintah | Fungsi |
|---|---|
| `/slash` | Laporan: tier terakhir, keputusan model, hit rate cache, biaya, dan statistik per model (sesi ini dan semua sesi) |
| `/slash 0` … `/slash 4` | Paksa tier untuk giliran-giliran berikutnya |
| `/slash auto` | Kembali ke mode otomatis, termasuk setelah kamu memakai `/model` |
| `/slash reset` | Hapus statistik |

Laporan `/slash` hanya ditampilkan di transcript dan tidak dikirim ke model, jadi tidak memakan token. Menulis `ultrathink` di prompt menaikkan tugas minimal ke tier 3.

## Pengaturan

Semua opsi bisa diubah lewat `/config`.

| Opsi | Default | Arti |
|---|---|---|
| `auto_effort` | `true` | Effort per giliran sesuai tier |
| `route_subagents` | `true` | Pilihkan model subagent bawaan dari tugasnya |
| `auto_main_model` | `hemat-cache` | `off` = model loop utama tidak pernah diganti |
| `max_switch_usd` | `1` | Batas biaya naik model saat cache hangat |
| `cache_ttl_minutes` | `60` | Umur cache: 60 untuk langganan Claude, 5 untuk API key (kecuali `promptCacheTtl` diubah) |
| `allow_fable` | `false` | Izinkan Fable 5.1 untuk tier 4 |
| `policy_prompt` | `true` | Tambahkan sekitar 150 token panduan delegasi ke system prompt (teks tetap, ikut ter-cache) |
| `status_line` | `true` | Status line dan notifikasi |

Untuk memakai versi model tertentu, set `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, atau `ANTHROPIC_DEFAULT_FABLE_MODEL`. Plugin memakai ID model itu saat berganti model.

## Batasan

- API mods masih **early access** dan bisa berubah antar rilis Claude Code. `claude plugin validate` dan `claude plugin test` adalah cara tercepat untuk memeriksanya setelah update.
- Classifier berbasis kata kunci dan struktur prompt, jadi bisa salah menilai. `/slash 0-4` tersedia untuk koreksi manual, dan polanya ada di `hooks/classify.ts`.
- Pergantian model loop utama dan effort otomatis hanya aktif di Claude API langsung. Di Amazon Bedrock, Google Cloud, Microsoft Foundry, atau saat `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` diset, plugin tidak mengganti model maupun effort loop utama. Routing subagent tetap jalan.
- Saat model diganti di tengah percakapan, hasil penalaran (thinking) model sebelumnya tidak terbawa ke model baru.
- Statistik biaya per model adalah perkiraan dari tabel harga di `hooks/pricing.ts`. Angka biaya sesi di status line berasal dari ledger Claude Code sendiri.

## Pengembangan

```bash
claude plugin validate .                              # marketplace
claude plugin validate ./.claude-plugin/plugin.json   # manifest + modul hook
claude plugin test .                                  # semua *.test.ts
claude --plugin-dir .                                 # coba di sesi; juga menaruh tipe API di .claude-plugin/types/
npx tsc -p .                                          # cek tipe, setelah tipe API ditaruh
```

```
.claude-plugin/
  plugin.json        manifest + userConfig
  marketplace.json   supaya bisa dipasang lewat /plugin marketplace add
agents/              scout (Haiku, read-only), quick (Haiku), deep (Opus, high)
hooks/
  hooks.json         { "modules": ["./register.ts"] }
  register.ts        menghubungkan event Claude Code: turn.start, turn.step, agent.spawn, ...
  classify.ts        classifier tier 0-4 (lokal, tanpa token)
  policy.ts          tier → model/effort, keputusan kapan aman ganti model
  pricing.ts         tabel harga resmi dan hitungan biaya
  models.ts          keluarga model, ID, model yang aman ganti effort
  stats.ts           akumulasi token dan biaya
types/index.d.ts     kontrak nilai $.state
tests/               tes classifier, kebijakan, harga, dan hook
```

Kalau Anthropic mengubah harga atau merilis model baru, perbarui `hooks/pricing.ts` (tabel harga), `hooks/models.ts` (`DEFAULT_MODEL_ID` dan `isEffortCacheSafe`), lalu jalankan tes.
