# Serve the Transcriber web UI on http://127.0.0.1:8000 (Windows fallback, no Python needed).
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Port = 8000

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Transcriber UI -> http://127.0.0.1:$Port  (Ctrl+C to stop)"

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.png'  = 'image/png'
}

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    $rel = $req.Url.AbsolutePath.TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $full = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))

    # Block path traversal; fall back to index.html for missing files (SPA).
    if (-not $full.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $full = [System.IO.Path]::GetFullPath((Join-Path $Root 'index.html'))
    }

    $ext = [System.IO.Path]::GetExtension($full).ToLower()
    $ct = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
    $bytes = [System.IO.File]::ReadAllBytes($full)

    $res.StatusCode = 200
    $res.ContentType = $ct
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.Close()
}
