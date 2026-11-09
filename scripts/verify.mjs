#!/usr/bin/env node
/**
 * One-command health check for the live plugin.
 *
 * Verifies the four things that decide whether the chips actually appear in the
 * composer:
 *
 *   1. the profile lists the package as a `link:` dependency
 *   2. the profile lists it in `dsh.profile.bundles`
 *   3. the node_modules symlink resolves to a readable client bundle
 *   4. the running host has composed the bundle into its client boot graph, and
 *      serves the same bytes this checkout contains
 *
 * Usage: node scripts/verify.mjs [--port 62608] [--profile desktop]
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = 'dsh-model-effort-chips'
const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const port = arg('--port', process.env.DSH_PORT ?? '62608')
const profileName = arg('--profile', 'desktop')
const profileDir = join(homedir(), '.dsh', 'profiles', profileName)

const results = []
const check = (ok, label, detail = '') => {
  results.push({ ok, label, detail })
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

let failed = 0

// 1 + 2: profile wiring
const pkgPath = join(profileDir, 'package.json')
if (!existsSync(pkgPath)) {
  check(false, 'profile package.json', pkgPath)
  failed += 1
} else {
  const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
  check(manifest.dependencies?.[PKG] === `link:${here}`, 'profile dependency is a link to this checkout', String(manifest.dependencies?.[PKG]))
  check(Boolean(manifest.dsh?.profile?.bundles?.includes(PKG)), 'package is listed in dsh.profile.bundles')
}

// 3: symlink + bundle
const linkPath = join(profileDir, 'node_modules', PKG, 'lib', 'client.js')
check(existsSync(linkPath), 'node_modules symlink resolves to lib/client.js', linkPath)

// 4: the running host composed it and serves our bytes
const base = `http://127.0.0.1:${port}`

/** Read the SSE boot graph until the first graph frame, then stop. */
async function readGraph(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const response = await fetch(`${base}/plugins/events`, { signal: controller.signal })
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (const line of buffer.split('\n')) {
        if (!line.startsWith('data: ') || !line.includes('"type":"graph"')) continue
        await reader.cancel()
        return JSON.parse(line.slice(6)).graph
      }
    }
    return null
  } catch (error) {
    check(false, 'client boot graph reachable', `${base}/plugins/events (${error?.message ?? error})`)
    return null
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

const graph = await readGraph(4000)
if (graph !== null) {
  const entry = graph.entries.find((item) => item.id === PKG)
  check(entry !== undefined, 'host composed the bundle into the boot graph', entry?.rev ?? 'missing')
  if (entry !== undefined) {
    const served = await fetch(`${base}/${entry.url}`).then((response) => response.text())
    const local = readFileSync(join(here, 'lib', 'client.js'), 'utf8')
    // The host appends ";" plus a sourcemap comment; compare the payload only.
    const strip = (text) =>
      text
        .trimEnd()
        .replace(/\n?\/\/# sourceMappingURL=.*$/u, '')
        .trimEnd()
        .replace(/;$/u, '')
        .trimEnd()
    check(strip(served) === strip(local), 'served bundle matches this checkout', `${served.length} bytes`)
  }
}

for (const entry of results) if (!entry.ok) failed += 1
console.log(failed === 0 ? '\nLIVE PLUGIN OK' : `\n${failed} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
