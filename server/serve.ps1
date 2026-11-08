# Serve the Transcriber web UI on http://127.0.0.1:8000 and proxy /ollama/*
# to a local Ollama server (Windows fallback, no Python needed).
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Port = 8000
$Ollama = 'http://127.0.0.1:11434'

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
    $path = $req.Url.AbsolutePath

    # --- /ollama/* proxy ----------------------------------------------------
    if ($path.StartsWith('/ollama')) {
        $target = $Ollama + $path.Substring('/ollama'.Length) + $req.Url.Query
        try {
            $owr = [System.Net.HttpWebRequest]::Create($target)
            $owr.Method = $req.HttpMethod
            $owr.Timeout = 300000
            if ($req.ContentLength64 -gt 0) {
                $owr.ContentType = $req.ContentType
                $body = New-Object byte[] ([int]$req.ContentLength64)
                $read = 0
                while ($read -lt $req.ContentLength64) {
                    $n = $req.InputStream.Read($body, $read, [int]($req.ContentLength64 - $read))
                    if ($n -le 0) { break }
                    $read += $n
                }
                $os = $owr.GetRequestStream()
                $os.Write($body, 0, $body.Length)
                $os.Close()
            }
            $oresp = $owr.GetResponse()
            $rs = $oresp.GetResponseStream()
            $ms = New-Object System.IO.MemoryStream
            $rs.CopyTo($ms)
            $data = $ms.ToArray()
            $res.StatusCode = [int]$oresp.StatusCode
            $res.ContentType = $oresp.ContentType
            $res.ContentLength64 = $data.Length
            $res.OutputStream.Write($data, 0, $data.Length)
            $oresp.Close()
        } catch {
            $msg = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Ollama is not running"}')
            $res.StatusCode = 502
            $res.ContentType = 'application/json'
            $res.ContentLength64 = $msg.Length
            $res.OutputStream.Write($msg, 0, $msg.Length)
        }
        $res.Close()
        continue
    }

    # --- static file serving ------------------------------------------------
    $rel = $path.TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $full = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))

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
