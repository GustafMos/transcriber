# Transcriber installer (Windows). Asks GPU or CPU, downloads the whisper.cpp
# backend (prebuilt binary) and the model, then tells you how to run.
$ErrorActionPreference = 'Stop'

$Root       = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $Root 'backend'
$BinDir     = Join-Path $BackendDir 'bin'
$ModelDir   = Join-Path $Root 'models'
$Model      = Join-Path $ModelDir 'ggml-small.bin'
$ModelUrl   = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin'
$NightlyFallback = 'b5454'

Write-Host ''
Write-Host '=============================================================='
Write-Host '  Transcriber - local speech-to-text installer (Windows)'
Write-Host '=============================================================='
Write-Host ''
Write-Host 'How do you want to run Whisper?'
Write-Host '  [1] GPU  - CUDA (NVIDIA GPU + driver)   ~684 MB download'
Write-Host '  [2] CPU  - works on any machine          ~9 MB download'
$choice = Read-Host 'Choose 1 or 2 (default 2)'
if ($choice -notin '1','2') { $choice = '2' }

New-Item -ItemType Directory -Force -Path $BackendDir, $BinDir, $ModelDir | Out-Null

# Resolve the latest whisper.cpp nightly tag (prebuilt binaries are published there).
$tag = $NightlyFallback
try {
    $releases = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=30' -Headers @{ 'User-Agent' = 'transcriber-installer' }
    $nightly = $releases | Where-Object { $_.prerelease -and $_.tag_name -match '^b\d+$' } | Select-Object -First 1
    if ($nightly) { $tag = $nightly.tag_name }
} catch {
    Write-Host "Could not resolve the latest build, using $tag"
}

if ($choice -eq '1') { $asset = 'whisper-bin-win-cuda-12.4.0-x64.zip' }
else                 { $asset = 'whisper-bin-x64.zip' }

$url = "https://github.com/ggml-org/whisper.cpp/releases/download/$tag/$asset"
$zip = Join-Path $BackendDir $asset

Write-Host ''
Write-Host "Downloading $asset ..."
Invoke-WebRequest -Uri $url -OutFile $zip

Write-Host 'Extracting ...'
Expand-Archive -Path $zip -DestinationPath $BackendDir -Force
Remove-Item $zip -ErrorAction SilentlyContinue

# Locate whisper-server.exe and copy its whole folder (exe + required DLLs) into backend\bin.
$server = Get-ChildItem -Path $BackendDir -Recurse -Filter 'whisper-server.exe' | Select-Object -First 1
if (-not $server) {
    Write-Host 'Could not find whisper-server.exe in the downloaded archive.' -ForegroundColor Red
    exit 1
}
Copy-Item -Path (Join-Path $server.DirectoryName '*') -Destination $BinDir -Recurse -Force

# Download the model (multilingual small).
if (-not (Test-Path $Model)) {
    Write-Host ''
    Write-Host 'Downloading ggml-small.bin (~466 MB) ...'
    Invoke-WebRequest -Uri $ModelUrl -OutFile $Model
} else {
    Write-Host 'Model already present.'
}

Write-Host ''
Write-Host 'Done! Start the tool with:'
Write-Host "  $Root\installer\run.bat"
Write-Host ''
