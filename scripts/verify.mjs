#!/usr/bin/env node
/**
 * One-command health check for a linked plugin install.
 *
 * Verifies the things that decide whether the chips actually appear in the
 * composer:
 *
 *   1. the profile lists the package as a dependency
 *   2. the package is listed in `dsh.profile.bundles`
 *   3. the node_modules projection (symlink / junction) resolves to a readable
 *      client bundle
 *   4. the copy DSH actually loads is this checkout (for a `link:` install)
 *   5. the running host composed the bundle into its client boot graph, and
 *      serves exactly the bytes of the installed copy
 *
 * With no --port the script discovers a running local host from the OS
 * listening sockets (netstat on Windows, lsof elsewhere). That makes the same
 * command work on Windows, where the Desktop host binds an OS-assigned port
 * and the URL is not visible.
 *
 * Usage:
 *   node scripts/verify.mjs [--port 62608] [--url http://127.0.0.1:62608]
 *                           [--profile desktop] [--home <dsh-home>]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PKG, pathKind, profilePaths, readJson, samePath } from './lib/profile.mjs'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const USAGE = `Check a ${PKG} profile installation and, when a host is running, the live bundle.

Usage: node scripts/verify.mjs [options]

  --port <n>        running host port (default: discover local sockets)
  --url <url>       running host base URL, e.g. http://127.0.0.1:62608
  --profile <name>  profile to inspect (default: desktop)
  --home <dir>      DSH home (default: $DSH_HOME or ~/.dsh)
  -h, --help        show this help
`

function parseArgs(argv) {
  const options = { port: null, url: null, profile: 'desktop', home: null, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${argument} needs a value`)
      index += 1
      return value
    }
    if (argument === '--port') options.port = Number(next())
    else if (argument.startsWith('--port=')) options.port = Number(argument.slice(7))
    else if (argument === '--url') options.url = next()
    else if (argument.startsWith('--url=')) options.url = argument.slice(6)
    else if (argument === '--profile') options.profile = next()
    else if (argument.startsWith('--profile=')) options.profile = argument.slice(10)
    else if (argument === '--home') options.home = next()
    else if (argument.startsWith('--home=')) options.home = argument.slice(7)
    else if (argument === '--help' || argument === '-h') options.help = true
    else throw new Error(`unknown argument: ${argument}`)
  }
  if (options.port !== null && !Number.isFinite(options.port)) throw new Error('--port must be a number')
  return options
}

const results = []
function record(ok, label, detail = '') {
  results.push({ ok, label, detail })
  console.log(`${ok === null ? ' skip ' : ok ? '  ok  ' : ' FAIL '} ${label}${detail === '' ? '' : ` — ${detail}`}`)
}

/** Read the SSE boot graph from one host, or null when it is not a DSH host. */
async function readGraph(base, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${base}/plugins/events`, { signal: controller.signal })
    if (!response.ok || response.body === null) return null
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
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

/** Loopback TCP ports currently listening, from the OS. */
function listeningPorts() {
  const ports = new Set()
  try {
    if (process.platform === 'win32') {
      const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true })
      for (const line of output.split(/\r?\n/u)) {
        const match = /^\s*TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+\d+/iu.exec(line)
        if (match !== null) ports.add(Number(match[1]))
      }
    } else {
      const output = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'], { encoding: 'utf8' })
      for (const line of output.split('\n')) {
        const match = /^n127\.0\.0\.1:(\d+)$/u.exec(line.trim())
        if (match !== null) ports.add(Number(match[1]))
      }
    }
  } catch {
    // netstat / lsof missing: discovery simply finds no candidates
  }
  return [...ports].sort((left, right) => left - right)
}

/** Look for a running local DSH host; returns { base, graph } on success. */
async function discoverHost() {
  const candidates = listeningPorts()
  let otherDshGraph = null
  for (const port of candidates) {
    const base = `http://127.0.0.1:${port}`
    const graph = await readGraph(base, 800)
    if (graph === null || !Array.isArray(graph.entries)) continue
    if (graph.entries.some((entry) => entry.id === PKG)) return { base, graph }
    otherDshGraph ??= { base, graph }
  }
  return otherDshGraph
}

