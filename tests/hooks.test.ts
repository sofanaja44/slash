import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnStepInput, TurnStepResult } from 'claude-code'

type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

type Seen = {
  steps: TurnStepInput[]
  spawns: (string | undefined)[]
  toasts: string[]
  logs: string[]
  status: string[]
}

const WARM: Usage = { input_tokens: 500, output_tokens: 300, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 1_000 }

/** Berdiri sebagai Claude Code di bawah plugin: jam, env, store, UI dan respons model. */
function engine(on: On, usages: Usage[] = []): Seen & { advance: (ms: number) => Promise<void> } {
  const seen: Seen = { steps: [], spawns: [], toasts: [], logs: [], status: [] }
  const clock = mock.clock(on, { now: 1_000_000_000 })
  mock.env(on, {})
  mock.store(on)
  on('ui.status', ($, e) => {
    if (e.text !== undefined) seen.status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    seen.logs.push(e.text)
    return { value: undefined }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [], cost: { usd: 0.42 } } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($, e) {
    seen.steps.push(e)
    const usage = usages.shift() ?? WARM
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: { ...usage, model: e.model } }
  })
  on('agent.spawn', ($, e) => {
    seen.spawns.push(e.model)
    return { model: e.model ?? 'inherit' }
  })
  on('turn.complete', () => ({ text: '' }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
  return { ...seen, advance: ms => clock.advance(ms) }
}

const SLASH = { command: 'slash', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

/** Satu giliran utama: turn.start lalu satu langkah model. */
async function turn($: Engine, turnId: string, text: string, model: string, effort?: TurnStepInput['effort']): Promise<TurnStepResult> {
  await $.turn.start({ turnId, text })
  return step($, { turnId, index: 0, model, effort, messageCount: 3 })
}

async function step($: Engine, input: TurnStepInput): Promise<TurnStepResult> {
  const stream = $.turn.step(input)
  let next = await stream.next()
  while (next.done !== true) next = await stream.next()
  return next.value
}

test('tugas ringan di awal turun ke Haiku, tugas sulit berikutnya naik ke Opus dengan effort high', async ($, on) => {
  const seen = engine(on)

  await turn($, 't1', 'perbaiki typo di README.md', 'claude-opus-5-5', 'medium')
  expect(seen.steps[0]?.model).toBe('claude-haiku-4-5')
  expect(seen.steps[0]?.effort).toBeUndefined()
  expect(seen.toasts.join('\n')).toMatch(/opus 5\.5 → haiku 4\.5/)

  await seen.advance(60_000)
  await turn($, 't2', 'rancang arsitektur microservices untuk toko online', 'claude-opus-5-5', 'medium')
  expect(seen.steps[1]?.model).toBe('claude-opus-5-5')
  expect(seen.steps[1]?.effort).toBe('high')

  // "ok lanjut" mewarisi tier 3 dan tidak memicu pergantian model.
  await seen.advance(60_000)
  await turn($, 't3', 'ok lanjut', 'claude-opus-5-5', 'medium')
  expect(seen.steps[2]?.model).toBe('claude-opus-5-5')
  expect(seen.steps[2]?.effort).toBe('high')
})

test('turun model ditunda selama cache hangat; langkah lanjutan satu giliran memakai model yang sama', async ($, on) => {
  const seen = engine(on)

  await turn($, 't1', 'rancang arsitektur microservices untuk toko online', 'claude-sonnet-5-5', 'high')
  expect(seen.steps[0]?.model).toBe('claude-opus-5-5')

  await seen.advance(60_000)
  await turn($, 't2', 'perbaiki typo di README.md', 'claude-sonnet-5-5', 'high')
  expect(seen.steps[1]?.model).toBe('claude-opus-5-5')
  expect(seen.steps[1]?.effort).toBe('low')

  await step($, { turnId: 't2', index: 1, model: 'claude-sonnet-5-5', effort: 'high', messageCount: 5 })
  expect(seen.steps[2]?.model).toBe('claude-opus-5-5')
  expect(seen.steps[2]?.effort).toBe('low')

  // Setelah jeda melewati umur cache (60 menit), turun model jadi gratis.
  await seen.advance(61 * 60_000)
  await turn($, 't3', 'perbaiki typo di CHANGELOG.md', 'claude-sonnet-5-5', 'high')
  expect(seen.steps[3]?.model).toBe('claude-haiku-4-5')
})

test('model yang diganti user lewat /model dihormati dan auto-switch berhenti', async ($, on) => {
  const seen = engine(on)

  await turn($, 't1', 'perbaiki typo di README.md', 'claude-opus-5-5', 'medium')
  expect(seen.steps[0]?.model).toBe('claude-haiku-4-5')

  await seen.advance(60_000)
  await turn($, 't2', 'rancang arsitektur microservices untuk toko online', 'claude-sonnet-5-5', 'medium')
  expect(seen.steps[1]?.model).toBe('claude-sonnet-5-5')
  expect(seen.steps[1]?.effort).toBe('high')
})

test('langkah subagent tidak disentuh', async ($, on) => {
  const seen = engine(on)
  await $.turn.start({ turnId: 't1', text: 'perbaiki typo di README.md' })
  await step($, { turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'max', messageCount: 2, agentId: 'agent-1' })
  expect(seen.steps[0]?.model).toBe('claude-opus-5-5')
  expect(seen.steps[0]?.effort).toBe('max')
})

test('effort hanya diubah di model yang aman untuk cache', { options: { auto_main_model: 'off' } }, async ($, on) => {
  const seen = engine(on)
  await turn($, 't1', 'perbaiki typo di README.md', 'claude-opus-5', 'high')
  expect(seen.steps[0]?.model).toBe('claude-opus-5')
  expect(seen.steps[0]?.effort).toBe('high')

  await turn($, 't2', 'perbaiki typo di README.md', 'claude-opus-5-5', 'medium')
  expect(seen.steps[1]?.model).toBe('claude-opus-5-5')
  expect(seen.steps[1]?.effort).toBe('low')
})

test('effort otomatis berhenti di model yang ternyata kehilangan cache saat effort berubah', { options: { auto_main_model: 'off' } }, async ($, on) => {
  const miss: Usage = { input_tokens: 500, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 41_000 }
  const seen = engine(on, [WARM, miss, WARM])

  await turn($, 't1', 'perbaiki typo di README.md', 'claude-opus-5-5', 'medium')
  expect(seen.steps[0]?.effort).toBe('low')

  await seen.advance(30_000)
  await turn($, 't2', 'rancang arsitektur microservices untuk toko online', 'claude-opus-5-5', 'medium')
  expect(seen.steps[1]?.effort).toBe('high')
  expect(seen.logs.join('\n')).toMatch(/effort otomatis dimatikan/)

  await seen.advance(30_000)
  await turn($, 't3', 'perbaiki typo di README.md', 'claude-opus-5-5', 'medium')
  expect(seen.steps[2]?.effort).toBe('medium')
})

test('subagent bawaan dipilihkan model dari tugasnya; pilihan eksplisit dibiarkan', async ($, on) => {
  const seen = engine(on)
  const spawn = {
    tool_use_id: 'toolu_1',
    description: 'Find usages',
    parentModel: 'claude-opus-5-5',
    provider: { plugin: 'engine', tier: 'core' },
    background: false,
    fork: false,
  } as const

  await $.agent.spawn({ ...spawn, subagentType: 'Explore', prompt: 'Find every place parseConfig is called and list the files' })
  await $.agent.spawn({ ...spawn, subagentType: 'general-purpose', prompt: 'Investigate the root cause of the deadlock in the job scheduler' })
  await $.agent.spawn({ ...spawn, subagentType: 'general-purpose', prompt: 'Fix the typo in README.md', model: 'sonnet' })
  await $.agent.spawn({ ...spawn, subagentType: 'slash:scout', prompt: 'Find the config loader', provider: { plugin: 'slash', tier: 'user' } })
  await $.agent.spawn({ ...spawn, subagentType: 'fork', prompt: 'Continue with the plan', fork: true })

  expect(seen.spawns).toEqual(['haiku', 'opus', 'sonnet', undefined, undefined])
})

test('kebijakan delegasi ditambahkan ke system prompt hanya bila tool Agent tersedia', async ($, on) => {
  engine(on)
  const compose = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], outputStyle: null, traits: [] } as const

  const withAgent = await $.prompt.compose({ ...compose, tools: ['Agent', 'Read'] })
  expect(withAgent.sections.map(section => section.id)).toEqual(['intro', 'slash:routing'])
  expect(withAgent.sections[1]?.scope).toBe('session')

  const withoutAgent = await $.prompt.compose({ ...compose, tools: ['Read'] })
  expect(withoutAgent.sections.map(section => section.id)).toEqual(['intro'])
})

test('/slash memaksa tier, menampilkan laporan di transcript, dan tidak mengirim apa pun ke model', async ($, on) => {
  const seen = engine(on)

  const forced = await $.command.run({ ...SLASH, args: '3' })
  expect(forced.text).toBeUndefined()
  await turn($, 't1', 'perbaiki typo di README.md', 'claude-opus-5-5', 'medium')
  expect(seen.steps[0]?.effort).toBe('high')

  await $.turn.complete({
    turnId: 't1',
    answer: 'ok',
    durationMs: 1200,
    isAborted: false,
    reason: 'answer',
    usage: { ...WARM, model: 'claude-opus-5-5' },
  })
  const report = await $.command.run({ ...SLASH, args: '' })
  expect(report.text).toBeUndefined()
  const logs = seen.logs.join('\n')
  expect(logs).toMatch(/T3 \(sulit\)/)
  expect(logs).toMatch(/router hemat token/)
  expect(logs).toMatch(/opus/)
  expect(seen.status.at(-1)).toMatch(/^slash · T3 sulit \(paksa\)/)
})
