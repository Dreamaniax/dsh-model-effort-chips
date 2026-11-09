#!/usr/bin/env node
/**
 * Uninstall dsh-model-effort-chips from a DSH profile.
 *
 * Removes the `link:` dependency, the `dsh.profile.bundles` entry, and the
 * node_modules symlink. Only the link is deleted — this checkout is left
 * untouched.
 *
 * Usage: node scripts/uninstall.mjs [--profile desktop] [--dry-run]
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const PKG = 'dsh-model-effort-chips'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const profileFlag = args.indexOf('--profile')
const profileName = profileFlag >= 0 ? args[profileFlag + 1] : 'desktop'
const profileDir = join(homedir(), '.dsh', 'profiles', profileName)
const pkgPath = join(profileDir, 'package.json')
const linkPath = join(profileDir, 'node_modules', PKG)

if (!existsSync(pkgPath)) {
  console.error(`[uninstall] profile package.json not found: ${pkgPath}`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
delete manifest.dependencies?.[PKG]
if (Array.isArray(manifest.dsh?.profile?.bundles)) {
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((entry) => entry !== PKG)
}

if (dryRun) {
  console.log('[uninstall] dry run — would write:')
  console.log(`${JSON.stringify(manifest, null, 2)}\n`)
  process.exit(0)
}

writeFileSync(pkgPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
try {
  rmSync(linkPath, { recursive: true, force: true })
} catch {
  // already gone
}

console.log(`[uninstall] OK — ${PKG} removed from ${profileName}; restart DeepSeek Harness Desktop.`)
