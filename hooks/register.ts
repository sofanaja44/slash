// Plugin slash: memilih model dan effort sesuai tingkat kesulitan tugas,
// dengan menjaga prompt cache tetap terpakai.
//
//   turn.start      menilai prompt (lokal, 0 token) → tier 0-4
//   turn.step       loop utama: effort per giliran, model hanya di titik murah
//   agent.spawn     subagent bawaan: model dipilih dari tugas yang didelegasikan
//   prompt.compose  kebijakan delegasi singkat di system prompt (stabil, ter-cache)
//   turn.complete   statistik token & biaya per keluarga model
//   /slash          laporan dan paksa tier, tanpa memakan token konteks

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { SlashMain, SlashRoute, SlashTier, SlashTotals } from '../types'
import { TIER_LABEL, classify } from './classify'
import { DEFAULT_MODEL_ID, type Effort, type Family, FAMILIES, familyOf, isEffortCacheSafe, isFirstPartyId, shortName } from './models'
import { decideSwitch, effortFor, isCacheCold, mainFamilyFor, subagentFamilyFor, ttlOf } from './policy'
import { cacheHitRate, contextTokens, costUsd } from './pricing'
import { type Totals, addTurn, formatPercent, formatUsd, totalsLine } from './stats'

const INITIAL_MAIN: SlashMain = {
  pinnedModel: null,
  engineModel: null,
  isUserPinned: false,
  lastRequestAt: null,
  lastContextTokens: 0,
  lastModel: null,
  lastEffort: null,
  lastHitRate: null,
  lastDecision: null,
}

const route = atom({ plugin: 'slash', key: 'route' } as const, null)
const main = atom({ plugin: 'slash', key: 'main' } as const, INITIAL_MAIN)
const override = atom({ plugin: 'slash', key: 'override' } as const, null)
const totals = atom({ plugin: 'slash', key: 'totals' } as const, {})

/** Subagent bawaan yang modelnya dipilih plugin bila model tidak ditentukan. */
const ROUTED_SUBAGENTS = new Set(['general-purpose', 'Explore'])

const STORE_TOTALS = 'totals'
const STORE_EFFORT_UNSAFE = 'effortUnsafe'

const POLICY_ID = 'slash:routing'
const POLICY_TEXT = [
  '# Token-efficient delegation (slash plugin)',
  '- Keep a task inline when the files and context it needs are already in this conversation: a subagent starts empty and must read them again.',
  '- Delegate self-contained, read-heavy work (broad codebase searches, reading logs or many files, summarizing docs) to the `slash:scout` agent. It runs on a fast, low-cost model and returns only a summary.',
  '- Delegate small, fully specified mechanical edits that need nothing from this conversation to `slash:quick`.',
  '- Use `slash:deep` only for a hard, isolated sub-problem (tricky debugging, a design review) that needs a stronger model.',
  "- Leave the Agent tool's `model` parameter unset; the plugin picks the model from the task.",
].join('\n')

type Config = {
  autoEffort: boolean
  routeSubagents: boolean
  autoMainModel: 'off' | 'hemat-cache'
  maxSwitchUsd: number
  cacheTtlMinutes: number
  allowFable: boolean
  policyPrompt: boolean
  statusLine: boolean
}

function readConfig(options: PluginOptions): Config {
  const flag = (key: string, fallback: boolean): boolean =>
    typeof options[key] === 'boolean' ? (options[key] as boolean) : fallback
  const number = (key: string, fallback: number): number =>
    typeof options[key] === 'number' && Number.isFinite(options[key]) ? (options[key] as number) : fallback
  return {
    autoEffort: flag('auto_effort', true),
    routeSubagents: flag('route_subagents', true),
    autoMainModel: options['auto_main_model'] === 'off' ? 'off' : 'hemat-cache',
    maxSwitchUsd: number('max_switch_usd', 1),
    cacheTtlMinutes: number('cache_ttl_minutes', 60),
    allowFable: flag('allow_fable', false),
    policyPrompt: flag('policy_prompt', true),
    statusLine: flag('status_line', true),
  }
}

type Runtime = {
  /** Claude API langsung: ID first-party dan ganti effort yang aman untuk cache. */
  isFirstParty: boolean
  modelIds: Record<Family, string>
  effortUnsafe: Set<string>
}

