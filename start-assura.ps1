$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$assistantDir = Join-Path $repoRoot "assistant"

function New-AssuraCommand {
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

  return $fullCommand
}

function Start-AssuraWindow {
  param(
    [string]$Title,
    [string]$WorkingDirectory,
    [string]$Command
  )

  $fullCommand = New-AssuraCommand -Title $Title -WorkingDirectory $WorkingDirectory -Command $Command

  Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-Command", $fullCommand
  )
}

function Start-AssuraTabs {
  $tabSpecs = @(
    @{
      Title = "Assura Poller"
      WorkingDirectory = $assistantDir
      Command = "npm run poll"
    }
  )

  $argumentList = @("-w", "0")

  for ($index = 0; $index -lt $tabSpecs.Count; $index += 1) {
    $tabSpec = $tabSpecs[$index]
    $fullCommand = New-AssuraCommand -Title $tabSpec.Title -WorkingDirectory $tabSpec.WorkingDirectory -Command $tabSpec.Command

    $argumentList += @(
      "new-tab",
      "--title", $tabSpec.Title,
      "--startingDirectory", $tabSpec.WorkingDirectory,
      "powershell.exe",
      "-NoExit",
      "-ExecutionPolicy", "Bypass",
      "-Command", $fullCommand
    )

    if ($index -lt ($tabSpecs.Count - 1)) {
      $argumentList += ";"
    }
  }

  & wt @argumentList
}

if (Get-Command wt -ErrorAction SilentlyContinue) {
  Start-AssuraTabs
} else {
  Start-AssuraWindow -Title "Assura Poller" -WorkingDirectory $assistantDir -Command "npm run poll"
}
