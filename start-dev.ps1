param([switch]$Watch)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$taskNodeVersion = [version](& node -p 'process.versions.node')
if ($LASTEXITCODE -ne 0 -or $taskNodeVersion -lt [version]'22.12.0') {
    throw 'Raazi requires Node.js 22.12 or newer.'
}
$env:AUTH_MODE = 'development'
$env:HOST = '127.0.0.1'
$env:COOKIE_SECURE = 'false'
if (-not $env:SECRET_KEY) {
    $taskSecretBytes = New-Object byte[] 32
    $taskRandom = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $taskRandom.GetBytes($taskSecretBytes)
        $env:SECRET_KEY = [System.BitConverter]::ToString($taskSecretBytes).Replace('-', '').ToLowerInvariant()
    } finally {
        $taskRandom.Dispose()
    }
}
if ($env:SECRET_KEY.Length -lt 32) {
    throw 'SECRET_KEY must contain at least 32 characters. Clear the invalid process value or set a valid signing secret.'
}
if (-not (Test-Path -LiteralPath 'node_modules')) {
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
Write-Host 'Development login grants administrator access. Keep this server local.'
if ($Watch) {
    Write-Host 'React development interface: http://127.0.0.1:5173'
    & npm run dev
} else {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed.' }
    Write-Host 'Raazi workspace: http://127.0.0.1:8080'
    & npm start
}