function isEnabled(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false'
}

// Nama variabel lingkungan ditulis literal: validator plugin mendaftar apa saja yang dibaca modul.
async function loadRuntime($: EngineInterface): Promise<Runtime> {
  const otherProvider =
    isEnabled(await $.env.get('CLAUDE_CODE_USE_BEDROCK')) ||
    isEnabled(await $.env.get('CLAUDE_CODE_USE_VERTEX')) ||
    isEnabled(await $.env.get('CLAUDE_CODE_USE_FOUNDRY')) ||
    isEnabled(await $.env.get('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'))
  const pinned: Record<Family, string | undefined> = {
    haiku: await $.env.get('ANTHROPIC_DEFAULT_HAIKU_MODEL'),
    sonnet: await $.env.get('ANTHROPIC_DEFAULT_SONNET_MODEL'),
    opus: await $.env.get('ANTHROPIC_DEFAULT_OPUS_MODEL'),
    fable: await $.env.get('ANTHROPIC_DEFAULT_FABLE_MODEL'),
  }
  const modelIds = { ...DEFAULT_MODEL_ID }
  for (const family of FAMILIES) {
    const id = pinned[family]
    if (id !== undefined && isFirstPartyId(id)) modelIds[family] = id
  }
  const stored = await $.store.get(STORE_EFFORT_UNSAFE)
  const effortUnsafe = new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [])
  return { isFirstParty: !otherProvider, modelIds, effortUnsafe }
}

// Dibaca sekali per pemuatan modul; reload membaca ulang.
let runtimeCache: Runtime | null = null

async function getRuntime($: EngineInterface): Promise<Runtime> {
  runtimeCache ??= await loadRuntime($)
  return runtimeCache
}

async function showStatus($: EngineInterface, config: Config): Promise<void> {
  if (!config.statusLine) return
  const current = await read($, route)
  const state = await read($, main)
  const parts = ['slash']
  parts.push(current === null ? 'siap' : `T${current.tier} ${TIER_LABEL[current.tier]}${current.source === 'paksa' ? ' (paksa)' : ''}`)
  if (state.lastModel !== null) parts.push(shortName(state.lastModel) + (state.lastEffort === null ? '' : `/${state.lastEffort}`))
  if (state.lastHitRate !== null) parts.push(`cache ${formatPercent(state.lastHitRate)}`)
  const usage = await $.session.usage()
  if (usage.cost !== undefined) parts.push(formatUsd(usage.cost.usd))
  $.ui.status(parts.join(' · '))
}

