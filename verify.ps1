# Check a dsh-model-effort-chips installation and its live bundle (Windows).
#
#   .\verify.ps1                          # discover the running host automatically
#   .\verify.ps1 --port 62608
#   .\verify.ps1 --home D:\dsh-home
#
# The Desktop host binds an OS-assigned port; with no --port this script asks
# the OS for listening loopback sockets and picks the one whose boot graph
# contains the plugin.

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

. (Join-Path $here 'scripts\win\node-runtime.ps1')

Invoke-MecNodeScript -ScriptPath (Join-Path $here 'scripts\verify.mjs') -ScriptArgs $args
