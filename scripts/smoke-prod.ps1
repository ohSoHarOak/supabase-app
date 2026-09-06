<#
  smoke-prod.ps1 - Post-deploy smoke test for Sit.Stay.Play (Workstream M / M0).

  NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads BOM-less files as
  ANSI (CP1252), so a UTF-8 em-dash decodes to a smart quote that PowerShell treats
  as a string delimiter - which breaks parsing of the whole script. See the 2026-08-24
  fix; do not reintroduce em-dashes or curly quotes here.

  SAFE BY DEFAULT. With no switches it only does read-only checks + login:
    - GET  /health
    - POST /api/auth/login            (your test PRO account)
    - GET  /api/contracts             (lists what's eligible for send / email-copy)

  Opt-in mutating steps (these have real side effects on PROD):
    -TestLogo                 upload a 1x1 test logo (OVERWRITES your business logo;
                              the script prints your current logo URL first so you can restore it)
    -SendContractId <guid>    POST /api/contracts/<id>/send        (EMAILS the client a signing link)
    -EmailCopyContractId <guid>  POST /api/contracts/<id>/email-copy  (EMAILS the client their signed copy)

  Usage:
    ./smoke-prod.ps1
    ./smoke-prod.ps1 -TestLogo
    ./smoke-prod.ps1 -SendContractId 1234abcd-....  -EmailCopyContractId 5678ef....

  You will be prompted for email + password. The password is read as a SecureString
  and only converted to plaintext in-memory for the single login call.
#>

[CmdletBinding()]
param(
  [string]$BaseUrl = "https://petpro-app.onrender.com",
  [switch]$TestLogo,
  [string]$SendContractId,
  [string]$EmailCopyContractId
)

$ErrorActionPreference = "Stop"
function Ok($m)   { Write-Host "  [OK]  $m"   -ForegroundColor Green }
function Info($m) { Write-Host "  ..   $m"    -ForegroundColor Cyan }
function Warn($m) { Write-Host "  [!]  $m"    -ForegroundColor Yellow }
function Fail($m) { Write-Host "  [X]  $m"    -ForegroundColor Red }

Write-Host "`n== Sit.Stay.Play prod smoke test ==  $BaseUrl`n" -ForegroundColor White

# 1) Health -----------------------------------------------------------------
try {
  $h = Invoke-RestMethod -Method Get -Uri "$BaseUrl/health" -TimeoutSec 20
  if ($h.ok) { Ok "health: $($h.data.service) / $($h.data.status)" } else { Fail "health returned ok=false"; exit 1 }
} catch { Fail "health check failed: $($_.Exception.Message)"; exit 1 }

# 2) Login ------------------------------------------------------------------
$email = Read-Host "Test PRO email"
$secure = Read-Host "Password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

try {
  $login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" `
            -ContentType "application/json" `
            -Body (@{ email = $email; password = $plain } | ConvertTo-Json) -TimeoutSec 30
  $plain = $null
  if (-not $login.ok) { Fail "login returned ok=false"; exit 1 }
  $token = $login.data.access_token
  if (-not $token) { Fail "no access_token in login response"; exit 1 }
  Ok "logged in as $($login.data.account.email)  (account_type=$($login.data.account.account_type))"
} catch { Fail "login failed: $($_.Exception.Message)"; exit 1 }

$auth = @{ Authorization = "Bearer $token" }

# 3) List contracts (read-only) --------------------------------------------
try {
  $contracts = (Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/contracts" -Headers $auth -TimeoutSec 30).data
  Ok "fetched $($contracts.Count) contract(s)"
  $sendable = $contracts | Where-Object { $_.status -in @('draft','sent') }
  $signed   = $contracts | Where-Object { $_.status -eq 'signed' }
  if ($sendable) { Info "eligible for -SendContractId (draft/sent):"; $sendable | ForEach-Object { Write-Host "        $($_.id)  [$($_.status)]" } }
  if ($signed)   { Info "eligible for -EmailCopyContractId (signed):";  $signed   | ForEach-Object { Write-Host "        $($_.id)  [$($_.status)]" } }
} catch { Warn "could not list contracts: $($_.Exception.Message)" }

# 4) Logo upload (opt-in, OVERWRITES) --------------------------------------
if ($TestLogo) {
  Info "current business_logo_url (save this to restore later):"
  Write-Host "        $($login.data.account.business_logo_url)"
  # 1x1 transparent PNG
  $png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  try {
    $r = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/profile/image" -Headers $auth `
          -ContentType "application/json" `
          -Body (@{ kind = "logo"; image = "data:image/png;base64,$png" } | ConvertTo-Json) -TimeoutSec 30
    if ($r.ok) { Ok "logo uploaded -> $($r.data.business_logo_url)" } else { Fail "logo upload ok=false" }
    Warn "your business logo is now the 1x1 test image - restore it in the Profile tab (or re-upload the real one)."
  } catch { Fail "logo upload failed: $($_.Exception.Message)" }
} else { Info "logo step skipped (pass -TestLogo to run it)" }

# 5) Send contract (opt-in, EMAILS CLIENT) ---------------------------------
if ($SendContractId) {
  Warn "About to email the client a signing link for contract $SendContractId"
  if ((Read-Host "Type YES to proceed") -eq "YES") {
    try {
      $r = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/contracts/$SendContractId/send" -Headers $auth -TimeoutSec 30
      if ($r.ok) { Ok "sent - contract status now '$($r.data.status)'" } else { Fail "send ok=false" }
    } catch { Fail "send failed: $($_.Exception.Message)" }
  } else { Info "send cancelled" }
}

# 6) Re-email signed copy (opt-in, EMAILS CLIENT) --------------------------
if ($EmailCopyContractId) {
  Warn "About to re-email the signed copy for contract $EmailCopyContractId"
  if ((Read-Host "Type YES to proceed") -eq "YES") {
    try {
      $r = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/contracts/$EmailCopyContractId/email-copy" -Headers $auth -TimeoutSec 30
      if ($r.ok) { Ok "signed copy re-emailed" } else { Fail "email-copy ok=false" }
    } catch { Fail "email-copy failed: $($_.Exception.Message)" }
  } else { Info "email-copy cancelled" }
}

Write-Host "`n== done ==`n" -ForegroundColor White
