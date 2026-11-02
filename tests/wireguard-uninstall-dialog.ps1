function Invoke-RadioUninstall([string]$Uninstaller, [string]$AppExe, [bool]$RemoveWireGuard, [string]$TestLog) {
    if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
        throw 'Interactive destructive test is restricted to disposable GitHub-hosted Windows runners.'
    }
    if (-not ('VpnukUninstallDialog' -as [type])) { Add-Type -Path (Join-Path $PSScriptRoot 'UninstallDialog.cs') }
    # Intentionally no /S or /REMOVEWIREGUARD. Exercise the real displayed page.
    $process = Start-Process -FilePath $Uninstaller -PassThru
    $selectionSeen = $false
    $selectionConfirmed = $false
    $clicked = @{}
    $deadline = (Get-Date).AddSeconds(300)
    try {
        while ((Get-Date) -lt $deadline) {
            $dialogs = @([VpnukUninstallDialog]::Dialogs())
            $appPresent = Test-Path -LiteralPath $AppExe
            # Electron-builder intentionally shows extras AFTER the main
            # VPNUK removal. Require the radio selection before accepting completion,
            # but do not confuse that supported page order with a failure.
            if (-not $appPresent -and -not $dialogs.Count -and $selectionConfirmed) {
                Write-Host "PASS actual uninstall radio removal=$RemoveWireGuard and wizard completed"
                return
            }
            foreach ($dialog in $dialogs) {
                $controls = @([VpnukUninstallDialog]::Children($dialog.Handle))
                $heading = @($controls | Where-Object { $_.ClassName -eq 'Static' -and $_.Text -eq 'Uninstall WireGuard' })
                $nextHeading = @($controls | Where-Object { $_.ClassName -eq 'Static' -and $_.Text -eq 'Clear application user data' })
                # Once verified, do not send synchronous radio-button messages
                # while page leave is busy running native cleanup.
                if ($heading.Count -eq 1 -and $nextHeading.Count -eq 1 -and -not $selectionConfirmed) {
                    $options = @($controls | Where-Object {
                        $_.ClassName -eq 'Button' -and $_.Top -gt $heading[0].Top -and
                        $_.Top -lt $nextHeading[0].Top -and $_.Text -in @('Yes', 'No')
                    })
                    $yes = @($options | Where-Object { $_.Text -eq 'Yes' })
                    $no = @($options | Where-Object { $_.Text -eq 'No' })
                    if ($yes.Count -ne 1 -or $no.Count -ne 1) { throw 'WireGuard Yes/No choices were not found.' }
                    if (-not $selectionSeen) {
                        if ([VpnukUninstallDialog]::Checked($yes[0].Handle) -ne 0 -or
                            [VpnukUninstallDialog]::Checked($no[0].Handle) -ne 1) {
                            throw 'WireGuard removal must default to No.'
                        }
                        $selectionSeen = $true
                        Add-Content -LiteralPath $TestLog -Value "Displayed real Yes/No radios; requested removal=$RemoveWireGuard"
                        if ($RemoveWireGuard) {
                            [VpnukUninstallDialog]::Click($yes[0].Handle)
                            $checkDeadline = (Get-Date).AddSeconds(3)
                            while ([VpnukUninstallDialog]::Checked($yes[0].Handle) -ne 1 -and (Get-Date) -lt $checkDeadline) {
                                Start-Sleep -Milliseconds 50
                            }
                        }
                    }
                    $expected = 0
                    if ($RemoveWireGuard) { $expected = 1 }
                    if ([VpnukUninstallDialog]::Checked($yes[0].Handle) -ne $expected -or
                        [VpnukUninstallDialog]::Checked($no[0].Handle) -ne (1 - $expected)) {
                        throw 'Actual radio state did not match the requested selection.'
                    }
                    $selectionConfirmed = $true
                }
                $primary = @($controls | Where-Object {
                    $_.ClassName -eq 'Button' -and $_.Enabled -and $_.Id -eq 1 -and
                    ($_.Text -replace '&', '') -match '^(Next\s*>?|Uninstall|Close|Finish)$'
                })
                # A page signature prevents repeated queued clicks while NSIS
                # is running cleanup inside its page-leave callback.
                $signature = ($controls | ForEach-Object { "$($_.Handle):$($_.Text)" }) -join '|'
                if ($primary.Count -eq 1 -and -not $clicked.ContainsKey($signature)) {
                    $clicked[$signature] = $true
                    Add-Content -LiteralPath $TestLog -Value ("Wizard action: " + $primary[0].Text)
                    [VpnukUninstallDialog]::Click($primary[0].Handle)
                }
            }
            Start-Sleep -Milliseconds 250
        }
        $visible = @([VpnukUninstallDialog]::Dialogs() | ForEach-Object {
            $_.Text
            [VpnukUninstallDialog]::Children($_.Handle) | ForEach-Object { $_.Text }
        }) -join ' | '
        throw "Interactive uninstall timed out. Displayed text: $visible"
    } finally { $process.Dispose() }
}
