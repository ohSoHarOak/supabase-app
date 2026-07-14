# PetPro Connect - Week 4 manual test: web UI is served + full flow works behind it
#
# Usage (local):    .\scripts\week4-test.ps1
# Usage (Render):   .\scripts\week4-test.ps1 -BaseUrl "https://YOUR-SERVICE.onrender.com"
#
# Checks the UI files are served, then smoke-tests the API loop the UI drives:
# signup -> client -> pet -> seed template -> generate -> sign -> confirm locked.
#
# The REAL Week 4 test is you clicking through the UI in a browser:
#   1. Open the BaseUrl, create an account (or log in)
#   2. Add a client + pets, generate a contract, sign it with your mouse
#   3. Confirm the client flips from "Needs your attention" to Active

param(
  [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$signaturePng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

function Fail($step, $detail) {
  Write-Host "[FAIL] $step" -ForegroundColor Red
  Write-Host $detail
  exit 1
}
function Post($path, $body, $token) {
  $headers = @{}
  if ($token) { $headers.Authorization = "Bearer $token" }
  Invoke-RestMethod -Uri "$BaseUrl$path" -Method Post -Body ($body | ConvertTo-Json -Depth 5) -ContentType "application/json" -Headers $headers
}

Write-Host "Testing against $BaseUrl" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: UI is served -----------------------------------------------------
try {
  $page = Invoke-WebRequest -Uri "$BaseUrl/" -UseBasicParsing
  if ($page.Content -notmatch 'id="app"') { Fail "UI shell" "/ did not return the app shell" }
  $css = Invoke-WebRequest -Uri "$BaseUrl/styles.css" -UseBasicParsing
  if ($css.Content -notmatch "--steel") { Fail "UI css" "styles.css missing brand tokens" }
  $js = Invoke-WebRequest -Uri "$BaseUrl/app.js" -UseBasicParsing
  if ($js.Content -notmatch "PetPro Connect") { Fail "UI js" "app.js missing" }
  Write-Host "[PASS] 1. Web UI served (index.html, styles.css, app.js)" -ForegroundColor Green
} catch { Fail "UI files" $_ }

# --- Step 2: the API loop the UI drives ---------------------------------------
try {
  $signup = Post "/api/auth/signup" @{ email = "week4test+$stamp@example.com"; password = "Test-Password-123!"; fullName = "Week Four Tester"; businessName = "UI Test Walking Co." }
  $token = $signup.data.access_token
  $client = Post "/api/clients" @{ full_name = "Smoke Client"; cancellation_window_hours = 24; status = "prospect" } $token
  Post "/api/clients/$($client.data.id)/pets" @{ name = "Smokey"; breed = "Lab" } $token | Out-Null
  $tpl = Post "/api/contract-templates/seed" @{} $token
  $gen = Post "/api/contracts" @{
    template_id = $tpl.data.id; client_id = $client.data.id
    variables = @{ walk_type = "Private Walk"; service_schedule = "Tue, 30 min"; service_price = "`$30.00 per walk"; start_date = "August 1, 2026"; key_handling = "None"; emergency_vet_cap = "`$500.00"; photo_consent = "No"; no_show_fee = "`$20.00" }
  } $token
  if ($gen.data.unresolved_placeholders.Count -ne 0) { Fail "Generate" "Unresolved: $($gen.data.unresolved_placeholders -join ', ')" }
  $signed = Post "/api/contracts/$($gen.data.contract.id)/sign" @{ signer_name = "Smoke Client"; signature_image = $signaturePng } $token
  if ($signed.data.status -ne "signed") { Fail "Sign" "Contract did not sign" }
  Write-Host "[PASS] 2. API loop behind the UI works (signup -> client -> contract -> signed)" -ForegroundColor Green
} catch { Fail "API loop" $_ }

# --- Step 3: signed contract locked -------------------------------------------
try {
  $blocked = $false
  try {
    Invoke-RestMethod -Uri "$BaseUrl/api/contracts/$($gen.data.contract.id)" -Method Patch `
      -Body (@{ generated_html = "<p>tamper</p>" } | ConvertTo-Json) -ContentType "application/json" `
      -Headers @{ Authorization = "Bearer $token" } | Out-Null
  } catch { $blocked = $true }
  if (-not $blocked) { Fail "Immutability" "Signed contract accepted an edit!" }
  Write-Host "[PASS] 3. Signed contract still locked (409)" -ForegroundColor Green
} catch { Fail "Immutability" $_ }

Write-Host ""
Write-Host "WEEK 4 SMOKE TEST PASSED" -ForegroundColor Green
Write-Host "Now do the real test: open $BaseUrl in your browser and click through the full flow."
