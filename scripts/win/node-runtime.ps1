# Shared runtime discovery for the Windows launchers.
#
# A Windows user may have no system Node.js: DeepSeek Harness Desktop bundles
# its own Electron, and Electron can run a plain Node script in Node mode
# (ELECTRON_RUN_AS_NODE=1), which is exactly how DSH itself runs the dsh CLI.
# Resolution order:
#
#   1. `node` on PATH (the usual developer setup)
#   2. DSH_DESKTOP_NODE_EXECUTABLE, which DSH sets for its child processes
#   3. the application executable recorded by the Windows uninstall entry
#   4. the conventional per-user / per-machine install directories
#
# The script intentionally has no parameter block: dot-source it and call
# Invoke-MecNodeScript, which exits with the child's exit code.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-MecElectronRuntime {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return @{
        Kind   = 'electron'
        File   = $Path
        Prefix = @('--expose-internals')
        Env    = @{ ELECTRON_RUN_AS_NODE = '1' }
    }
}

function Get-MecNodeRuntime {
    # 1. A system Node.js.
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($null -ne $node) {
        $file = ''
        foreach ($property in @('Source', 'Path')) {
            $found = $node.PSObject.Properties[$property]
            if ($null -ne $found -and -not [string]::IsNullOrWhiteSpace([string]$found.Value)) {
                $file = [string]$found.Value
                break
            }
        }
        if (-not [string]::IsNullOrWhiteSpace($file) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
            # The scripts need Node >= 20 (global fetch, ESM top-level await).
            # A stale Node or a Microsoft Store execution-alias stub falls
            # through to Desktop's Electron runtime instead of failing later.
            $version = ''
            try {
                $version = [string](& $file --version 2>$null | Select-Object -First 1)
            } catch {
                $version = ''
            }
            if ($version -match '^v(\d+)\.') {
                $major = [int]$Matches[1]
                if ($major -ge 20) {
                    return @{ Kind = 'node'; File = $file; Prefix = @(); Env = @{} }
                }
            }
        }
    }

    # 2. The runtime DSH exports to its child processes.
    $fromDsh = Get-MecElectronRuntime $env:DSH_DESKTOP_NODE_EXECUTABLE
    if ($null -ne $fromDsh) { return $fromDsh }

    # 3. The application recorded by its Windows uninstall entry.
    $locations = New-Object System.Collections.Generic.List[string]
    $uninstallRoots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($root in $uninstallRoots) {
        try {
            $entries = Get-ItemProperty -Path $root -ErrorAction SilentlyContinue
            foreach ($entry in @($entries)) {
                if ($null -eq $entry) { continue }
                $nameProperty = $entry.PSObject.Properties['DisplayName']
                $name = if ($null -eq $nameProperty) { '' } else { [string]$nameProperty.Value }
                if ($name -notlike '*DeepSeek Harness*' -and $name -notlike '*deepseek-harness*') { continue }
                $locationProperty = $entry.PSObject.Properties['InstallLocation']
                $location = if ($null -eq $locationProperty) { '' } else { [string]$locationProperty.Value }
                if (-not [string]::IsNullOrWhiteSpace($location)) { $locations.Add($location) }
            }
        } catch {
            # A missing or unreadable hive is not a failure.
        }
    }

    # 4. Conventional electron-builder install directories.
    $localAppData = [Environment]::GetEnvironmentVariable('LOCALAPPDATA')
    $programFiles = [Environment]::GetEnvironmentVariable('ProgramFiles')
    $programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    if (-not [string]::IsNullOrWhiteSpace($localAppData)) {
        $locations.Add((Join-Path $localAppData 'Programs\DeepSeek Harness'))
        $locations.Add((Join-Path $localAppData 'Programs\deepseek-harness'))
        $locations.Add((Join-Path $localAppData 'DeepSeek Harness'))
    }
    foreach ($programDir in @($programFiles, $programFilesX86)) {
        if ([string]::IsNullOrWhiteSpace($programDir)) { continue }
        $locations.Add((Join-Path $programDir 'DeepSeek Harness'))
        $locations.Add((Join-Path $programDir 'deepseek-harness'))
    }

    $executableNames = @(
        'DeepSeek Harness.exe',
        'DeepSeekHarness.exe',
        'deepseek-harness.exe',
        'dsh-desktop.exe'
    )
    foreach ($location in $locations) {
        if ([string]::IsNullOrWhiteSpace($location)) { continue }
        if (-not (Test-Path -LiteralPath $location -PathType Container)) { continue }
        foreach ($name in $executableNames) {
            $runtime = Get-MecElectronRuntime (Join-Path $location $name)
            if ($null -ne $runtime) { return $runtime }
        }
    }

    return $null
}

function Invoke-MecNodeScript {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [string[]]$ScriptArgs = @(),
        [ValidateSet('install', 'uninstall', 'verify')][string]$Action = 'install'
    )

    $runtime = Get-MecNodeRuntime
    if ($null -eq $runtime) {
        Write-Host ''
        Write-Host "[$Action] FAILED: could not find Node.js or a DeepSeek Harness Desktop installation." -ForegroundColor Red
        Write-Host '  Fix one of these:' -ForegroundColor Yellow
        Write-Host '    1. Open DeepSeek Harness Desktop once and install its command:'
        Write-Host '       application menu -> Manage dsh Command... -> Install.'
        Write-Host '       Quit Desktop fully, then run (no Node.js needed):'
        Write-Host '         dsh plugin --profile desktop add github:Dreamaniax/dsh-model-effort-chips'
        Write-Host '    2. Or install Node.js LTS from https://nodejs.org and run this launcher again.'
        exit 2
    }

    $restoreElectron = $null
    if ($runtime.Kind -eq 'electron') {
        $restoreElectron = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
        $env:ELECTRON_RUN_AS_NODE = '1'
    }

    try {
        $arguments = @($runtime.Prefix) + @($ScriptPath) + @($ScriptArgs)
        & $runtime.File @arguments
        exit $LASTEXITCODE
    } finally {
        if ($runtime.Kind -eq 'electron') {
            if ($null -eq $restoreElectron) {
                Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
            } else {
                $env:ELECTRON_RUN_AS_NODE = $restoreElectron
            }
        }
    }
}
