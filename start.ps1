$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path -LiteralPath 'node_modules')) {
  Write-Host '正在安装依赖…'
  npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install 失败' }
}
if (-not (Test-Path -LiteralPath 'dist/index.html')) {
  Write-Host '正在构建网页…'
  npm run build
  if ($LASTEXITCODE -ne 0) { throw '构建失败' }
}
Write-Host 'TeXloom 将在 http://127.0.0.1:3001 启动'
npm run start
