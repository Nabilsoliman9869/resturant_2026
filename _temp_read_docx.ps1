Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('E:\XTRA_WEB\مطاعم\متطلبات_نظام_المطعم.docx')
$entry = $zip.GetEntry('word/document.xml')
$reader = New-Object System.IO.StreamReader($entry.Open())
$xml = $reader.ReadToEnd()
$reader.Close()
$zip.Dispose()
$text = $xml -replace '<[^>]+>', ' ' -replace '\s+', ' '
$text | Out-File -FilePath 'E:\XTRA_WEB\مطاعم\_temp_req.txt' -Encoding UTF8
Write-Output "done"
