/**
 * The life family draws GPT Image pixel strips. The effects must:
 *   - cycle all six frames as the clock advances,
 *   - blit the strip with a 48x48 source rect at `frame * 48`,
 *   - land on whole pixels (pixel art blurs otherwise),
 *   - keep the sprite inside the box the effect declared,
 *   - and still draw something when `frame.art` is null (before decode, SSR).
 *
 * Run: node test/effect-art.mjs
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
  const factory = new Function('clamp01', 'withAlpha', `${source}\nreturn ${name};`)
  return factory(clamp01, withAlpha)
}

/** A decoded strip stand-in: 6 frames of 48x48. */
const ART = { naturalWidth: 288, naturalHeight: 48, complete: true, width: 288, height: 48 }

function frameFor(effect, energy, art, width = 284) {
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

function recordingContext() {
  const calls = []
  const props = {}
  const context = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined
        if (prop.startsWith('create')) return () => ({ addColorStop() {} })
        if (Object.prototype.hasOwnProperty.call(props, prop)) return props[prop]
        return (...args) => calls.push([prop, ...args])
      },
      set(_target, prop, value) {
        props[prop] = value
        calls.push(['set', prop, value])
        return true
      },
    },
  )
  return { context, calls, props }
}

// `cycle` effects walk all six frames on a clock; a `stage` effect maps the level
// onto the frames instead, so its six frames are evolutions, not animation.
const LIVES = [
  ['jellyfish.js', 'jellyfishEffect', 'jellyfish', 'cycle'],
  ['vine.js', 'vineEffect', 'vine', 'cycle'],
  ['microbe.js', 'microbeEffect', 'microbe', 'stage'],
  ['bloom.js', 'bloomEffect', 'bloom', 'cycle'],
]

for (const [file, name, id, mode] of LIVES) {
  const effect = load(file, name)
  check(effect.id === id, `${id}: id matches the file name`)
  check(effect.category === 'life', `${id}: category is life`)
  check(effect.layout.track === 'bar', `${id}: uses the single track`)

  // 1. every frame is reachable: clocked for a cycle effect, by level for a stage
  const state = effect.createState()
  const seen = new Set()
  if (mode === 'cycle') {
    for (let step = 0; step < 900; step += 1) {
      effect.step(state, frameFor(effect, 0.8, ART))
      seen.add(state.frame)
    }
    check(seen.size === 6, `${id}: all six frames play (saw ${seen.size})`)
  } else {
    for (const energy of [0, 0.17, 0.34, 0.51, 0.68, 0.85, 1]) {
      const probe = effect.createState()
      for (let step = 0; step < 30; step += 1) effect.step(probe, frameFor(effect, energy, ART))
      seen.add(probe.frame)
      check(probe.frame === Math.min(5, Math.floor(energy * 6)), `${id} e=${energy}: stage follows the level (${probe.frame})`)
    }
    check(seen.size === 6, `${id}: all six stages reachable (saw ${seen.size})`)
  }
  for (const index of seen) check(Number.isInteger(index) && index >= 0 && index < 6, `${id}: frame ${index} in range`)

  // 2. every frame blits the right slice on whole pixels
  for (const energy of [0, 0.5, 1]) {
    const local = effect.createState()
    const box = (effect.layout.sky ?? 0) + (effect.layout.band ?? 0)
    for (let step = 0; step < 600; step += 1) {
      const frame = frameFor(effect, energy, ART)
      effect.step(local, frame)
      if (step % 11 !== 0) continue
      const { context, calls } = recordingContext()
      effect.paint(context, local, frame)
      const draws = calls.filter(([op]) => op === 'drawImage')
      // A stage effect cross-fades, so a frame in transition legitimately blits twice.
      check(draws.length >= 1 && draws.length <= 2, `${id} e=${energy}: one blit per frame (got ${draws.length})`)
      // Pixel art must blit with smoothing off, then restore it.
      const blitIndex = calls.findIndex(([op]) => op === 'drawImage')
      const before = calls.slice(0, blitIndex)
      const after = calls.slice(blitIndex + 1)
      check(
        before.some(([op, prop, value]) => op === 'set' && prop === 'imageSmoothingEnabled' && value === false),
        `${id}: smoothing is off before the blit`,
      )
      check(
        after.some(([op, prop, value]) => op === 'set' && prop === 'imageSmoothingEnabled' && value === true),
        `${id}: smoothing is restored after the blit`,
      )
      const draw = draws[draws.length - 1]
      if (!draw) continue
      const [, image, sx, sy, sw, sh, dx, dy, dw, dh] = draw
      check(image === ART, `${id}: blits the strip passed in frame.art`)
      check(sx === local.frame * 48 && sy === 0 && sw === 48 && sh === 48, `${id}: source rect follows the frame (${sx},${sy},${sw},${sh})`)
      check(Number.isInteger(dx) && Number.isInteger(dy) && Number.isInteger(dw), `${id}: destination is whole pixels`)
      check(dw === dh, `${id}: the sprite stays square`)
      check(dy >= -0.5 && dy + dh <= box + 0.5, `${id} e=${energy}: sprite inside its box (${dy}..${dy + dh} of 0..${box})`)
    }
  }

  // 3. no art: the vector stand-in still paints
  const empty = effect.createState()
  for (let step = 0; step < 120; step += 1) effect.step(empty, frameFor(effect, 0.6, null))
  const { context, calls } = recordingContext()
  effect.paint(context, empty, frameFor(effect, 0.6, null))
  check(calls.length > 0, `${id}: draws a fallback when frame.art is null`)
  check(!calls.some(([op]) => op === 'drawImage'), `${id}: no blit without art`)
}

if (failures > 0) {
  console.error(`\nEFFECT ART TEST FAILED (${failures} of ${checks} checks)`)
  process.exit(1)
}
console.log(`EFFECT ART TEST PASSED (${checks} checks)`)
