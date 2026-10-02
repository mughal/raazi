$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$env:AUTH_MODE = 'development'
$env:COOKIE_SECURE = 'false'
if (-not $env:SECRET_KEY) {
    $env:SECRET_KEY = & .venv/Scripts/python -c 'import secrets; print(secrets.token_hex(32))'
}
Write-Host 'Raazi development workspace: http://127.0.0.1:8080'
Write-Host 'Development login grants administrator access. Keep this server local.'
& .venv/Scripts/python app.py
