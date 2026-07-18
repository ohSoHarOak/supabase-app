# PetPro Connect - Week 3 manual test: contracts (templates, generation, in-person signing, immutability)
#
# Usage (local):    .\scripts\week3-test.ps1
# Usage (Render):   .\scripts\week3-test.ps1 -BaseUrl "https://YOUR-SERVICE.onrender.com"
#
# Creates a fresh professional account + client with pets, seeds the packaged
# Pet Services Agreement template, generates a contract from live CRM data,
# signs it in person, then PROVES the signed contract cannot be edited.

param(
  [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$proEmail = "week3test+$stamp@example.com"
$password = "Test-Password-123!"

# 1x1 transparent PNG - stands in for a drawn signature.
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

function Get-Api($path, $token) {
  Invoke-RestMethod -Uri "$BaseUrl$path" -Method Get -Headers @{ Authorization = "Bearer $token" }
}

function Patch-Api($path, $body, $token) {
  Invoke-RestMethod -Uri "$BaseUrl$path" -Method Patch -Body ($body | ConvertTo-Json -Depth 5) -ContentType "application/json" -Headers @{ Authorization = "Bearer $token" }
}

Write-Host "Testing against $BaseUrl" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: fresh professional + client with two pets -----------------------
try {
  $signup = Post "/api/auth/signup" @{ email = $proEmail; password = $password; fullName = "Week Three Tester"; businessName = "Happy Paws Walking Co." }
  $token = $signup.data.access_token
  if (-not $token) { Fail "Setup" "No access token from signup" }

  $client = Post "/api/clients" @{
    full_name = "Dana Whitfield"
    email = "dana@example.com"
    phone = "+1 (555) 010-9876"
    address = "42 Fetch Lane, San Diego, CA"
    emergency_contact_name = "Sam Whitfield"
    emergency_contact_phone = "+1 (555) 010-5555"
    cancellation_window_hours = 48
    no_show_fee_cents = 2500
    status = "active"
  } $token
  $clientId = $client.data.id

  Post "/api/clients/$clientId/pets" @{ name = "Peanut"; breed = "Beagle"; emergency_vet = "San Diego Pet ER, (555) 222-3333" } $token | Out-Null
  Post "/api/clients/$clientId/pets" @{ name = "Olive"; breed = "Border Collie" } $token | Out-Null
  Write-Host "[PASS] 1. Setup - professional + client with 2 pets created" -ForegroundColor Green
} catch { Fail "Setup" $_ }

# --- Step 2: seed the packaged Pet Services Agreement template ---------------
try {
  $template = Post "/api/contract-templates/seed" @{} $token
  if (-not $template.ok) { Fail "Seed template" ($template | ConvertTo-Json -Depth 5) }
  $templateId = $template.data.id
  if ($template.data.body_html -notmatch "\{\{client_name\}\}") { Fail "Seed template" "Template body missing {{client_name}} placeholder" }

  # Idempotent: seeding again returns the same template, not a duplicate.
  $again = Post "/api/contract-templates/seed" @{} $token
  if ($again.data.id -ne $templateId) { Fail "Seed template" "Re-seeding created a duplicate template" }
  Write-Host "[PASS] 2. Pet Services Agreement template seeded (idempotent)" -ForegroundColor Green
} catch { Fail "Seed template" $_ }

# --- Step 3: generate a contract from live CRM data --------------------------
try {
  $gen = Post "/api/contracts" @{
    template_id = $templateId
    client_id = $clientId
    variables = @{
      walk_type = "Private Walk"
      service_schedule = "Mon/Wed/Fri, 30-minute midday walk"
      service_price = "`$30.00 per 30-minute walk"
      start_date = "August 3, 2026"
      key_handling = "One house key held by Service Provider"
      emergency_vet_cap = "`$500.00"
      photo_consent = "Yes"
    }
  } $token
  $contractId = $gen.data.contract.id
  $html = $gen.data.contract.generated_html

  if ($gen.data.contract.status -ne "draft") { Fail "Generate" "Expected status draft, got $($gen.data.contract.status)" }
  if ($gen.data.unresolved_placeholders.Count -ne 0) { Fail "Generate" "Unresolved placeholders: $($gen.data.unresolved_placeholders -join ', ')" }
  if ($html -notmatch "Dana Whitfield") { Fail "Generate" "Client name not substituted" }
  if ($html -notmatch "Peanut \(Beagle\), Olive \(Border Collie\)") { Fail "Generate" "Pet list not substituted" }
  if ($html -notmatch "48 hours") { Fail "Generate" "Client's 48-hour cancellation window not used" }
  # Pet Services Agreement (seeded default since 2026-07-17): late cancels owe
  # the full service fee; the CA template's no_show_fee field isn't used here.
  if ($html -notmatch "full fee of the scheduled service") { Fail "Generate" "Cancellation clause missing" }
  if ($html -notmatch "San Diego Pet ER") { Fail "Generate" "Preferred vet not pulled from pet record" }
  if ($html -notmatch "\{\{client_signature_image\}\}") { Fail "Generate" "Signature placeholder must survive generation" }
  Write-Host "[PASS] 3. Contract generated from real client/pet data, no unresolved placeholders" -ForegroundColor Green
} catch { Fail "Generate" $_ }

# --- Step 4: draft contracts are editable -------------------------------------
try {
  $edited = Patch-Api "/api/contracts/$contractId" @{ status = "sent" } $token
  if ($edited.data.status -ne "sent") { Fail "Draft edit" "Could not move draft to sent" }
  Write-Host "[PASS] 4. Draft contract editable (draft -> sent)" -ForegroundColor Green
} catch { Fail "Draft edit" $_ }

# --- Step 5: sign in person ----------------------------------------------------
try {
  $signed = Post "/api/contracts/$contractId/sign" @{
    signer_name = "Dana Whitfield"
    signature_image = $signaturePng
  } $token
  if ($signed.data.status -ne "signed") { Fail "Sign" "Expected status signed, got $($signed.data.status)" }
  if (-not $signed.data.signed_at) { Fail "Sign" "signed_at not set" }
  if ($signed.data.signing_method -ne "in_person") { Fail "Sign" "signing_method not in_person" }
  if ($signed.data.generated_html -notmatch "data:image/png;base64") { Fail "Sign" "Signature image not embedded in final HTML" }
  if ($signed.data.generated_html -match "\{\{client_signature_image\}\}") { Fail "Sign" "Signature placeholder not filled" }
  Write-Host "[PASS] 5. In-person signing captured signature and locked contract" -ForegroundColor Green
} catch { Fail "Sign" $_ }

# --- Step 6: signed contract is immutable (DB trigger) ---------------------------
try {
  $blocked = $false
  try {
    Patch-Api "/api/contracts/$contractId" @{ generated_html = "<p>tampered</p>" } $token | Out-Null
  } catch {
    $blocked = $true
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -ne 409) { Fail "Immutability" "Expected 409, got $status" }
  }
  if (-not $blocked) { Fail "Immutability" "API allowed editing a signed contract!" }

  $blocked = $false
  try {
    Patch-Api "/api/contracts/$contractId" @{ status = "draft" } $token | Out-Null
  } catch { $blocked = $true }
  if (-not $blocked) { Fail "Immutability" "API allowed un-signing a signed contract!" }
  Write-Host "[PASS] 6. Signed contract cannot be edited or un-signed (409 from DB trigger)" -ForegroundColor Green
} catch { Fail "Immutability" $_ }

# --- Step 7: editing the client afterward does not touch the signed snapshot ----
try {
  Patch-Api "/api/clients/$clientId" @{ full_name = "Dana Whitfield-Jones"; cancellation_window_hours = 12 } $token | Out-Null
  $after = Get-Api "/api/contracts/$contractId" $token
  if ($after.data.generated_html -notmatch "Dana Whitfield") { Fail "Snapshot" "Signed contract lost original client name" }
  if ($after.data.generated_html -match "Whitfield-Jones") { Fail "Snapshot" "Signed contract changed when client was edited!" }
  if ($after.data.generated_html -notmatch "48 hours") { Fail "Snapshot" "Signed contract lost original cancellation window" }
  Write-Host "[PASS] 7. Client edits after signing leave the signed contract untouched" -ForegroundColor Green
} catch { Fail "Snapshot" $_ }

# --- Step 8: contract renders as a web page ------------------------------------
try {
  $page = Invoke-WebRequest -Uri "$BaseUrl/api/contracts/$contractId/html" -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing
  if ($page.Headers["Content-Type"] -notmatch "text/html") { Fail "Render" "Expected text/html, got $($page.Headers['Content-Type'])" }
  if ($page.Content -notmatch "Pet Services Agreement") { Fail "Render" "Rendered page missing contract title" }
  Write-Host "[PASS] 8. Contract renders as HTML page (for viewing/printing)" -ForegroundColor Green
} catch { Fail "Render" $_ }

Write-Host ""
Write-Host "WEEK 3 TEST PASSED" -ForegroundColor Green
Write-Host "Templates, generation from CRM data, in-person signing, and immutability all verified."
