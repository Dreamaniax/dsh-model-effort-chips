#!/usr/bin/env node
/**
 * Real-React render test (SSR) for the seat and the effort slider.
 *
 * The stub harness in client-load.mjs never renders the slider, which is how a
 * temporal-dead-zone bug (`useWavePhase(energy, spectrumDuration)` declared
 * before spectrumDuration) shipped and turned the whole seat into the error
 * chip. This test renders with actual React so any render-time throw fails the
 * build.
 *
 * Setup: npm i --no-save react@18 react-dom@18
 * Run:   node test/render.mjs
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nodeRequire = createRequire(join(here, 'test', 'render.mjs'))
const React = nodeRequire('react')
const ReactDOMServer = nodeRequire('react-dom/server')

const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8')

const levels4 = [
  { id: 'off', name: 'Off' },
  { id: 'low', name: 'Low' },
  { id: 'high', name: 'High' },
  { id: 'max', name: 'Max' },
]
const levels5 = [...levels4.slice(0, 3), { id: 'medium', name: 'Medium' }, levels4[3]]

function makeDirectory(modelId, levels) {
  const models = [{ id: modelId, name: 'DeepSeek V4 Flash', reasoning: { defaultEffort: 'low', efforts: levels } }]
  if (modelId !== 'plain') models.push({ id: 'plain', name: 'Agnes', reasoning: undefined })
  return {
    store: {
      getSnapshot: () => ({
        current: { provider: 'deepseek-account', model: modelId, reasoningEffort: 'high' },
        groups: [{ id: 'deepseek-account', name: 'DeepSeek Account', models }],
        status: 'ready',
        pending: null,
        error: null,
      }),
      subscribe: () => () => {},
    },
    select: async () => {},
  }
}

function loadBundle(directory) {
  let captured = null
  const sandbox = {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        captured = {
          id,
          module: factory((name) => {
            if (name === 'react') return React
            if (name === 'react-dom') return nodeRequire('react-dom')
            throw new Error(`unexpected require(${name})`)
          }),
        }
      },
    },
  }
  const ctx = {
    get: (name, fallback) => (name === 'modelDirectories' ? { directoryFor: () => directory } : fallback),
    inject: (_names, callback) => callback(ctx),
    slots: {
      inject: (_slot, callback) => callback(),
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  const registrations = []
  const prevWindow = globalThis.window
  globalThis.window = sandbox
  try {
    new Function('window', 'console', 'setInterval', 'clearInterval', source)(sandbox, console, setInterval, clearInterval)
    captured.module.apply(ctx)
  } finally {
    globalThis.window = prevWindow
  }
  return { module: captured.module, registrations }
}

const checks = []
const check = (ok, label) => {
  checks.push({ ok, label })
  if (!ok) throw new Error(`FAILED: ${label}`)
}

const render = (element) => ReactDOMServer.renderToStaticMarkup(element)

// --- seat renders -----------------------------------------------------------
{
  const { registrations } = loadBundle(makeDirectory('flash', levels4))
  const seat = registrations.find((entry) => entry.options.name === 'conversation.input.model')
  check(seat !== undefined, 'seat registered')
  const html = render(React.createElement(seat.component, { sessionId: 's1' }))
  check(html.includes('mec-seat'), 'seat markup')
  check(html.includes('DeepSeek V4 Flash'), 'model name in the chip')
  check(html.includes('\u2304'), 'chevrons present')
  check(!html.includes('crashed'), 'seat did not fall into the error chip')
}

// --- slider renders for every level count -----------------------------------
for (const [label, levels] of [['four', levels4], ['five', levels5], ['one', [levels4[0]]]]) {
  const { module } = loadBundle(makeDirectory('flash', levels))
  const Slider = module.__internals.EffortSlider
  const html = render(React.createElement(Slider, { levels, effectiveEffort: levels[1]?.id, onChoose: () => {}, disabled: false }))
  check(html.includes('mec-track'), `${label}: track rendered`)
  check(html.includes('data-dsh-mec="effect-switch"'), `${label}: effect switch rendered`)
  check(html.includes('mec-knob-svg'), `${label}: knobs rendered`)
  check(html.includes('data-dsh-mec="tick"'), `${label}: ticks rendered`)
  check(html.split('mec-label').length - 1 === levels.length, `${label}: one label per level`)
}

// --- disabled + missing effort ----------------------------------------------
{
  const { module } = loadBundle(makeDirectory('flash', levels4))
  const Slider = module.__internals.EffortSlider
  const html = render(React.createElement(Slider, { levels: levels4, effectiveEffort: undefined, onChoose: () => {}, disabled: true }))
  check(html.includes('mec-slider'), 'slider renders with no effort selected and disabled')
  check(html.includes('aria-disabled="true"'), 'disabled state is announced')
}

const failed = checks.filter((entry) => !entry.ok)
for (const entry of checks) console.log(`  ok  ${entry.label}`)
if (failed.length > 0) {
  console.error(`\n${failed.length} FAILED`)
  process.exit(1)
}
console.log('\nREAL-REACT RENDER TEST PASSED')
