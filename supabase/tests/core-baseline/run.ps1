$ErrorActionPreference = 'Stop'

$runId = [guid]::NewGuid().ToString('N')
$project = "knittrack-core-baseline-$runId"
$compose = Join-Path $PSScriptRoot 'compose.yaml'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$stackAttempted = $false
$locationPushed = $false
$dockerPath = $null

function Invoke-CapturedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  # Use Process redirection instead of a native-command pipeline: Windows
  # PowerShell can promote native stderr records to terminating errors when
  # ErrorActionPreference is Stop, even when a nonzero exit is expected.
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = (($Arguments | ForEach-Object {
    '"' + ([string]$_).Replace('"', '\"') + '"'
  }) -join ' ')
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw "Could not start process: $FilePath" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      StdOut = $stdout
      StdErr = $stderr
      CombinedOutput = "$stdout`n$stderr"
    }
  }
  finally {
    $process.Dispose()
  }
}

function Invoke-ComposePsql {
  param(
    [Parameter(Mandatory = $true)][string]$User,
    [Parameter(Mandatory = $true)][string]$File
  )
  docker compose --project-name $project --file $compose exec --no-TTY db psql `
    --username $User --dbname postgres --set ON_ERROR_STOP=1 --file $File
  if ($LASTEXITCODE -ne 0) { throw "Disposable SQL step failed: $File" }
}

try {
  $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $dockerCommand) {
    throw 'Docker CLI is required to run this disposable PostgreSQL 17 suite.'
  }
  $dockerPath = $dockerCommand.Source
  Push-Location $repoRoot
  $locationPushed = $true
  $stackAttempted = $true
  docker compose --project-name $project --file $compose up --detach --wait
  if ($LASTEXITCODE -ne 0) { throw 'Could not start the disposable core-baseline PostgreSQL container.' }

  # Apply the proposed baseline in timestamp order using a non-superuser role.
  Invoke-ComposePsql -User 'postgres' -File '/workspace/supabase/migrations/20261109090001_core_schema.sql'
  Invoke-ComposePsql -User 'postgres' -File '/workspace/supabase/migrations/20261109090002_core_security.sql'

  # The seed must fail atomically while its five Auth users are missing.
  $missingAuthResult = Invoke-CapturedProcess -FilePath $dockerPath -Arguments @(
    'compose','--project-name',$project,'--file',$compose,'exec','--no-TTY','db','psql',
    '--username','postgres','--dbname','postgres','--set','ON_ERROR_STOP=1',
    '--file','/workspace/supabase/seed/staging_demo.sql'
  )
  if ($missingAuthResult.ExitCode -eq 0) { throw 'Seed unexpectedly succeeded without its synthetic Auth users.' }
  if ($missingAuthResult.CombinedOutput -notlike '*Create the five documented synthetic QA users in staging Auth before running this seed.*') {
    throw "Seed failed without the expected missing-Auth-users message. Exit code: $($missingAuthResult.ExitCode). Output: $($missingAuthResult.CombinedOutput)"
  }
  Invoke-ComposePsql -User 'postgres' -File '/workspace/supabase/tests/core-baseline/seed_missing_assert.sql'

  # Only the fixed synthetic identities are inserted, by the disposable
  # fixture bootstrap superuser; no password or external service is involved.
  Invoke-ComposePsql -User 'knittrack_core_bootstrap' -File '/workspace/supabase/tests/core-baseline/auth-users.sql'
  Invoke-ComposePsql -User 'postgres' -File '/workspace/supabase/seed/staging_demo.sql'

  # Duplicate execution must abort before changing any staged demo records.
  $duplicateSeedResult = Invoke-CapturedProcess -FilePath $dockerPath -Arguments @(
    'compose','--project-name',$project,'--file',$compose,'exec','--no-TTY','db','psql',
    '--username','postgres','--dbname','postgres','--set','ON_ERROR_STOP=1',
    '--file','/workspace/supabase/seed/staging_demo.sql'
  )
  if ($duplicateSeedResult.ExitCode -eq 0) { throw 'Seed unexpectedly succeeded when duplicate staging IDs/POs existed.' }
  if ($duplicateSeedResult.CombinedOutput -notlike '*Synthetic staging seed IDs or PO numbers already exist; inspect before reseeding.*') {
    throw "Seed failed without the expected duplicate-record message. Exit code: $($duplicateSeedResult.ExitCode). Output: $($duplicateSeedResult.CombinedOutput)"
  }
  Invoke-ComposePsql -User 'postgres' -File '/workspace/supabase/tests/core-baseline/seed_duplicate_assert.sql'

  Invoke-ComposePsql -User 'postgres' -File '/workspace/supabase/tests/core-baseline/integration.sql'
  Write-Output 'Core baseline disposable PostgreSQL 17 integration suite passed.'
}
finally {
  try {
    if ($stackAttempted) {
      docker compose --project-name $project --file $compose down --volumes --remove-orphans
      if ($LASTEXITCODE -ne 0) { throw 'Cleanup failed for this run-specific Compose project.' }
    }
  }
  finally {
    if ($locationPushed) { Pop-Location }
  }
}
