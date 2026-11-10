/**
 * The texture family tiles a GPT Image swatch. The effects must:
 *   - build the pattern once per image (createPattern is not free),
 *   - never reset the host transform (that would drop the panel's DPR scale),
 *   - keep every fill inside sane numbers and inside their own box,
 *   - and still paint something when the swatch has not decoded.
 *
 * Run: node test/effect-texture.mjs
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

const SWATCH = { naturalWidth: 128, naturalHeight: 128, complete: true, width: 128, height: 128 }

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

function recordingContext(stats) {
  const calls = []
  const context = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined
        if (prop === 'createPattern') {
          return () => {
            stats.patterns += 1
            return { isPattern: true }
          }
        }
        if (prop.startsWith('create')) return () => ({ addColorStop() {} })
        return (...args) => {
          calls.push([prop, ...args])
          for (const value of args) {
            if (typeof value === 'number' && !Number.isFinite(value)) stats.nan += 1
          }
        }
      },
      set: () => true,
    },
  )
  return { context, calls }
}

const TEXTURES = [
  ['film-grain.js', 'filmGrainEffect', 'film-grain'],
  ['brushed.js', 'brushedEffect', 'brushed'],
  ['caustics.js', 'causticsEffect', 'caustics'],
  ['nebula.js', 'nebulaEffect', 'nebula'],
  ['flames.js', 'flamesEffect', 'flames'],
  ['halftone.js', 'halftoneEffect', 'halftone'],
]

for (const [file, name, id] of TEXTURES) {
  const effect = load(file, name)
  check(effect.id === id, `${id}: id matches the file name`)
  check(effect.category === 'texture', `${id}: category is texture`)

  for (const energy of [0, 0.5, 1]) {
    const state = effect.createState()
    const stats = { patterns: 0, nan: 0 }
    const box = (effect.layout.sky ?? 0) + (effect.layout.band ?? 0)
    for (let step = 0; step < 240; step += 1) {
      const frame = frameFor(effect, energy, SWATCH)
      effect.step(state, frame)
      const { context, calls } = recordingContext(stats)
      effect.paint(context, state, frame)
      check(!calls.some(([op]) => op === 'setTransform'), `${id}: never resets the host transform`)
      const fills = calls.filter(([op]) => op === 'fillRect')
      for (const [, x, y, w, h] of fills) {
        check(
          Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0 && w < 4000 && h < 4000,
          `${id}: fillRect stays sane (${x},${y},${w},${h})`,
        )
      }
      if (step === 239) {
        const patternFills = fills.length
        check(patternFills > 0, `${id} e=${energy}: paints the tiled swatch`)
        check(fills[0][4] >= box - 0.5 || fills[0][2] <= box, `${id} e=${energy}: texture covers the box`)
      }
    }
    // One pattern per image, no matter how many frames were painted.
    check(stats.patterns === 1, `${id} e=${energy}: pattern built once (built ${stats.patterns})`)
    check(stats.nan === 0, `${id} e=${energy}: no NaN reaches the context`)
  }

  // No swatch: the procedural stand-in still paints, and never builds a pattern.
  const state = effect.createState()
  const stats = { patterns: 0, nan: 0 }
  for (let step = 0; step < 60; step += 1) effect.step(state, frameFor(effect, 0.6, null))
  const { context, calls } = recordingContext(stats)
  effect.paint(context, state, frameFor(effect, 0.6, null))
  check(calls.length > 0, `${id}: draws a fallback without the swatch`)
  check(stats.patterns === 0, `${id}: no pattern without the swatch`)
}

if (failures > 0) {
  console.error(`\nEFFECT TEXTURE TEST FAILED (${failures} of ${checks} checks)`)
  process.exit(1)
}
console.log(`EFFECT TEXTURE TEST PASSED (${checks} checks)`)
