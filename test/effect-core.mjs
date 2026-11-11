/**
 * 同心核心 (concentric-core) is one strip carrying three materials:
 * frames 0-5 the hex core lighting up, 6-11 ring sets, 12-17 radial blades.
 *
 *   - the level must walk the whole core ladder and the ring ladder,
 *   - rings alternate direction and grow in count with the level,
 *   - blades stay invisible until the top of the range,
 *   - every blit is a whole pixel inside the box, and rotation never leaves it,
 *   - reduced motion freezes the spin but keeps the core lit,
 *   - and the no-art path still draws.
 *
 * Run: node test/effect-core.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
let failures = 0
let checks = 0

function check(ok, message) {
  checks += 1
  if (!ok) {
    failures += 1
    console.error(`  ✗ ${message}`)
  }
}

const clamp01 = (value) => Math.max(0, Math.min(1, value))
const withAlpha = (color, alpha) => `rgba(167, 139, 250, ${alpha})`
const source = readFileSync(resolve(ROOT, 'lib/effects/concentric-core.js'), 'utf8')
const effect = new Function('clamp01', 'withAlpha', `${source}\nreturn concentricCoreEffect;`)(clamp01, withAlpha)

const ART = { naturalWidth: 864, naturalHeight: 48, complete: true, width: 864, height: 48 }

function frameFor(energy, art = ART, extra = {}) {
  const sky = effect.layout.sky ?? 0
  const band = effect.layout.band ?? 0
  return {
    energy,
    accent: 'rgb(167, 139, 250)',
    totalLevels: 4,
    width: 284,
    height: sky + band + 58,
    dt: 1 / 60,
    band: { top: sky, height: band },
    sky,
    trackY: sky + band + 16,
    rail: 58,
    artBox: { top: 0, height: sky },
    sprite: null,
    noise: null,
    art,
    ...extra,
  }
}

function paint(state, frame) {
  const calls = []
  let bad = 0
  const context = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined
        if (prop.startsWith('create')) return () => ({ addColorStop() {} })
        return (...args) => {
          calls.push([prop, ...args])
          for (const value of args) if (typeof value === 'number' && !Number.isFinite(value)) bad += 1
        }
      },
      set: () => true,
    },
  )
  effect.paint(context, state, frame)
  return { calls, bad }
}

check(effect.id === 'concentric-core', 'id is the neutral catalogue name')
check(effect.category === 'core', 'category is core')
const box = (effect.layout.sky ?? 0) + (effect.layout.band ?? 0)

// 1. the level walks both ladders
for (const [energy, coreFrame, ringFrame] of [[0, 0, 0], [0.5, 3, 3], [1, 5, 5]]) {
  const state = effect.createState()
  const { calls } = paint(state, frameFor(energy))
  const sources = calls.filter(([op]) => op === 'drawImage').map((call) => call[2] / 48)
  check(sources.includes(coreFrame), `e=${energy}: core uses frame ${coreFrame} (saw ${sources.join(',')})`)
  check(sources.includes(6 + ringFrame), `e=${energy}: rings use frame ${6 + ringFrame}`)
}

// 2. ring count and blade fade follow the level
for (const energy of [0, 0.25, 0.5, 0.75, 1]) {
  const state = effect.createState()
  const { calls, bad } = paint(state, frameFor(energy))
  const draws = calls.filter(([op]) => op === 'drawImage')
  const ringDraws = draws.filter((call) => call[2] >= 6 * 48 && call[2] < 12 * 48)
  const bladeDraws = draws.filter((call) => call[2] >= 12 * 48)
  const expectedRings = 2 + Math.floor(3 * energy)
  check(ringDraws.length === expectedRings, `e=${energy}: ${expectedRings} rings (saw ${ringDraws.length})`)
  check(bad === 0, `e=${energy}: no NaN reaches the context`)
  if (energy <= 0.5) check(bladeDraws.length === 0, `e=${energy}: no blades below 0.55`)
  if (energy === 1) check(bladeDraws.length === 1, `e=1: one blade flare`)
  for (const call of draws) {
    check(call[2] % 48 === 0 && call[2] < 864, `e=${energy}: source rect is a real frame (${call[2]})`)
    check(Number.isInteger(call[6]) && Number.isInteger(call[7]) && Number.isInteger(call[8]), `e=${energy}: whole-pixel destination`)
    check(call[8] > 0 && call[8] <= box * 1.2, `e=${energy}: sprite fits the box (${call[8]} of ${box})`)
  }
}

// 3. the spin advances with the level and freezes under reduced motion
{
  const slow = effect.createState()
  const fast = effect.createState()
  for (let step = 0; step < 120; step += 1) {
    effect.step(slow, frameFor(0))
    effect.step(fast, frameFor(1))
  }
  check(fast.spin > slow.spin * 2, `spin follows the level (${slow.spin.toFixed(2)} vs ${fast.spin.toFixed(2)})`)
  // Under reduced motion the rings may keep a static offset, but two paints a
  // second apart must show exactly the same angles: nothing is spinning.
  const calm = effect.createState()
  for (let step = 0; step < 30; step += 1) effect.step(calm, frameFor(1))
  const first = paint(calm, frameFor(1, ART, { reducedMotion: true })).calls
  for (let step = 0; step < 60; step += 1) effect.step(calm, frameFor(1))
  const second = paint(calm, frameFor(1, ART, { reducedMotion: true })).calls
  const anglesOf = (calls) => calls.filter(([op]) => op === 'rotate').map(([, angle]) => angle.toFixed(4))
  check(JSON.stringify(anglesOf(first)) === JSON.stringify(anglesOf(second)), 'reduced motion freezes the rings')
}

// 4. no art: the hex stand-in still draws
{
  const state = effect.createState()
  for (let step = 0; step < 60; step += 1) effect.step(state, frameFor(0.7, null))
  const { calls } = paint(state, frameFor(0.7, null))
  check(calls.length > 0, 'draws a fallback without art')
  check(!calls.some(([op]) => op === 'drawImage'), 'no blit without art')
}

// 5. frame-rate independence
{
  const clockAt = (fps) => {
    const probe = effect.createState()
    for (let step = 0; step < fps * 2; step += 1) effect.step(probe, { ...frameFor(0.6), dt: 1 / fps })
    return probe.spin
  }
  const a = clockAt(60)
  const b = clockAt(30)
  check(Math.abs(a - b) < 0.01, `spin is frame-rate independent (${a.toFixed(3)} vs ${b.toFixed(3)})`)
}

if (failures > 0) {
  console.error(`\nEFFECT CORE TEST FAILED (${failures} of ${checks} checks)`)
  process.exit(1)
}
console.log(`EFFECT CORE TEST PASSED (${checks} checks)`)
