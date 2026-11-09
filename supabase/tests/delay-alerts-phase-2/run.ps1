$ErrorActionPreference = 'Stop'
$runId = [guid]::NewGuid().ToString('N')
$project = "knittrack-delay-alerts-$runId"
$migrationRole = 'postgres'
$projectEnvName = 'KNITTRACK_DELAY_TEST_COMPOSE_PROJECT'
$previousProjectEnv = [Environment]::GetEnvironmentVariable($projectEnvName, 'Process')
$compose = Join-Path $PSScriptRoot 'compose.yaml'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$stackAttempted = $false
$locationPushed = $false

try {
  Push-Location $repoRoot
  $locationPushed = $true
  [Environment]::SetEnvironmentVariable($projectEnvName, $project, 'Process')
  $stackAttempted = $true
  docker compose --project-name $project --file $compose up --detach --wait
  if ($LASTEXITCODE -ne 0) { throw 'Could not start the disposable PostgreSQL container.' }

  # bootstrap.sql has already run as knittrack_bootstrap. The migration and
  # subsequent SQL checks use the explicitly provisioned non-superuser role.
  docker compose --project-name $project --file $compose exec --no-TTY db psql `
    --username $migrationRole --dbname postgres --set ON_ERROR_STOP=1 `
    --file /workspace/supabase/proposals/delay-alerts-phase-2.sql
  if ($LASTEXITCODE -ne 0) { throw 'The proposal failed in the disposable PostgreSQL database.' }

  node supabase/tests/delay-alerts-phase-2/hmac-interop.mjs
  if ($LASTEXITCODE -ne 0) { throw 'The Node/PostgreSQL HMAC interoperability check failed.' }

  docker compose --project-name $project --file $compose exec --no-TTY db psql `
    --username $migrationRole --dbname postgres --set ON_ERROR_STOP=1 `
    --file /workspace/supabase/tests/delay-alerts-phase-2/verification.sql
  if ($LASTEXITCODE -ne 0) { throw 'Post-migration privilege/security assertions failed.' }

  docker compose --project-name $project --file $compose exec --no-TTY db psql `
    --username $migrationRole --dbname postgres --set ON_ERROR_STOP=1 `
    --file /workspace/supabase/tests/delay-alerts-phase-2/rounding.sql
  if ($LASTEXITCODE -ne 0) { throw 'The PostgreSQL rounding differential assertions failed.' }

  docker compose --project-name $project --file $compose exec --no-TTY db psql `
    --username $migrationRole --dbname postgres --set ON_ERROR_STOP=1 `
    --file /workspace/supabase/tests/delay-alerts-phase-2/integration.sql
  if ($LASTEXITCODE -ne 0) { throw 'Delay-alert integration assertions failed.' }

  node supabase/tests/delay-alerts-phase-2/concurrent-approval.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Concurrent approval and buyer-isolation assertions failed.' }

  docker compose --project-name $project --file $compose exec --no-TTY db psql `
    --username $migrationRole --dbname postgres --set ON_ERROR_STOP=1 `
    --file /workspace/supabase/tests/delay-alerts-phase-2/supersede.sql
  if ($LASTEXITCODE -ne 0) { throw 'Non-candidate superseding assertions failed.' }
}
finally {
  try {
    if ($stackAttempted) {
      docker compose --project-name $project --file $compose down --volumes --remove-orphans
      if ($LASTEXITCODE -ne 0) { throw 'Cleanup failed for this run-specific Compose project.' }
    }
  }
  finally {
    [Environment]::SetEnvironmentVariable($projectEnvName, $previousProjectEnv, 'Process')
    if ($locationPushed) { Pop-Location }
  }
}
