# Uninstall dsh-model-effort-chips from a DSH profile (Windows).
#
#   .\uninstall.ps1                       # desktop profile, this user's DSH home
#   .\uninstall.ps1 --profile web
#   .\uninstall.ps1 --home D:\dsh-home
#   .\uninstall.ps1 --dry-run             # show the manifest changes only

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

. (Join-Path $here 'scripts\win\node-runtime.ps1')

Invoke-MecNodeScript -ScriptPath (Join-Path $here 'scripts\uninstall.mjs') -ScriptArgs $args