export const register: Register = (on, options) => {
  const config = readConfig(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'slash',
      description: 'Router hemat token: laporan, atau paksa tier (0-4 | auto | reset)',
      argumentHint: '[0-4|auto|reset]',
    })
    await showStatus($, config)
    return next(e)
  })

  // Nilai tier tiap giliran utama. Subagent tidak memicu turn.start.
  on('turn.start', async ($, e, next) => {
    const previous = await read($, route)
    const forced = await read($, override)
    const result = classify(e.text, previous)
    const nextRoute: SlashRoute =
      forced === null
        ? { ...result, turnId: e.turnId, source: 'otomatis' }
        : { ...result, tier: forced, confidence: 1, reasons: ['dipaksa lewat /slash'], turnId: e.turnId, source: 'paksa' }
    await update($, route, () => nextRoute)
    await showStatus($, config)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const current = await read($, route)
    // Langkah subagent, atau giliran yang tidak sempat dinilai: biarkan apa adanya.
    if (e.agentId !== undefined || current === null || current.turnId !== e.turnId) {
      return yield* next(e)
    }

    const rt = await getRuntime($)
    const now = await $.clock.now()
    let state = await read($, main)

    // Model diganti di luar plugin (/model, fallback keamanan, opusplan): ikuti, berhenti auto-switch.
    if (state.engineModel !== null && e.model !== state.engineModel) {
      state = { ...state, pinnedModel: null, isUserPinned: true, lastDecision: `model diganti di luar plugin (${shortName(e.model)}): auto-switch berhenti untuk percakapan ini` }
    }

    const cacheCold = isCacheCold(state.lastRequestAt, now, config.cacheTtlMinutes)
    let model = state.pinnedModel ?? e.model
    let toast: string | null = null

    const canSwitch =
      e.index === 0 &&
      config.autoMainModel !== 'off' &&
      rt.isFirstParty &&
      !state.isUserPinned &&
      !current.isContinuation &&
      isFirstPartyId(e.model)
    if (canSwitch) {
      const target = rt.modelIds[mainFamilyFor(current.tier, config)]
      if (familyOf(target) !== familyOf(model)) {
        const decision = decideSwitch({
          fromModel: model,
          toModel: target,
          contextTokens: state.lastContextTokens,
          cacheCold,
          confidence: current.confidence,
          maxSwitchUsd: config.maxSwitchUsd,
          ttl: ttlOf(config.cacheTtlMinutes),
        })
        state = { ...state, lastDecision: `${shortName(model)} → ${shortName(target)}: ${decision.reason}` }
        if (decision.isSwitch) {
          toast = `slash: model ${shortName(model)} → ${shortName(target)} (${decision.reason})`
          model = target
        }
      }
    }

    // Effort per giliran, hanya di model yang mempertahankan cache saat effort berubah.
    let effort: Effort | number | undefined = e.effort
    const targetFamily = familyOf(model)
    if (targetFamily === 'haiku') {
      effort = undefined
    } else if (
      config.autoEffort &&
      rt.isFirstParty &&
      typeof e.effort !== 'number' &&
      isEffortCacheSafe(model) &&
      !rt.effortUnsafe.has(model)
    ) {
      effort = effortFor(current)
    }

    const previous = state
    state = { ...state, engineModel: e.model, pinnedModel: model === e.model ? null : model }
    await update($, main, () => state)
    if (toast !== null) $.ui.toast(toast)

    // effort undefined berarti tanpa effort (mis. Haiku), bukan "pakai nilai lama".
    const result = yield* next({ ...e, model, effort })

    if (result.usage !== null) {
      const usage = result.usage
      const tokens = contextTokens(usage)
      const effortLabel = typeof effort === 'string' ? effort : null

      // Uji diri: kalau ganti effort ternyata membuat cache meleset di model ini, matikan effort otomatis untuknya.
      const effortChanged = effortLabel !== null && previous.lastEffort !== null && effortLabel !== previous.lastEffort
      if (
        e.index === 0 &&
        effortChanged &&
        !cacheCold &&
        previous.lastModel === model &&
        previous.lastContextTokens >= 20_000 &&
        usage.cache_read_input_tokens < previous.lastContextTokens * 0.5 &&
        !rt.effortUnsafe.has(model)
      ) {
        rt.effortUnsafe.add(model)
        await $.store.set(STORE_EFFORT_UNSAFE, [...rt.effortUnsafe])
        $.ui.log(`slash: ganti effort tampaknya mereset prompt cache di ${shortName(model)}; effort otomatis dimatikan untuk model ini.`)
      }

      await update($, main, latest => ({
        ...latest,
        lastRequestAt: now,
        lastContextTokens: tokens,
        lastModel: model,
        lastEffort: effortLabel,
        lastHitRate: cacheHitRate(usage),
      }))
    }
    return result
  })

  // Subagent bawaan tanpa model eksplisit: pilih model dari tugas yang didelegasikan.
  on('agent.spawn', async ($, e, next) => {
    if (!config.routeSubagents || e.fork || e.model !== undefined || e.provider.plugin !== 'engine' || !ROUTED_SUBAGENTS.has(e.subagentType)) {
      return next(e)
    }
    const task = classify(`${e.description}\n${e.prompt}`)
    const family = subagentFamilyFor(task, e.subagentType, config)
    if (config.statusLine) $.ui.toast(`slash: subagent ${e.subagentType} → ${family} (T${task.tier} ${TIER_LABEL[task.tier]})`)
    return next({ ...e, model: family })
  })

  // Kebijakan delegasi: teks tetap, jadi ikut ter-cache bersama system prompt.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (!config.policyPrompt || !e.tools.includes('Agent') || result.sections.some(section => section.id === POLICY_ID)) {
      return result
    }
    return { sections: [...result.sections, { id: POLICY_ID, text: POLICY_TEXT, scope: 'session' as const }] }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.usage !== undefined) {
      const usage = e.usage
      const family = familyOf(usage.model) ?? 'lain'
      // Subagent selalu menulis cache 5 menit; loop utama mengikuti umur cache yang diatur.
      const usd = costUsd(usage, usage.model, e.agentId === undefined ? ttlOf(config.cacheTtlMinutes) : '5m') ?? 0
      await update($, totals, all => ({ ...all, [family]: addTurn(all[family], usage, usd) }))
      const stored = (await $.store.get(STORE_TOTALS)) as Record<string, Totals> | undefined
      await $.store.set(STORE_TOTALS, { ...stored, [family]: addTurn(stored?.[family], usage, usd) })
    }
    if (e.agentId === undefined) await showStatus($, config)
    return result
  })

  // Setelah compact, cache percakapan dibangun ulang: titik gratis untuk ganti model.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (!('skip' in result && typeof result.skip === 'string')) {
      await update($, main, state => ({ ...state, lastRequestAt: null }))
    }
    return result
  })

  // /clear memulai percakapan baru.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, main, () => INITIAL_MAIN)
      await update($, route, () => null)
      await update($, override, () => null)
    }
    return next(e)
  })

  on('command.run', { command: 'slash' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (/^[0-4]$/.test(arg)) {
      const tier = Number(arg) as SlashTier
      await update($, override, () => tier)
      $.ui.log(`slash: tier dipaksa T${tier} (${TIER_LABEL[tier]}) mulai giliran berikutnya. /slash auto untuk kembali otomatis.`)
      return {}
    }
    if (arg === 'auto') {
      await update($, override, () => null)
      await update($, main, state => ({ ...state, isUserPinned: false }))
      $.ui.log('slash: kembali ke mode otomatis.')
      return {}
    }
    if (arg === 'reset') {
      await update($, totals, () => ({}))
      await $.store.delete(STORE_TOTALS)
      $.ui.log('slash: statistik dihapus.')
      return {}
    }
    for (const line of await report($, config)) $.ui.log(line)
    return {}
  })
}

