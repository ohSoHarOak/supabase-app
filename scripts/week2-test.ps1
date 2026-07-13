# PetPro Connect - Week 2 manual test: CRM (clients, pets, search, validation)
#
# Usage (local):    .\scripts\week2-test.ps1
# Usage (Render):   .\scripts\week2-test.ps1 -BaseUrl "https://YOUR-SERVICE.onrender.com"
#
# Creates a fresh professional account, adds 3 clients with 2 pets each,
# then exercises search, validation, update, and delete.

param(
  [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$proEmail = "week2test+$stamp@example.com"
$password = "Test-Password-123!"

function Fail($step, $detail) {
  Write-Host "[FAIL] $step" -ForegroundColor Red
  Write-Host $detail
  exit 1
}

function Post($path, $body, $token) {
  $headers = @{}
  if ($token) { $headers.Authorization = "Bearer $token" }
  Invoke-RestMethod -Uri "$BaseUrl$path" -Method Post -Body ($body | ConvertTo-Json) -ContentType "application/json" -Headers $headers
}

function Get-Api($path, $token) {
  Invoke-RestMethod -Uri "$BaseUrl$path" -Method Get -Headers @{ Authorization = "Bearer $token" }
}

Write-Host "Testing against $BaseUrl" -ForegroundColor Cyan
Write-Host ""

# --- Setup: fresh professional account --------------------------------------
try {
  $signup = Post "/api/auth/signup" @{ email = $proEmail; password = $password; fullName = "Week Two Tester" }
  $token = $signup.data.access_token
  if (-not $token) { Fail "Setup" "No access token from signup" }
  Write-Host "[PASS] 1. Setup - professional account created" -ForegroundColor Green
} catch { Fail "Setup" $_ }

# --- Step 2: Add 3 clients with 2 pets each ---------------------------------
$clientDefs = @(
  @{ name = "Alice Johnson";  email = "alice@example.com";  pets = @("Biscuit", "Waffles") },
  @{ name = "Bob Martinez";   email = "bob@example.com";    pets = @("Rex", "Luna") },
  @{ name = "Carol Nguyen";   email = "carol@example.com";  pets = @("Ziggy", "Mochi") }
)
try {
  $clientIds = @{}
  foreach ($def in $clientDefs) {
    $client = Post "/api/clients" @{
      full_name = $def.name
      email = $def.email
      phone = "+1 (555) 010-1234"
      address = "123 Bark Street"
      status = "active"
    } $token
    if (-not $client.ok) { Fail "Add clients" ($client | ConvertTo-Json -Depth 5) }
    $clientIds[$def.name] = $client.data.id
    foreach ($petName in $def.pets) {
      $pet = Post "/api/clients/$($client.data.id)/pets" @{
        name = $petName
        breed = "Golden Retriever"
        weight_lb = 54.0
        behavior_notes = "Friendly, pulls on leash"
      } $token
      if (-not $pet.ok) { Fail "Add pets" ($pet | ConvertTo-Json -Depth 5) }
    }
  }
  Write-Host "[PASS] 2. Created 3 clients with 2 pets each" -ForegroundColor Green
} catch { Fail "Add clients/pets" $_ }

# --- Step 3: Search by pet name ----------------------------------------------
try {
  $result = Get-Api "/api/clients?q=Ziggy" $token
  if ($result.data.Count -ne 1) { Fail "Search by pet name" "Expected 1 client for 'Ziggy', got $($result.data.Count)" }
  if ($result.data[0].full_name -ne "Carol Nguyen") { Fail "Search by pet name" "Expected Carol Nguyen, got $($result.data[0].full_name)" }
  Write-Host "[PASS] 3. Search by pet name 'Ziggy' found Carol Nguyen" -ForegroundColor Green
} catch { Fail "Search by pet name" $_ }

# --- Step 4: Search by owner email -------------------------------------------
try {
  $result = Get-Api "/api/clients?q=bob@example.com" $token
  if ($result.data.Count -ne 1) { Fail "Search by email" "Expected 1 client for bob@example.com, got $($result.data.Count)" }
  if ($result.data[0].full_name -ne "Bob Martinez") { Fail "Search by email" "Expected Bob Martinez, got $($result.data[0].full_name)" }
  if ($result.data[0].pets.Count -ne 2) { Fail "Search by email" "Expected Bob to have 2 pets" }
  Write-Host "[PASS] 4. Search by owner email found Bob Martinez with 2 pets" -ForegroundColor Green
} catch { Fail "Search by email" $_ }

# --- Step 5: Validation rejects bad input ------------------------------------
try {
  $rejected = $false
  try {
    Post "/api/clients" @{ full_name = ""; email = "not-an-email" } $token | Out-Null
  } catch { $rejected = $true }
  if (-not $rejected) { Fail "Validation" "API accepted a client with empty name and bad email" }
  Write-Host "[PASS] 5. Validation rejected empty name + bad email (422)" -ForegroundColor Green
} catch { Fail "Validation" $_ }

# --- Step 6: Vaccination record ------------------------------------------------
try {
  $alice = Get-Api "/api/clients/$($clientIds['Alice Johnson'])" $token
  $biscuit = $alice.data.pets | Where-Object { $_.name -eq "Biscuit" }
  $vax = Post "/api/pets/$($biscuit.id)/vaccinations" @{
    vaccine_name = "Rabies"
    administered_on = "2026-01-15"
    expires_on = "2027-01-15"
  } $token
  if (-not $vax.ok) { Fail "Vaccination" ($vax | ConvertTo-Json -Depth 5) }
  $vaxList = Get-Api "/api/pets/$($biscuit.id)/vaccinations" $token
  if ($vaxList.data.Count -ne 1) { Fail "Vaccination" "Expected 1 vaccination record" }
  Write-Host "[PASS] 6. Vaccination record added to Biscuit and readable" -ForegroundColor Green
} catch { Fail "Vaccination" $_ }

# --- Step 7: Update + delete ---------------------------------------------------
try {
  $update = Invoke-RestMethod -Uri "$BaseUrl/api/clients/$($clientIds['Alice Johnson'])" -Method Patch `
    -Body (@{ general_notes = "Prefers morning walks" } | ConvertTo-Json) -ContentType "application/json" `
    -Headers @{ Authorization = "Bearer $token" }
  if ($update.data.general_notes -ne "Prefers morning walks") { Fail "Update" "Note did not save" }

  $delete = Invoke-RestMethod -Uri "$BaseUrl/api/clients/$($clientIds['Carol Nguyen'])" -Method Delete `
    -Headers @{ Authorization = "Bearer $token" }
  if (-not $delete.data.deleted) { Fail "Delete" "Delete did not confirm" }

  $after = Get-Api "/api/clients" $token
  if ($after.data.Count -ne 2) { Fail "Delete" "Expected 2 clients after delete, got $($after.data.Count)" }
  Write-Host "[PASS] 7. Client update + delete work; list reflects changes" -ForegroundColor Green
} catch { Fail "Update/delete" $_ }

Write-Host ""
Write-Host "WEEK 2 TEST PASSED" -ForegroundColor Green
Write-Host "Clients, pets, vaccinations, search, validation, update, delete all work."
