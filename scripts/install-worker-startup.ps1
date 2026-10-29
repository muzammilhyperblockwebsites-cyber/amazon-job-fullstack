$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$launcher = Join-Path $projectRoot 'scripts\start-worker.cjs'
$compiledWorker = Join-Path $projectRoot '.worker\automation-worker.js'
if (-not (Test-Path -LiteralPath $compiledWorker)) {
    throw 'Build the worker first: npm run build:worker'
}
$startupFolder = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder 'Amazon Job Worker.lnk'
$shellObject = New-Object -ComObject WScript.Shell
$shortcut = $shellObject.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $nodeExecutable
$shortcut.Arguments = '"' + $launcher + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Connect the Amazon job worker to the dashboard when you sign into Windows.'
$shortcut.Save()
Write-Output "Worker startup installed: $shortcutPath"
