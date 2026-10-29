Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set workerShell = CreateObject("WScript.Shell")
projectRoot = fileSystem.GetParentFolderName(fileSystem.GetParentFolderName(WScript.ScriptFullName))
workerShell.CurrentDirectory = projectRoot
workerShell.Run """" & WScript.Arguments(0) & """ """ & projectRoot & "\scripts\start-worker.cjs""", 0, False
