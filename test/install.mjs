#!/usr/bin/env node
/**
 * Cross-platform regression test for the install / uninstall / verify scripts.
 *
 * Everything runs against throwaway profiles under the OS temp directory, so
 * the real `~/.dsh` is never touched. The same file runs in GitHub Actions on
 * ubuntu, macos and windows, which is where the Windows junction path is
 * exercised for real.
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = 'dsh-model-effort-chips'
const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let checks = 0
let failures = 0
function check(ok, label, detail = '') {
  checks += 1
  if (ok) console.log(`  ok  ${label}`)
  else {
    failures += 1
    console.error(` FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

function run(script, args) {
  try {
    const stdout = execFileSync(process.execPath, [join(here, 'scripts', script), ...args], {
      cwd: here,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    return {
      status: typeof error?.status === 'number' ? error.status : -1,
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? ''),
    }
  }
}

function fixture(home, profiles = ['desktop']) {
  for (const profile of profiles) {
    const dir = join(home, 'profiles', profile)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify(
        {
          name: `dsh-profile-${profile}`,
          private: true,
          dependencies: {},
          dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
  }
}

function manifest(home, profile = 'desktop') {
  return JSON.parse(readFileSync(join(home, 'profiles', profile, 'package.json'), 'utf8'))
}

function expectedLinkValue() {
  const target = process.platform === 'win32' ? here.replace(/\\/gu, '/') : here
  return `link:${target}`
}

function samePath(left, right) {
  const norm = (value) => {
    let text = resolve(value)
    try {
      text = realpathSync(text)
    } catch {
      /* dangling link: compare lexically */
    }
    return process.platform === 'win32' ? text.toLowerCase() : text
  }
  return norm(left) === norm(right)
}

const base = mkdtempSync(join(tmpdir(), 'mec-install-'))
const home = join(base, 'dsh home') // a space on purpose: --home must survive it
const missingHome = join(base, 'missing home')

try {
  // --- argument errors -----------------------------------------------------
  const missing = run('install.mjs', ['--home', missingHome])
  check(missing.status === 1, 'missing profile exits 1', `status ${missing.status}`)
  check(
    /profile manifest not found/iu.test(`${missing.stdout}${missing.stderr}`),
    'missing profile explains what to do',
  )
  check(run('install.mjs', ['--bogus']).status === 1, 'unknown installer flag exits 1')
  check(run('uninstall.mjs', ['--home', missingHome]).status === 1, 'uninstall without a profile exits 1')

  // --- dry run -------------------------------------------------------------
  fixture(home)
  const pristine = readFileSync(join(home, 'profiles', 'desktop', 'package.json'), 'utf8')
  const dry = run('install.mjs', ['--home', home, '--dry-run'])
  check(dry.status === 0, 'dry run exits 0')
  check(dry.stdout.includes('would write'), 'dry run prints the manifest change')
  check(
    readFileSync(join(home, 'profiles', 'desktop', 'package.json'), 'utf8') === pristine,
    'dry run leaves the manifest byte-identical',
  )
  check(!existsSync(join(home, 'profiles', 'desktop', 'node_modules', PKG)), 'dry run creates no link')

  // --- install -------------------------------------------------------------
  const installed = run('install.mjs', ['--home', home, '--profile', 'desktop'])
  check(installed.status === 0, 'install exits 0', installed.stderr.trim())
  check(installed.stdout.includes('OK'), 'install prints OK')

  const wired = manifest(home)
  check(wired.dependencies?.[PKG] === expectedLinkValue(), 'dependency is the expected link spec', String(wired.dependencies?.[PKG]))
  check(
    (wired.dsh?.profile?.bundles ?? []).filter((entry) => entry === PKG).length === 1,
    'bundle is listed exactly once',
  )
  check(existsSync(`${join(home, 'profiles', 'desktop', 'package.json')}.bak-model-effort-chips`), 'pristine manifest backup exists')

  const linkPath = join(home, 'profiles', 'desktop', 'node_modules', PKG)
  let linkIsSymlink = false
  try {
    linkIsSymlink = lstatSync(linkPath).isSymbolicLink()
  } catch {
    linkIsSymlink = false
  }
  check(linkIsSymlink, 'node_modules projection is a symlink or Windows junction')
  check(samePath(linkPath, here), 'projection resolves to this checkout')
  check(existsSync(join(linkPath, 'lib', 'client.js')), 'projection exposes lib/client.js')
  check(existsSync(join(linkPath, 'package.json')), 'projection exposes package.json')

  // --- idempotent re-install ----------------------------------------------
  const reinstalled = run('install.mjs', ['--home', home, '--profile', 'desktop'])
  check(reinstalled.status === 0, 're-install exits 0')
  check(
    (manifest(home).dsh?.profile?.bundles ?? []).filter((entry) => entry === PKG).length === 1,
    're-install does not duplicate the bundle entry',
  )
  check(manifest(home).dependencies?.[PKG] === expectedLinkValue(), 're-install keeps the link spec')

  // --- verify wiring (host checks are skipped when no host is running) ------
  const verified = run('verify.mjs', ['--home', home, '--profile', 'desktop'])
  check(verified.status === 0, 'verify exits 0 for a linked install', `${verified.stdout}\n${verified.stderr}`.trim())
  check(verified.stdout.includes('PLUGIN OK'), 'verify reports PLUGIN OK')

  // --- another profile ------------------------------------------------------
  fixture(home, ['web'])
  const webInstalled = run('install.mjs', ['--home', home, '--profile', 'web'])
  check(webInstalled.status === 0, 'install works for a non-desktop profile')
  check(manifest(home, 'web').dependencies?.[PKG] === expectedLinkValue(), 'web profile got the link dependency')
  check(existsSync(join(home, 'profiles', 'web', 'node_modules', PKG, 'lib', 'client.js')), 'web profile got the projection')
  check(run('uninstall.mjs', ['--home', home, '--profile', 'web']).status === 0, 'uninstall works for a non-desktop profile')
  check(!existsSync(join(home, 'profiles', 'web', 'node_modules', PKG)), 'web projection removed')

  // --- uninstall ------------------------------------------------------------
  const removed = run('uninstall.mjs', ['--home', home, '--profile', 'desktop'])
  check(removed.status === 0, 'uninstall exits 0', removed.stderr.trim())
  const cleaned = manifest(home)
  check(cleaned.dependencies?.[PKG] === undefined, 'dependency removed')
  check(!(cleaned.dsh?.profile?.bundles ?? []).includes(PKG), 'bundle entry removed')
  check(!existsSync(linkPath), 'projection removed')
  check(existsSync(join(here, 'package.json')), 'checkout is left untouched')
  check(run('uninstall.mjs', ['--home', home, '--profile', 'desktop']).status === 0, 'second uninstall exits 0')
} finally {
  try {
    rmSync(base, { recursive: true, force: true })
  } catch {
    /* Windows can hold a directory briefly; the temp dir is disposable */
  }
}

if (failures > 0) {
  console.error(`\nINSTALLER TEST FAILED (${failures}/${checks} checks)`)
  process.exit(1)
}
console.log(`\nINSTALLER TEST PASSED (${checks} checks)`)
