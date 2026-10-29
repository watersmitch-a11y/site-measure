Add-Type -AssemblyName System.Drawing

function New-Icon {
    param(
        [string]$OutFile,
        [int]$Size,
        [double]$SafeZoneRatio  # fraction of size the artwork should stay within (for maskable icons)
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::FromArgb(255, 31, 111, 67)) # #1f6f43 background, edge-to-edge

    $margin = $Size * (1 - $SafeZoneRatio) / 2
    $inner = $Size - 2 * $margin

    # white rounded square "plan sheet"
    $sheetMargin = $margin + $inner * 0.08
    $sheetSize = $Size - 2 * $sheetMargin
    $sheetX = $sheetMargin
    $sheetY = $sheetMargin
    $r = $sheetSize * 0.12

    $gpath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $gpath.AddArc($sheetX, $sheetY, $r, $r, 180, 90)
    $gpath.AddArc($sheetX + $sheetSize - $r, $sheetY, $r, $r, 270, 90)
    $gpath.AddArc($sheetX + $sheetSize - $r, $sheetY + $sheetSize - $r, $r, $r, 0, 90)
    $gpath.AddArc($sheetX, $sheetY + $sheetSize - $r, $r, $r, 90, 90)
    $gpath.CloseFigure()
    $whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 238, 242, 245))
    $g.FillPath($whiteBrush, $gpath)

    # orange L-shaped floor plan corner
    $accentColor = [System.Drawing.Color]::FromArgb(255, 255, 159, 28)
    $pen = [System.Drawing.Pen]::new($accentColor, [double]($sheetSize * 0.09))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $x0 = $sheetX + $sheetSize * 0.28
    $y0 = $sheetY + $sheetSize * 0.72
    $x1 = $sheetX + $sheetSize * 0.28
    $y1 = $sheetY + $sheetSize * 0.30
    $x2 = $sheetX + $sheetSize * 0.74
    $y2 = $sheetY + $sheetSize * 0.30

    $pts = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new([float]$x0, [float]$y0),
        [System.Drawing.PointF]::new([float]$x1, [float]$y1),
        [System.Drawing.PointF]::new([float]$x2, [float]$y2)
    )
    $g.DrawLines($pen, $pts)

    # small dot at the corner start (start marker, echoes the in-app plan)
    $dotR = $sheetSize * 0.05
    $greenBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 46, 204, 113))
    $g.FillEllipse($greenBrush, [float]($x0 - $dotR), [float]($y0 - $dotR), [float]($dotR * 2), [float]($dotR * 2))

    $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

$iconsDir = Join-Path $PSScriptRoot 'icons'
if (-not (Test-Path $iconsDir)) { New-Item -ItemType Directory -Path $iconsDir | Out-Null }

New-Icon -OutFile (Join-Path $iconsDir 'icon-192.png') -Size 192 -SafeZoneRatio 1.0
New-Icon -OutFile (Join-Path $iconsDir 'icon-512.png') -Size 512 -SafeZoneRatio 1.0
New-Icon -OutFile (Join-Path $iconsDir 'icon-maskable-512.png') -Size 512 -SafeZoneRatio 0.7

Write-Output "Icons generated in $iconsDir"
