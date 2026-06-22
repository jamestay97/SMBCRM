# Replay a Vapi end-of-call webhook without placing a phone call.
# Wrapper around scripts/replay-voice-webhook.mjs
#
# Examples:
#   .\scripts\replay-voice-webhook.ps1
#   .\scripts\replay-voice-webhook.ps1 -Production
#   .\scripts\replay-voice-webhook.ps1 -Url http://localhost:3000 -CallId replay-001

param(
  [string]$Url,
  [switch]$Production,
  [string]$Org,
  [string]$CallId,
  [string]$Fixture,
  [string]$Caller,
  [switch]$DryRun,
  [switch]$Help
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeScript = Join-Path $scriptDir "replay-voice-webhook.mjs"
$argsList = @()

if ($Help) { $argsList += "--help" }
if ($Production) { $argsList += "--production" }
if ($Url) { $argsList += "--url", $Url }
if ($Org) { $argsList += "--org", $Org }
if ($CallId) { $argsList += "--call-id", $CallId }
if ($Fixture) { $argsList += "--fixture", $Fixture }
if ($Caller) { $argsList += "--caller", $Caller }
if ($DryRun) { $argsList += "--dry-run" }

node $nodeScript @argsList
exit $LASTEXITCODE
