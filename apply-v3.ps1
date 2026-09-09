param([string]$Target = ".")
$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path "$Target/editor-core", "$Target/docs", "$Target/browser-benchmark" | Out-Null
Copy-Item "$Source/editor-core/*" "$Target/editor-core/" -Force
Copy-Item "$Source/docs/*" "$Target/docs/" -Force
Copy-Item "$Source/browser-benchmark/*" "$Target/browser-benchmark/" -Recurse -Force
Copy-Item "$Source/python" "$Target/python" -Recurse -Force
Write-Host "editor-core v3 patch applied to $Target"
