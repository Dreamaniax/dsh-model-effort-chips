/**
 * Every effect that draws GPT Image art must resolve to a file that exists.
 *
 * This is the check that was missing twice: the depth family and the core effect
 * both shipped an effect id that did not match the asset file name, so the host
 * requested a 404 and the effect quietly fell back to vectors while its own unit
 * test, which passes `frame.art` in by hand, stayed green.
 *
 * The test mirrors `lifeArtFor` in lib/client.js: sets for life/texture/feedback,
 * a map for core, and asserts both directions (effect -> file, file -> effect).
 *
 * Run: node test/effect-assets.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const source = readFileSync(resolve(ROOT, 'lib/client.js'), 'utf8')

let failures = 0
let checks = 0

function check(ok, message) {
  checks += 1
  if (!ok) {
    failures += 1
    console.error(`  ✗ ${message}`)
  }
}

/** Read a `const NAME = new Set([...])` out of client.js. */
function readSet(name) {
  const match = source.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`))
  if (!match) return new Set()
  return new Set([...match[1].matchAll(/'([^']+)'/g)].map(([, id]) => id))
}

/** Read a `const NAME = new Map([['a', 'b'], ...])` out of client.js. */
function readMap(name) {
  const match = source.match(new RegExp(`const ${name} = new Map\\(\\[([\\s\\S]*?)\\]\\)`))
  if (!match) return new Map()
  return new Map([...match[1].matchAll(/\['([^']+)', '([^']+)'\]/g)].map(([, key, value]) => [key, value]))
}

const LIFE = readSet('LIFE_ART_IDS')
const TEXTURE = readSet('TEXTURE_ART_IDS')
const FEEDBACK = readMap('FEEDBACK_ART')
const CORE = readMap('CORE_ART')

check(LIFE.size > 0 && TEXTURE.size > 0 && FEEDBACK.size > 0 && CORE.size > 0, 'client.js still exposes every art family')

const families = [
  ...([...LIFE].map((id) => [id, 'life', id])),
  ...([...TEXTURE].map((id) => [id, 'texture', id])),
  ...([...FEEDBACK].map(([id, asset]) => [id, 'feedback', asset])),
  ...([...CORE].map(([id, asset]) => [id, 'core', asset])),
]

// Boot the bundle the way the host does and take the real effect ids: a family
// entry that names no effect is dead weight, and an effect that is missing from
// its family silently draws vectors instead of art.
const reactStub = {
  createElement: () => ({}),
  Component: class {},
  useState: (value) => [value, () => {}],
  useEffect() {},
  useRef: (value) => ({ current: value ?? null }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
}
let exportsObject = null
const sandbox = {
  localStorage: undefined,
  __ModuleLoader__: {
    load: ({ factory }) => {
      exportsObject = factory((id) => (id === 'react' ? reactStub : { createPortal: (node) => node }))
    },
  },
}
new Function('window', 'console', 'setInterval', 'clearInterval', source)(
  sandbox,
  console,
  setInterval,
  clearInterval,
)
const effectIds = new Set(exportsObject.__internals.EFFECTS.map((effect) => effect.id))
check(effectIds.size > 0, 'the bundle exposes its effect ids')

for (const [id] of families) {
  check(effectIds.has(id), `${id}: names a real effect`)
}

for (const [id, folder, asset] of families) {
  const file = resolve(ROOT, 'lib/assets', folder, `${asset}.png`)
  check(existsSync(file), `${id}: assets/${folder}/${asset}.png exists`)
}

// Both directions: no orphan file that no effect can reach.
const used = new Set(families.map(([, folder, asset]) => `${folder}/${asset}`))
for (const folder of ['life', 'texture', 'feedback', 'core']) {
  const dir = resolve(ROOT, 'lib/assets', folder)
  if (!existsSync(dir)) continue
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.png'))) {
    check(used.has(`${folder}/${name.replace('.png', '')}`), `${folder}/${name} is reachable from a real effect id`)
  }
}

// And every id in a family must actually be an effect.
const registry = readFileSync(resolve(ROOT, 'test/client-load.mjs'), 'utf8')
check(/EFFECTS\.length === \d+/.test(registry), 'the registry count assertion is still parseable')

if (failures > 0) {
  console.error(`\nEFFECT ASSETS TEST FAILED (${failures} of ${checks} checks)`)
  process.exit(1)
}
console.log(`EFFECT ASSETS TEST PASSED (${checks} checks)`)
