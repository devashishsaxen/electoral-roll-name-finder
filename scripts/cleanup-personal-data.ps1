# Run locally from PowerShell to delete generated personal-data artifacts.
# Source, tests, dependencies, and Git history are preserved.
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskPrefix = $taskRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$taskNames = @(
    'downloads', 'debug', 'candidate_images', '.cache', '.verification',
    'results', '__pycache__', 'tests/__pycache__', 'release',
    'candidate_pages.json'
)
$taskNames += @(Get-ChildItem -LiteralPath $taskRoot -File -Filter '*.txt' |
    Where-Object { $_.Name -ne 'requirements.txt' } |
    ForEach-Object { $_.Name })
$taskPaths = @()
foreach ($taskName in $taskNames) {
    $taskPath = [IO.Path]::GetFullPath((Join-Path $taskRoot $taskName))
    if (-not $taskPath.StartsWith($taskPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Target outside project: $taskPath"
    }
    if (Test-Path -LiteralPath $taskPath) {
        $taskItem = Get-Item -LiteralPath $taskPath -Force
        if ($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            # OneDrive placeholders can be reparse points. Confirm resolution
            # remains in this project; reject actual symbolic links/junctions.
            if ($taskItem.LinkType) { throw "Linked target requires manual review: $taskPath" }
        }
        if ($taskItem.PSIsContainer) {
            $taskLinked = Get-ChildItem -LiteralPath $taskPath -Recurse -Force |
                Where-Object { $_.LinkType }
            if ($taskLinked) { throw "Linked entries require manual review: $taskPath" }
        }
        $taskPaths += $taskPath
    }
}
foreach ($taskPath in $taskPaths) {
    Remove-Item -LiteralPath $taskPath -Recurse -Force
}
Write-Output "Removed $($taskPaths.Count) data/artifact targets within $taskRoot."
Write-Output 'To create a fresh source-only export, run: npm run release:prepare'
