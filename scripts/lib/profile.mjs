/**
 * Shared profile plumbing for the install / uninstall / verify scripts.
 *
 * Everything here is deliberately platform-agnostic:
 *
 *   - DSH home resolves from `--home`, then `DSH_HOME`, then `~/.dsh`
 *   - a profile link is a symlink on POSIX and a Windows junction on win32
 *     (junctions need neither administrator rights nor Developer Mode)
 *   - the manifest value is a `link:` spec with forward slashes, which pnpm
 *     records and resolves on every platform
 *   - manifest writes are atomic and retried through the transient Windows
 *     rename errors (EACCES / EBUSY / EPERM) an antivirus or indexer can cause
 */

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** Package name, spelled once for every script. */
export const PKG = 'dsh-model-effort-chips'

const WIN = process.platform === 'win32'
const TRANSIENT_WINDOWS_RENAME = new Set(['EACCES', 'EBUSY', 'EPERM'])

const delay = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * Parse the flags the three scripts share. Unknown flags are returned in
 * `rest` so a caller can reject them instead of silently ignoring a typo.
 *
 * Supported: --profile <name>, --profile=<name>, --home <dir>, --dry-run,
 * --help / -h.
 */
export function parseCommonArgs(argv) {
  const options = { profile: 'desktop', home: null, dryRun: false, help: false, rest: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--dry-run') options.dryRun = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else if (argument === '--profile') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--profile needs a profile name')
      options.profile = value
      index += 1
    } else if (argument.startsWith('--profile=')) options.profile = argument.slice('--profile='.length)
    else if (argument === '--home') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--home needs a directory')
      options.home = value
      index += 1
    } else if (argument.startsWith('--home=')) options.home = argument.slice('--home='.length)
    else options.rest.push(argument)
  }
  if (options.profile === '') throw new Error('--profile must not be empty')
  return options
}

/** Absolute `$DSH_HOME`, from the explicit flag, the environment, or `~/.dsh`. */
export function resolveDshHome(explicitHome) {
  const value = explicitHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return resolve(value)
}

/** Every path a script touches for one profile. */
export function profilePaths({ home, profile }) {
  const dshHome = resolveDshHome(home)
  const profileDir = join(dshHome, 'profiles', profile)
  return {
    dshHome,
    profileName: profile,
    profileDir,
    manifestPath: join(profileDir, 'package.json'),
    linkPath: join(profileDir, 'node_modules', PKG),
  }
}

/** The manifest value for this checkout: a link spec, forward-slashed on Windows. */
export function linkValueFor(target) {
  const path = WIN ? target.replace(/\\/gu, '/') : target
  return `link:${path}`
}

/** Resolve a recorded manifest spec (`link:` / `file:` / bare absolute) to an absolute path. */
export function specToPath(spec, profileDir) {
  let value = String(spec)
  value = value.replace(/^(?:link|file):/u, '')
  if (WIN) value = value.replace(/\//gu, '\\')
  if (value.startsWith('~')) value = join(homedir(), value.slice(1))
  return isAbsolute(value) ? resolve(value) : resolve(profileDir, value)
}

/** Compare two paths the way the local filesystem does (case-insensitive on Windows). */
export function samePath(left, right) {
  const normalize = (value) => {
    let text = resolve(value)
    try {
      text = realpathSync(text)
    } catch {
      // a dangling target still compares lexically
    }
    // realpath may hand back the extended-length prefix on Windows
    text = text.replace(/^\\\\\?\\/u, '')
    return WIN ? text.toLowerCase() : text
  }
  return normalize(left) === normalize(right)
}

/** Read and parse a JSON file with a readable error. */
export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read JSON at ${path}: ${error?.message ?? error}`)
  }
}

/** Write JSON as a tab-free, two-space manifest with a trailing newline. */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/**
 * Atomically replace a file. The temp sibling is created in the same
 * directory so the rename stays on one filesystem; Windows rename failures
 * caused by a scanner holding the file are retried with backoff.
 */
export async function writeFileAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`
  writeFileSync(temp, text, { mode: 0o600 })
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(temp, path)
      return
    } catch (error) {
      const transient = WIN && TRANSIENT_WINDOWS_RENAME.has(error?.code ?? '')
      if (transient && attempt < 8) {
        await delay(20 * 2 ** attempt)
        continue
      }
      try {
        rmSync(temp, { force: true })
      } catch {
        // the temp file is already gone
      }
      throw error
    }
  }
}

