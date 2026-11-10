/**
 * The feedback family reacts to level changes it cannot observe directly.
 *
 *   - a change of more than 0.03 must fire the effect's event,
 *   - a steady level must not (dragging in tiny steps cannot machine-gun it),
 *   - sprites land on whole pixels inside the band,
 *   - the event decays on its own, so an idle panel goes quiet,
 *   - and everything still paints without art.
 *
 * Run: node test/effect-feedback.mjs
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

function load(file, name) {
  const source = readFileSync(resolve(ROOT, 'lib/effects', file), 'utf8')
  return new Function('clamp01', 'withAlpha', `${source}\nreturn ${name};`)(clamp01, withAlpha)
}

const ART = { naturalWidth: 288, naturalHeight: 48, complete: true, width: 288, height: 48 }

function frameFor(effect, energy, art = ART, width = 284) {
  const sky = effect.layout.sky ?? 0
  const band = effect.layout.band ?? 0
  return {
    energy,
    accent: 'rgb(167, 139, 250)',
    totalLevels: 4,
    width,
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
  }
}

function paintCalls(effect, state, frame) {
  const calls = []
  const context = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined
        if (prop.startsWith('create')) return () => ({ addColorStop() {} })
        return (...args) => calls.push([prop, ...args])
      },
      set: () => true,
    },
  )
  effect.paint(context, state, frame)
  return calls
}

const FEEDBACK = [
  ['ripple.js', 'rippleEffect', 'pools'],
  ['burst.js', 'burstEffect', 'pools'],
  ['magnet-trail.js', 'magnetTrailEffect', 'continuous'],
  ['micro-shake.js', 'microShakeEffect', 'envelope'],
  ['spring-follow.js', 'springFollowEffect', 'spring'],
  ['ticks.js', 'ticksEffect', 'paint-only'],
]

for (const [file, name, kind] of FEEDBACK) {
  const effect = load(file, name)
  const id = effect.id
  check(id === file.replace('.js', ''), `${id}: id matches the file name`)
  check(effect.category === 'feedback', `${id}: category is feedback`)

  // A jump fires the event; a steady level does not.
  const state = effect.createState()
  for (let step = 0; step < 60; step += 1) effect.step(state, frameFor(effect, 0.4))
  if (kind === 'pools') {
    for (let step = 0; step < 60; step += 1) effect.step(state, frameFor(effect, 0.4))
    check(state.ages.every((age) => age >= 1), `${id}: a steady level leaves the pool quiet`)
    effect.step(state, frameFor(effect, 0.9))
    const alive = state.ages.filter((age) => age < 1).length
    check(alive >= 1, `${id}: a 0.5 jump fires a fresh ring (${alive} alive)`)
  }
  if (kind === 'envelope') {
    effect.step(state, frameFor(effect, 0.95))
    const fired = state.env
    check(fired > 0.5, `${id}: a jump raises the shake envelope (${fired.toFixed(2)})`)
    for (let step = 0; step < 120; step += 1) effect.step(state, frameFor(effect, 0.95))
    check(state.env === 0, `${id}: the envelope decays back to zero`)
  }
  if (kind === 'spring') {
    effect.step(state, frameFor(effect, 1))
    check(state.v !== 0, `${id}: the knob starts moving towards the new level`)
    for (let step = 0; step < 600; step += 1) effect.step(state, frameFor(effect, 1))
    check(Math.abs(state.x - 1) < 0.01, `${id}: the knob settles on the level (${state.x.toFixed(3)})`)
    check(Number.isFinite(state.x) && Number.isFinite(state.v), `${id}: spring state stays finite`)
  }

  // A slow drag in +0.01 steps must not fire anything: that is the whole point of
  // the 0.03 threshold. Without this the threshold could be zero and tests pass.
  if (kind === 'pools' || kind === 'envelope') {
    // Prime it at a constant level first, so the first step is not a jump.
    const creep = effect.createState()
    for (let step = 0; step < 30; step += 1) effect.step(creep, frameFor(effect, 0.2))
    let fired = 0
    for (let step = 0; step < 100; step += 1) {
      const before = kind === 'pools' ? creep.ages.slice() : [creep.env]
      effect.step(creep, frameFor(effect, 0.2 + step * 0.01))
      if (kind === 'pools') {
        if (creep.ages.some((age, index) => age < 1 && before[index] >= 1)) fired += 1
      } else if (creep.env > 0 && before[0] === 0) {
        fired += 1
      }
    }
    check(fired === 0, `${id}: a +0.01/frame drag never fires (${fired} times)`)
  }

  // Every drawn sprite is on whole pixels and inside the band.
  const box = (effect.layout.sky ?? 0) + (effect.layout.band ?? 0)
  const seen = new Set()
  const run = effect.createState()
  const levels = [0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1]
  for (let step = 0; step < 900; step += 1) {
    const frame = frameFor(effect, levels[Math.floor(step / 120) % levels.length])
    effect.step(run, frame)
    const frameCalls = paintCalls(effect, run, frame)
    for (const call of frameCalls) {
      if (call[0] !== 'drawImage') continue
      const [, image, sx, sy, sw, sh, dx, dy, dw, dh] = call
      check(image === ART, `${id}: blits the strip from frame.art`)
      check(sx >= 0 && sx < 288 && sx % 48 === 0, `${id}: source rect aligned to a frame (${sx})`)
      check(Number.isInteger(dx) && Number.isInteger(dy) && Number.isInteger(dw), `${id}: whole-pixel destination`)
      const shift = frameCalls.find(([op]) => op === 'translate')
      const sx2 = shift ? shift[1] : 0
      const sy2 = shift ? shift[2] : 0
      check(Number.isInteger(sx2) && Number.isInteger(sy2), `${id}: the shake offset is whole pixels`)
      check(dy + sy2 >= -1 && dy + sy2 + dh <= box + 1, `${id}: sprite inside the band after the transform (${(dy + sy2).toFixed(1)}..${(dy + sy2 + dh).toFixed(1)} of ${box})`)
      // An effect that clips its box may deliberately spill (that is what a shake
      // does); everything else must stay on the panel.
      const clipped = frameCalls.some(([op]) => op === 'clip')
      const slack = clipped ? 4 : 1
      check(dx + sx2 >= -slack && dx + sx2 + dw <= 284 + slack, `${id}: sprite inside the panel width (${(dx + sx2).toFixed(1)}..${(dx + sx2 + dw).toFixed(1)} of 284)`)
      seen.add(sx / 48)
    }
  }
  check(seen.size >= 1, `${id}: painted at least one frame`)

  // Reduced motion: the shake stands down instead of translating the canvas.
  if (id === 'micro-shake') {
    const calmState = effect.createState()
    const calmFrame = { ...frameFor(effect, 0.9), reducedMotion: true }
    for (let step = 0; step < 5; step += 1) effect.step(calmState, frameFor(effect, 0.2))
    effect.step(calmState, calmFrame)
    const calmCalls = paintCalls(effect, calmState, calmFrame)
    const shift = calmCalls.find(([op]) => op === 'translate')
    check(!shift || (shift[1] === 0 && shift[2] === 0), `${id}: no shake when reduced motion is on`)
  }

  // No art: still paints, never blits.
  const empty = effect.createState()
  for (let step = 0; step < 120; step += 1) effect.step(empty, frameFor(effect, 0.7, null))
  const calls = paintCalls(effect, empty, frameFor(effect, 0.7, null))
  check(calls.length > 0, `${id}: draws a fallback without art`)
  check(!calls.some(([op]) => op === 'drawImage'), `${id}: no blit without art`)
}

if (failures > 0) {
  console.error(`\nEFFECT FEEDBACK TEST FAILED (${failures} of ${checks} checks)`)
  process.exit(1)
}
console.log(`EFFECT FEEDBACK TEST PASSED (${checks} checks)`)
