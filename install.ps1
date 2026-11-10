# Install dsh-model-effort-chips from this checkout into a DSH profile (Windows).
#
#   .\install.ps1                         # desktop profile, this user's DSH home
#   .\install.ps1 --profile web           # another profile
#   .\install.ps1 --home D:\dsh-home      # non-default DSH home
#   .\install.ps1 --dry-run               # show the manifest changes only
#
# Node.js is not required: the launcher falls back to the Electron runtime that
# DeepSeek Harness Desktop ships. This route needs neither administrator rights
# nor Developer Mode because the profile projection is a junction.
#
# Preferred on DSH Desktop 0.2.x (no Node.js, no clone):
#   dsh plugin --profile desktop add github:Dreamaniax/dsh-model-effort-chips

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

. (Join-Path $here 'scripts\win\node-runtime.ps1')

Invoke-MecNodeScript -ScriptPath (Join-Path $here 'scripts\install.mjs') -ScriptArgs $args
