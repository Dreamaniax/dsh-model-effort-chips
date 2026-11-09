#!/usr/bin/env node
/**
 * M0 load test — no DSH required.
 *
 * Emulates the browser module host (`window.__ModuleLoader__.load`), a minimal
 * React, and a minimal slots service, then asserts that the client half:
 *
 *   1. registers a factory under the package id,
 *   2. takes the model seat over with priority -1,
 *   3. also exposes the tool-row fallback,
 *   4. renders the seat without throwing.
 *
 * Run: node test/m0-load.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8')

const loaded = []
const registrations = []

const react = {
  createElement(type, props, ...children) {
    if (typeof type !== 'string') throw new Error(`unexpected component type: ${String(type)}`)
    return { type, props: props ?? {}, children }
  },
}

const fakeRequire = (id) => {
  if (id === 'react') return react
  throw new Error(`unexpected require("${id}")`)
}

const slotService = {
  inject(slot, callback) {
    loaded.push(`inject:${slot}`)
    return callback()
  },
  register(options, component) {
    registrations.push({ options, component })
    return () => {}
  },
}

const ctx = { slots: slotService }

const sandbox = { __ModuleLoader__: { load: ({ id, factory }) => { sandbox.loadedModule = { id, module: factory(fakeRequire) } } } }
new Function('window', 'console', source)(sandbox, console)

const { id, module } = sandbox.loadedModule
if (id !== 'dsh-model-effort-chips') throw new Error(`factory id mismatch: ${id}`)
if (typeof module.apply !== 'function') throw new Error('apply is not a function')
if (!Array.isArray(module.inject) || !module.inject.includes('slots')) throw new Error('inject must declare slots')

module.apply(ctx)

const seat = registrations.find((entry) => entry.options.name === 'conversation.input.model')
if (!seat) throw new Error('model seat occupant not registered')
if (seat.options.priority !== -1) throw new Error(`seat priority must be -1, got ${String(seat.options.priority)}`)

const fallback = registrations.find((entry) => entry.options.name === 'conversation.input.right')
if (!fallback) throw new Error('tool-row fallback not registered')

const tree = seat.component({})
if (tree?.type !== 'div') throw new Error('seat must render a div')
const chips = tree.children.flat().filter((child) => child?.props?.['data-dsh-mec']?.startsWith?.('model') || child?.props?.['data-dsh-mec'] === 'effort')
if (chips.length !== 2) throw new Error(`expected 2 chips, got ${chips.length}`)

const labels = chips.map((chip) => JSON.stringify(chip.children))
console.log('factory id      :', id)
console.log('apply / inject  :', typeof module.apply, module.inject.join(','))
console.log('slot registrations:', registrations.map((entry) => `${entry.options.name}@${entry.options.priority ?? 0}`).join(' '))
console.log('chips           :', labels.join(' | '))
console.log('\nM0 LOAD TEST PASSED')
