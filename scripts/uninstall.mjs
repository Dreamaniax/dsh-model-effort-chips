#!/usr/bin/env node
/**
 * Uninstall dsh-model-effort-chips from a DSH profile.
 *
 * Removes the `link:` dependency, every `dsh.profile.bundles` occurrence, and
 * the node_modules projection (symlink or Windows junction). This checkout is
 * never touched. The pristine manifest backup the installer made is kept.
 *
 * Usage:
 *   node scripts/uninstall.mjs [--profile desktop] [--home <dsh-home>] [--dry-run]
 *
 * Environment: DSH_HOME overrides the default ~/.dsh home.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PKG,
  backupManifest,
  parseCommonArgs,
  pathKind,
  profilePaths,
  readJson,
  removeProjection,
  restartHint,
  serializeManifest,
  writeFileAtomic,
} from './lib/profile.mjs'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const USAGE = `Uninstall ${PKG} from a DSH profile.

Usage: node scripts/uninstall.mjs [--profile desktop] [--home <dsh-home>] [--dry-run]

  --profile <name>  profile to uninstall from (default: desktop)
  --home <dir>      DSH home (default: $DSH_HOME or ~/.dsh)
  --dry-run         print the manifest changes without writing anything
  -h, --help        show this help
`

function fail(message) {
  console.error(`\n[uninstall] FAILED: ${message}\n`)
  process.exit(1)
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
  const { manifestPath, linkPath, profileDir, profileName } = paths
  console.log(`[uninstall] package: ${PKG}`)
  console.log(`[uninstall] profile: ${profileName} (${profileDir})`)

  if (!existsSync(manifestPath)) fail(`profile manifest not found: ${manifestPath}`)

  const before = readFileSync(manifestPath, 'utf8')
  let manifest
  try {
    manifest = JSON.parse(before)
  } catch (error) {
    fail(`profile package.json is not valid JSON: ${manifestPath}\n  ${error?.message ?? error}`)
  }
  const hadDependency = Object.hasOwn(manifest.dependencies ?? {}, PKG)
  delete manifest.dependencies?.[PKG]
  if (Array.isArray(manifest.dsh?.profile?.bundles)) {
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((entry) => entry !== PKG)
  }
  const next = serializeManifest(manifest)
  const kind = pathKind(linkPath)

  if (options.dryRun) {
    console.log('\n[uninstall] dry run — would write:')
    console.log(next)
    console.log(`[uninstall] dry run — node_modules entry is ${kind}; would remove it`)
    return
  }

  if (before !== next) {
    const backupPath = backupManifest(manifestPath)
    console.log(`[uninstall] backup:  ${backupPath}`)
    await writeFileAtomic(manifestPath, next)
    console.log(`[uninstall] manifest: dependency ${hadDependency ? 'removed' : 'was already absent'}, bundle entry removed`)
  } else {
    console.log('[uninstall] manifest: already clean')
  }

  try {
    const removal = removeProjection(linkPath)
    if (removal.outcome === 'missing') {
      console.log(`[uninstall] node_modules: nothing to remove (${kind})`)
    } else if (removal.outcome === 'moved') {
      console.log(`[uninstall] node_modules: moved aside to ${removal.backup}`)
    } else {
      console.log(`[uninstall] node_modules: projection removed (${kind})`)
    }
  } catch (error) {
    fail(
      `could not remove ${linkPath}: ${error?.message ?? error}\n` +
        '  Close DeepSeek Harness, then delete that entry by hand and retry.',
    )
  }

  // The uninstall is only complete when the on-disk manifest agrees.
  const check = readJson(manifestPath)
  if (check.dependencies?.[PKG] !== undefined) fail('dependency entry still present after write')
  if (Array.isArray(check.dsh?.profile?.bundles) && check.dsh.profile.bundles.includes(PKG)) {
    fail('bundle entry still present after write')
  }
  if (pathKind(linkPath) !== 'missing') fail(`node_modules entry still exists: ${linkPath}`)

  console.log('\n[uninstall] OK — removed from the profile; this checkout was left untouched.')
  console.log(`[uninstall] ${restartHint()}`)
}

await main()
