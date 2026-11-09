/**
 * dsh-model-effort-chips — host half.
 *
 * Deliberately empty: everything this plugin does happens in the browser
 * (see ./client). The row still has to exist so the client module host picks
 * the package up and serves its `./client` bundle over /plugins.
 */

/** Stable cordis plugin name. */
export const name = 'model-effort-chips'

/** No host services are required. */
export const inject = []

/** Mount the row; there is nothing to do on the host side. */
export function apply() {}
