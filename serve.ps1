param(
    [int]$Port = 5500,
    [string]$BindHost = "localhost"
)

$root = $PSScriptRoot
$prefix = "http://${BindHost}:${Port}/"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Output "Serving $root at $prefix (Ctrl+C to stop)"

$mimeTypes = @{
    '.html' = 'text/html'
    '.css'  = 'text/css'
    '.js'   = 'application/javascript'
    '.json' = 'application/json'
    '.png'  = 'image/png'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try {
            $request = $context.Request
            $response = $context.Response
            $response.KeepAlive = $false
            $response.SendChunked = $false

            $localPath = $request.Url.LocalPath
            if ($localPath -eq '/') { $localPath = '/index.html' }
            $relative = $localPath.TrimStart('/') -replace '/', [IO.Path]::DirectorySeparatorChar
            $filePath = Join-Path $root $relative

            if ((Test-Path $filePath -PathType Leaf) -and $request.HttpMethod -in @('GET', 'HEAD')) {
                $ext = [IO.Path]::GetExtension($filePath)
                $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
                $bytes = [IO.File]::ReadAllBytes($filePath)
                $response.ContentType = $contentType
                $response.ContentLength64 = [int64]$bytes.Length
                if ($request.HttpMethod -eq 'GET' -and $bytes.Length -gt 0) {
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                }
            } else {
                $response.StatusCode = 404
                $notFound = [Text.Encoding]::UTF8.GetBytes("404 Not Found: $localPath")
                $response.ContentLength64 = [int64]$notFound.Length
                $response.OutputStream.Write($notFound, 0, $notFound.Length)
            }
        } catch {
            Write-Output "Request error: $_"
        } finally {
            try { $context.Response.OutputStream.Close() } catch {}
            try { $context.Response.Close() } catch {}
        }
    }
} finally {
    $listener.Stop()
}