async function report($: EngineInterface, config: Config): Promise<string[]> {
  const current = await read($, route)
  const state = await read($, main)
  const forced = await read($, override)
  const session = await read($, totals)
  const stored = (await $.store.get(STORE_TOTALS)) as Record<string, SlashTotals> | undefined
  const { cost } = await $.session.usage()

  const lines = ['slash · router hemat token']
  if (current !== null) {
    lines.push(`  Giliran terakhir : T${current.tier} ${TIER_LABEL[current.tier]} · ${current.kind} · yakin ${Math.round(current.confidence * 100)}% · ${current.reasons.join(', ')}`)
  }
  lines.push(`  Model utama      : ${state.lastModel === null ? '-' : shortName(state.lastModel)}${state.pinnedModel === null ? '' : ' (dipilih plugin)'}${state.isUserPinned ? ' · auto-switch berhenti (/slash auto untuk lanjut)' : ''}`)
  lines.push(`  Effort           : ${state.lastEffort ?? '-'} · cache giliran terakhir ${formatPercent(state.lastHitRate)}`)
  if (state.lastDecision !== null) lines.push(`  Keputusan model  : ${state.lastDecision}`)
  if (forced !== null) lines.push(`  Tier dipaksa     : T${forced} (/slash auto untuk kembali)`)
  if (cost !== undefined) lines.push(`  Biaya sesi       : ${formatUsd(cost.usd)} (ledger Claude Code)`)

  const section = (title: string, rows: Record<string, SlashTotals> | undefined): void => {
    const entries = Object.entries(rows ?? {}).filter(([, value]) => value.turns > 0)
    if (entries.length === 0) return
    lines.push(title)
    for (const [family, value] of entries) lines.push(`    ${totalsLine(family, value)}`)
  }
  section('  Sesi ini (perkiraan per model):', session)
  section('  Semua sesi di mesin ini:', stored)

  lines.push(
    `  Pengaturan: effort otomatis ${config.autoEffort ? 'ON' : 'OFF'} · subagent ${config.routeSubagents ? 'ON' : 'OFF'} · model utama ${config.autoMainModel} (maks ${formatUsd(config.maxSwitchUsd)}/pindah, TTL ${config.cacheTtlMinutes} mnt) · Fable ${config.allowFable ? 'ON' : 'OFF'}`,
  )
  lines.push('  Perintah: /slash 0-4 paksa tier · /slash auto · /slash reset · ubah pengaturan di /config')
  return lines
}

