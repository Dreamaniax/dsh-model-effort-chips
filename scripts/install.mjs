#!/usr/bin/env node
/**
 * Install dsh-model-effort-chips into a DSH profile by linking this checkout.
 *
 * This is the offline / development route. The preferred route on DSH Desktop
 * 0.2.x is the Desktop-installed `dsh` command:
 *
 *   dsh plugin --profile desktop add github:Dreamaniax/dsh-model-effort-chips
 *
 * What this script does, in order:
 *
 *   1. back up the profile manifest
 *   2. write a `link:` dependency pointing at this checkout
 *   3. append the package name to `dsh.profile.bundles` (deduplicated)
 *   4. create profile/node_modules/<name> as a symlink — or a junction on
 *      Windows, which needs neither administrator rights nor Developer Mode
 *   5. re-read the profile and check all four facts
 *
 * Usage:
 *   node scripts/install.mjs [--profile desktop] [--home <dsh-home>] [--dry-run]
 *
 * Environment: DSH_HOME overrides the default ~/.dsh home.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PKG,
  backupManifest,
  createProjection,
  linkValueFor,
  parseCommonArgs,
  pathKind,
  profilePaths,
  readJson,
  restartHint,
  samePath,
  serializeManifest,
  writeFileAtomic,
} from './lib/profile.mjs'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const USAGE = `Install ${PKG} into a DSH profile by linking this checkout.

Usage: node scripts/install.mjs [--profile desktop] [--home <dsh-home>] [--dry-run]

  --profile <name>  profile to install into (default: desktop)
  --home <dir>      DSH home (default: $DSH_HOME or ~/.dsh)
  --dry-run         print the manifest changes without writing anything
  -h, --help        show this help

On DSH Desktop 0.2.x the official route is preferred and needs no Node.js:
  dsh plugin --profile desktop add github:Dreamaniax/dsh-model-effort-chips
`

function fail(message) {
  console.error(`\n[install] FAILED: ${message}\n`)
  process.exit(1)
}

function dedupe(list) {
  return list.filter((entry, index) => list.indexOf(entry) === index)
}

async function main() {
  let options
  try {
    options = parseCommonArgs(process.argv.slice(2))
  } catch (error) {
    fail(error.message)
  }
  if (options.help) {
    console.log(USAGE)
    return
  }
  if (options.rest.length > 0) fail(`unknown argument(s): ${options.rest.join(' ')} (see --help)`)

  const paths = profilePaths(options)
  const { manifestPath, linkPath, profileDir, profileName, dshHome } = paths
  const linkValue = linkValueFor(here)
  const linkKind = process.platform === 'win32' ? 'junction' : 'symlink'

  if (!existsSync(manifestPath)) {
    fail(
      `profile manifest not found: ${manifestPath}\n` +
        `  Run DeepSeek Harness Desktop once as the "${profileName}" profile, then retry.` +
        (options.home === null && process.env.DSH_HOME === undefined
          ? '\n  If DSH lives elsewhere, pass --home <dir> or set DSH_HOME.'
          : ''),
    )
  }

  const before = readFileSync(manifestPath, 'utf8')
  const manifest = JSON.parse(before)
  manifest.dependencies ??= {}
  manifest.dsh ??= {}
  manifest.dsh.profile ??= {}
  const previousValue = manifest.dependencies[PKG]
  manifest.dependencies[PKG] = linkValue

  const bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []
  manifest.dsh.profile.bundles = dedupe([...bundles, PKG])
  const next = serializeManifest(manifest)

  console.log(`[install] package:  ${PKG}`)
  console.log(`[install] checkout: ${here}`)
  console.log(`[install] home:     ${dshHome}`)
  console.log(`[install] profile:  ${profileName} (${profileDir})`)
  console.log(`[install] link:     ${linkKind} at ${join('node_modules', PKG)}`)
  if (previousValue !== undefined && previousValue !== linkValue) {
    console.log(`[install] replacing existing dependency: ${previousValue}`)
  }

  if (options.dryRun) {
    console.log('\n[install] dry run — would write:')
    console.log(next)
    if (pathKind(linkPath) !== 'missing') {
      console.log(`[install] dry run — would replace ${linkPath} (${pathKind(linkPath)})`)
    } else {
      console.log(`[install] dry run — would create ${linkPath}`)
    }
    return
  }

  if (before !== next) {
    const backupPath = backupManifest(manifestPath)
    console.log(`[install] backup:   ${backupPath}`)
    await writeFileAtomic(manifestPath, next)
    console.log('[install] manifest: dependency + bundle entry written')
  } else {
    console.log('[install] manifest: already up to date')
  }

  try {
    const projection = createProjection(linkPath, here)
    console.log(`[install] ${projection.kind}: ${linkPath} -> ${here}`)
  } catch (error) {
    fail(error.message)
  }

  // Re-read from disk: the check must pass on what the host will actually see.
  const check = readJson(manifestPath)
  if (check.dependencies?.[PKG] !== linkValue) fail('dependency entry missing after write')
  if (!Array.isArray(check.dsh?.profile?.bundles) || !check.dsh.profile.bundles.includes(PKG)) {
    fail('bundle entry missing after write')
  }
  if (pathKind(linkPath) !== 'link') fail(`node_modules entry is not a link or junction: ${pathKind(linkPath)}`)
  if (!existsSync(join(linkPath, 'package.json'))) fail('link target has no package.json')
  if (!existsSync(join(linkPath, 'lib', 'client.js'))) fail('link target has no lib/client.js')
  if (!samePath(linkPath, here)) fail(`link target does not resolve to this checkout: ${linkPath}`)

  console.log('\n[install] OK — manifest, bundle list, link and client bundle all check out.')
  console.log(`[install] ${restartHint()}`)
  console.log('[install] Then confirm the live bundle with: node scripts/verify.mjs --port <GUI port>')
}

await main()
