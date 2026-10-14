# Reanuda la verificacion del funnel contra el staging de Mercantil.
# Uso (desde la raiz del proyecto):  powershell -ExecutionPolicy Bypass -File scripts\verificacion\reanudar.ps1
#
# Que hace:
#  1. Levanta el dev server si no esta corriendo.
#  2. Prueba si la API de Aliados de staging respondio (si sigue en 500, avisa y sale).
#  3. Si respondio, re-verifica montos emitidos, carrito de 2 polizas + notify, y Funerario.

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
Set-Location $root

Write-Host "=== 1. Dev server ===" -ForegroundColor Cyan
$vivo = $false
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:4321/api/mercantil/__ping__' -TimeoutSec 15 -UseBasicParsing
} catch {
  # 403 = el proxy contesto (ruta fuera de allowlist) => el server esta vivo
  if ($_.Exception.Response.StatusCode.value__ -eq 403) { $vivo = $true }
}
if ($vivo) {
  Write-Host "Ya esta corriendo en http://localhost:4321" -ForegroundColor Green
} else {
  Write-Host "No responde -> iniciando npm run dev en segundo plano" -ForegroundColor Yellow
  Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory $root -WindowStyle Hidden
  for ($i = 0; $i -lt 24; $i++) {
    Start-Sleep -Seconds 5
    try { Invoke-WebRequest -Uri 'http://localhost:4321/api/mercantil/__ping__' -TimeoutSec 10 -UseBasicParsing | Out-Null }
    catch { if ($_.Exception.Response.StatusCode.value__ -eq 403) { Write-Host "Dev server arriba" -ForegroundColor Green; break } }
  }
}

Write-Host ""
Write-Host "=== 2. Verificacion contra staging ===" -ForegroundColor Cyan
node scripts\verificacion\reverificar.mjs
