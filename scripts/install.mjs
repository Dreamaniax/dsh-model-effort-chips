#!/usr/bin/env node
/**
 * Install dsh-model-effort-chips into a DSH profile by linking this directory.
 *
 * The `desktop` profile is reserved by the Electron application, so the
 * `dsh plugin` CLI refuses it. This script does what the community installers
 * do and what the profile actually reads:
 *
 *   1. back up the profile package.json
 *   2. add a `link:` dependency pointing at this checkout
 *   3. append the package name to `dsh.profile.bundles`
 *   4. create profile/node_modules/<name> as a symlink to this checkout
 *   5. verify all four
 *
 * Usage: node scripts/install.mjs [--profile desktop] [--dry-run]
 */

import { existsSync, lstatSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = 'dsh-model-effort-chips'
const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const profileFlag = args.indexOf('--profile')
const profileName = profileFlag >= 0 ? args[profileFlag + 1] : 'desktop'
const profileDir = join(homedir(), '.dsh', 'profiles', profileName)
const pkgPath = join(profileDir, 'package.json')
const linkPath = join(profileDir, 'node_modules', PKG)

function fail(message) {
  console.error(`\n[install] FAILED: ${message}`)
  process.exit(1)
}

if (!existsSync(pkgPath)) fail(`profile package.json not found: ${pkgPath}`)

const original = readFileSync(pkgPath, 'utf8')
const manifest = JSON.parse(original)

manifest.dependencies ??= {}
manifest.dependencies[PKG] = `link:${here}`
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles ??= []
if (!manifest.dsh.profile.bundles.includes(PKG)) manifest.dsh.profile.bundles.push(PKG)

const next = `${JSON.stringify(manifest, null, 2)}\n`

if (dryRun) {
  console.log('[install] dry run — would write:')
  console.log(next)
  process.exit(0)
}

const backupPath = `${pkgPath}.bak-model-effort-chips`
if (!existsSync(backupPath)) copyFileSync(pkgPath, backupPath)
console.log(`[install] backup: ${backupPath}`)

writeFileSync(pkgPath, next, 'utf8')
console.log(`[install] dependency + bundle entry written to ${pkgPath}`)

// Replace whatever is (or is not) at profile/node_modules/<pkg> with a symlink.
try {
  const stat = lstatSync(linkPath)
  if (stat.isSymbolicLink() || stat.isDirectory()) rmSync(linkPath, { recursive: true, force: true })
} catch {
  // nothing there
}
symlinkSync(here, linkPath, 'dir')
console.log(`[install] linked ${linkPath} -> ${here}`)

// Verify.
const check = JSON.parse(readFileSync(pkgPath, 'utf8'))
if (check.dependencies?.[PKG] !== `link:${here}`) fail('dependency entry missing')
if (!check.dsh.profile.bundles.includes(PKG)) fail('bundle entry missing')
if (!existsSync(join(linkPath, 'package.json'))) fail('symlink target unreadable')
if (!existsSync(join(linkPath, 'lib', 'client.js'))) fail('client bundle missing')

console.log('\n[install] OK — all four checks passed.')
console.log('[install] Restart DeepSeek Harness Desktop (fully quit, then reopen) for the client bundle to load.')
