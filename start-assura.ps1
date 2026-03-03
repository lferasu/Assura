$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$assistantDir = Join-Path $repoRoot "assistant"
$mobileDir = Join-Path $repoRoot "mobile"

function Start-AssuraWindow {
  param(
    [string]$Title,
    [string]$WorkingDirectory,
    [string]$Command
  )

  $escapedWorkingDirectory = $WorkingDirectory.Replace("'", "''")
  $fullCommand = @(
    "`$Host.UI.RawUI.WindowTitle = '$Title'"
    "Set-Location '$escapedWorkingDirectory'"
    $Command
  ) -join "; "

  Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-Command", $fullCommand
  )
}

Start-AssuraWindow -Title "Assura Poller" -WorkingDirectory $assistantDir -Command "npm run poll"
Start-AssuraWindow -Title "Assura API" -WorkingDirectory $assistantDir -Command "npm run api"
Start-AssuraWindow -Title "Assura Mobile" -WorkingDirectory $mobileDir -Command "npm run start"
