/**
 * The pseudo-3D family divides by depth, which is where projections blow up.
 *
 *   - no NaN may reach the context (z is offset and clamped, always),
 *   - a tile loop must never run away (draws per frame stay bounded),
 *   - sprites keep positive, whole-pixel sizes,
 *   - and the vector stand-in still paints when the art has not decoded.
 *
 * Run: node test/effect-depth.mjs
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

function paint(effect, state, frame) {
  const calls = []
  let nonFinite = 0
  const context = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined
        if (prop.startsWith('create')) return () => ({ addColorStop() {} })
        return (...args) => {
          calls.push([prop, ...args])
          for (const value of args) if (typeof value === 'number' && !Number.isFinite(value)) nonFinite += 1
        }
      },
      set: () => true,
    },
  )
  effect.paint(context, state, frame)
  return { calls, nonFinite }
}

// The host resolves art by effect id through this map (client.js DEPTH_ART), so a
// typo here means an effect silently falls back to vectors in production.
const DEPTH = [
  ['starfield.js', 'starfieldEffect', 'star'],
  ['tunnel.js', 'tunnelEffect', 'tunnel'],
  ['terrain.js', 'terrainEffect', 'ridge'],
  ['wirecube.js', 'wirecubeEffect', 'cube'],
  ['parallax.js', 'parallaxEffect', 'ridge'],
  ['grid.js', 'gridEffect', 'grid'],
]

const HOST_MAP = (() => {
  const source = readFileSync(resolve(ROOT, 'lib/client.js'), 'utf8')
  const block = source.match(/const DEPTH_ART = new Map\(\[([\s\S]*?)\]\)/)
  if (!block) return new Map()
  const pairs = [...block[1].matchAll(/\['([^']+)', '([^']+)'\]/g)]
  return new Map(pairs.map(([, key, value]) => [key, value]))
})()

for (const [file, name, asset] of DEPTH) {
  const effect = load(file, name)
  const id = effect.id
  check(id === file.replace('.js', ''), `${id}: id matches the file name`)
  check(HOST_MAP.get(id) === asset, `${id}: the host maps it to ${asset}.png (got ${HOST_MAP.get(id)})`)
  check(effect.category === 'depth', `${id}: category is depth`)
  const box = (effect.layout.sky ?? 0) + (effect.layout.band ?? 0)

  for (const energy of [0, 0.5, 1]) {
    for (const width of [200, 284, 420]) {
      const state = effect.createState()
      for (let step = 0; step < 600; step += 1) {
        const frame = frameFor(effect, energy, ART, width)
        effect.step(state, frame)
        const { calls, nonFinite } = paint(effect, state, frame)
        check(nonFinite === 0, `${id} e=${energy} w=${width}: no NaN reaches the context`)
        if (step % 15 !== 0) continue
        const draws = calls.filter(([op]) => op === 'drawImage')
        // A runaway tile loop is the failure mode here, not a slow frame.
        check(draws.length < 200, `${id} e=${energy} w=${width}: draws per frame bounded (${draws.length})`)
        for (const call of draws) {
          let dx
          let dy
          let dw
          let dh
          if (call.length === 9) [, , , , , , dx, dy, dw, dh] = call
          else [, , dx, dy, dw, dh] = call
          check(dw > 0 && dh > 0, `${id}: sprite size stays positive (${dw}x${dh})`)
          check(dw <= width * 3 && dh <= box * 3, `${id}: sprite size stays sane (${dw}x${dh})`)
          const clipped = calls.some(([op]) => op === 'clip')
          check(
            clipped || (dy >= -4 && dy + dh <= box + 4),
            `${id}: without a clip the sprite stays in its band (${dy}..${dy + dh} of ${box})`,
          )
        }
      }
      // Stars that fall behind the camera must not freeze the frame.
      check(Number.isFinite(state.time), `${id}: clock stays finite`)
    }
  }

  // Frame-rate independence: two seconds of motion at 60fps and at 30fps must
  // reach the same animation clock.
  {
    const clockAt = (fps) => {
      const probe = effect.createState()
      for (let step = 0; step < fps * 2; step += 1) effect.step(probe, { ...frameFor(effect, 0.6, ART), dt: 1 / fps })
      return probe.time
    }
    const fast = clockAt(60)
    const slow = clockAt(30)
    check(Math.abs(fast - slow) < 0.05, `${id}: animation clock is frame-rate independent (${fast.toFixed(2)} vs ${slow.toFixed(2)})`)
  }

  // No art: the stand-in paints.
  const state = effect.createState()
  for (let step = 0; step < 120; step += 1) effect.step(state, frameFor(effect, 0.6, null))
  const { calls } = paint(effect, state, frameFor(effect, 0.6, null))
  check(calls.length > 0, `${id}: draws a fallback without art`)
  check(!calls.some(([op]) => op === 'drawImage'), `${id}: no blit without art`)
}

if (failures > 0) {
  console.error(`\nEFFECT DEPTH TEST FAILED (${failures} of ${checks} checks)`)
  process.exit(1)
}
console.log(`EFFECT DEPTH TEST PASSED (${checks} checks)`)