/** The served payload the host compares to the local bundle. */
function normalizeBundle(text) {
  return text
    .trimEnd()
    .replace(/\n?\/\/# sourceMappingURL=.*$/u, '')
    .trimEnd()
    .replace(/;$/u, '')
    .trimEnd()
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`${error.message}\n`)
    console.log(USAGE)
    process.exit(2)
  }
  if (options.help) {
    console.log(USAGE)
    return
  }

  const paths = profilePaths(options)
  const { manifestPath, linkPath, profileDir, profileName, dshHome } = paths
  console.log(`[verify] package: ${PKG}`)
  console.log(`[verify] home:    ${dshHome}`)
  console.log(`[verify] profile: ${profileName} (${profileDir})`)

  // 1 + 2: profile wiring.
  let manifest = null
  if (!existsSync(manifestPath)) {
    record(false, 'profile package.json', manifestPath)
  } else {
    manifest = readJson(manifestPath)
    const spec = manifest.dependencies?.[PKG]
    record(
      typeof spec === 'string' && spec !== '',
      'profile lists the package as a dependency',
      spec ?? 'missing',
    )
    record(
      Array.isArray(manifest.dsh?.profile?.bundles) && manifest.dsh.profile.bundles.includes(PKG),
      'package is listed in dsh.profile.bundles',
    )
  }

  // 3: projection + installed bundle.
  const installedClient = join(linkPath, 'lib', 'client.js')
  const kind = pathKind(linkPath)
  record(kind === 'link' || kind === 'directory', 'node_modules projection exists', kind)
  record(existsSync(installedClient), 'installed copy provides lib/client.js', installedClient)
  if (existsSync(installedClient)) {
    const spec = manifest?.dependencies?.[PKG]
    if (typeof spec === 'string' && /^(?:link|file):/u.test(spec)) {
      record(samePath(linkPath, here), 'link target is this checkout', here)
    } else {
      record(null, 'installed copy is not a link to this checkout', String(spec ?? 'unknown'))
    }
  }

  // 4 + 5: the running host.
  let base = options.url ?? (Number.isFinite(options.port) ? `http://127.0.0.1:${options.port}` : null)
  let graph = null
  let explicitHost = base !== null
  if (base === null) {
    const found = await discoverHost()
    if (found !== null) {
      base = found.base
      graph = found.graph
    }
  } else {
    graph = await readGraph(base, 4000)
    if (graph === null) record(false, 'client boot graph reachable', `${base}/plugins/events`)
  }

  if (base === null) {
    record(null, 'live host', 'not running or not discoverable; start DeepSeek Harness or pass --port')
  } else {
    console.log(`[verify] host:    ${base}`)
    const entry = graph?.entries?.find((item) => item.id === PKG)
    if (entry === undefined) {
      if (graph !== null) {
        record(false, 'host composed the bundle into the boot graph', explicitHost ? 'missing' : 'a DSH host is running, but not with this plugin')
      }
    } else {
      record(true, 'host composed the bundle into the boot graph', entry.rev ?? 'present')
      if (existsSync(installedClient)) {
        try {
          const served = await fetch(`${base}/${entry.url}`).then((response) => response.text())
          const local = readFileSync(installedClient, 'utf8')
          record(
            normalizeBundle(served) === normalizeBundle(local),
            'served bundle matches the installed copy',
            `${served.length} bytes`,
          )
        } catch (error) {
          record(false, 'served bundle readable', `${base}/${entry.url} (${error?.message ?? error})`)
        }
      }
    }
  }

  const failed = results.filter((entry) => entry.ok === false).length
  console.log(failed === 0 ? '\nPLUGIN OK' : `\n${failed} CHECK(S) FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

await main()
