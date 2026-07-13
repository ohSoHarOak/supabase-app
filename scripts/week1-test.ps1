# PetPro Connect - Week 1 manual test: signup -> login -> get session
#
# Usage (local):    .\scripts\week1-test.ps1
# Usage (Render):   .\scripts\week1-test.ps1 -BaseUrl "https://petpro-connect.onrender.com"
#
# What success looks like: all four steps print [PASS] and the script ends
# with "WEEK 1 TEST PASSED".

param(
  [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"
# Unique email each run so the test never collides with a previous run.
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$email = "week1test+$stamp@example.com"
$password = "Test-Password-123!"

function Fail($step, $detail) {
  Write-Host "[FAIL] $step" -ForegroundColor Red
  Write-Host $detail
  exit 1
}

Write-Host "Testing against $BaseUrl" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Health check --------------------------------------------------
try {
  $health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get
  if (-not $health.ok) { Fail "Health check" ($health | ConvertTo-Json) }
  Write-Host "[PASS] 1. Health check - API is reachable" -ForegroundColor Green
} catch {
  Fail "Health check" "Could not reach the API at $BaseUrl. Is the server running? ($_)"
}

# --- Step 2: Sign up a professional ----------------------------------------
try {
  $signupBody = @{
    email = $email
    password = $password
    fullName = "Week One Tester"
    businessName = "Test Walks LLC"
  } | ConvertTo-Json
  $signup = Invoke-RestMethod -Uri "$BaseUrl/api/auth/signup" -Method Post -Body $signupBody -ContentType "application/json"
  if (-not $signup.ok) { Fail "Signup" ($signup | ConvertTo-Json -Depth 5) }
  if ($signup.data.account.account_type -ne "professional") { Fail "Signup" "account_type was not 'professional'" }
  Write-Host "[PASS] 2. Signup - professional account created ($email)" -ForegroundColor Green
} catch {
  Fail "Signup" $_
}

# --- Step 3: Log in ----------------------------------------------------------
try {
  $loginBody = @{ email = $email; password = $password } | ConvertTo-Json
  $login = Invoke-RestMethod -Uri "$BaseUrl/api/auth/login" -Method Post -Body $loginBody -ContentType "application/json"
  if (-not $login.ok) { Fail "Login" ($login | ConvertTo-Json -Depth 5) }
  if (-not $login.data.access_token) { Fail "Login" "No access token returned" }
  $token = $login.data.access_token
  Write-Host "[PASS] 3. Login - received session token" -ForegroundColor Green
} catch {
  Fail "Login" $_
}

# --- Step 4: Get session (authenticated request) -----------------------------
try {
  $me = Invoke-RestMethod -Uri "$BaseUrl/api/auth/me" -Method Get -Headers @{ Authorization = "Bearer $token" }
  if (-not $me.ok) { Fail "Get session" ($me | ConvertTo-Json -Depth 5) }
  if ($me.data.account.email -ne $email) { Fail "Get session" "Returned account email doesn't match" }
  if ($me.data.profile.full_name -ne "Week One Tester") { Fail "Get session" "Profile full_name doesn't match" }
  Write-Host "[PASS] 4. Session - /me returned the right account + profile" -ForegroundColor Green
} catch {
  Fail "Get session" $_
}

Write-Host ""
Write-Host "WEEK 1 TEST PASSED" -ForegroundColor Green
Write-Host "Signup -> login -> authenticated session all work end to end."