/** Keep the pristine first backup, matching the historical script's file name. */
export function backupManifest(path, label = 'model-effort-chips') {
  const backupPath = `${path}.bak-${label}`
  if (!existsSync(backupPath)) copyFileSync(path, backupPath)
  return backupPath
}

/** Whether a path exists as a link, junction, directory, or file. */
export function pathKind(path) {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return 'link'
    if (stat.isDirectory()) return 'directory'
    return 'file'
  } catch {
    return 'missing'
  }
}

/**
 * Remove what is at `path` without ever touching a link's target.
 *
 * A POSIX symlink and a Windows junction both report as symbolic links from
 * lstat; unlink() removes the junction on some Windows builds and fails with
 * EPERM on others, where rmdir() is the correct call. A real directory is
 * moved aside rather than deleted, because a copied install may live there.
 */
export function removeProjection(path, { moveDirectory = true } = {}) {
  const kind = pathKind(path)
  if (kind === 'missing') return false

  if (kind === 'link') {
    try {
      unlinkSync(path)
      return true
    } catch (error) {
      if (WIN && ['EPERM', 'EACCES', 'EISDIR'].includes(error?.code ?? '')) {
        try {
          rmdirSync(path)
          return true
        } catch {
          // fall through to the rename/rm fallbacks below
        }
      }
      if (moveDirectory) {
        const backup = `${path}.mec-backup-${Date.now()}`
        renameSync(path, backup)
        return true
      }
      throw error
    }
  }

  if (kind === 'directory') {
    if (!moveDirectory) {
      rmSync(path, { recursive: true, force: true })
      return true
    }
    const backup = `${path}.mec-backup-${Date.now()}`
    renameSync(path, backup)
    return true
  }

  unlinkSync(path)
  return true
}

/**
 * Create the profile projection for this checkout.
 *
 * @returns {{ kind: 'symlink' | 'junction', target: string }}
 */
export function createProjection(linkPath, target) {
  mkdirSync(dirname(linkPath), { recursive: true })
  removeProjection(linkPath)

  if (WIN) {
    try {
      symlinkSync(target, linkPath, 'junction')
      return { kind: 'junction', target }
    } catch (junctionError) {
      // A directory symlink is the fallback when junctions are unavailable
      // (some network shares); it needs Developer Mode or elevation, so the
      // caller must report both failures rather than hide the first.
      try {
        symlinkSync(target, linkPath, 'dir')
        return { kind: 'symlink', target }
      } catch (symlinkError) {
        throw new Error(
          `cannot create a link at ${linkPath}\n` +
            `  junction: ${junctionError?.message ?? junctionError}\n` +
            `  symlink:  ${symlinkError?.message ?? symlinkError}\n` +
            'Move the checkout to a local NTFS drive, or use the official route:\n' +
            '  dsh plugin --profile desktop add github:Dreamaniax/dsh-model-effort-chips',
        )
      }
    }
  }

  symlinkSync(target, linkPath, 'dir')
  return { kind: 'symlink', target }
}

/** Read the link target without following it, for diagnostics. */
export function readLinkTarget(path) {
  try {
    return readlinkSync(path)
  } catch {
    return null
  }
}

/** The restart instruction that matches the host we are actually on. */
export function restartHint() {
  return WIN
    ? 'Fully quit DeepSeek Harness first (tray icon -> Quit), then reopen it.'
    : 'Fully quit DeepSeek Harness first (Command+Q), then reopen it.'
}
