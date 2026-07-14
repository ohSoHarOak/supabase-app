# PetPro Connect - Week 5 manual test: Stripe payments end to end
#
# Usage (local):    .\scripts\week5-test.ps1
# Usage (Render):   .\scripts\week5-test.ps1 -BaseUrl "https://petpro-app.onrender.com"
#
# Needs STRIPE_SECRET_KEY set in the server's environment (test mode).
# The script drives the API loop, then opens Stripe Checkout in your browser
# for the one step only a human can do: paying with the test card.
#
#   Test card: 4242 4242 4242 4242 - any future expiry, any CVC, any ZIP.
#
# What it proves: billable item -> invoice -> Stripe Checkout -> payment
# recorded exactly once (idempotent) -> invoice paid -> payment_received
# in the event log.

param(
  [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMddHHmmss"

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
  Invoke-RestMethod -Uri "$BaseUrl$path" -Headers @{ Authorization = "Bearer $token" }
}

Write-Host "Testing against $BaseUrl" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: health + account + client -----------------------------------------
try {
  Invoke-RestMethod -Uri "$BaseUrl/health" | Out-Null
  $signup = Post "/api/auth/signup" @{ email = "week5test+$stamp@example.com"; password = "Test-Password-123!"; fullName = "Week Five Tester"; businessName = "Payments Test Walking Co." }
  $token = $signup.data.access_token
  $client = Post "/api/clients" @{ full_name = "Billing Client"; cancellation_window_hours = 24; status = "active" } $token
  Write-Host "[PASS] 1. Health + signup + client" -ForegroundColor Green
} catch { Fail "Setup" $_ }

# --- Step 2: billable item (creates a real Stripe product + price) -------------
try {
  $item = Post "/api/billable-items" @{ name = "Private walk (30 min)"; unit_amount_cents = 3000; billing_period = "one_time" } $token
  if (-not $item.data.stripe_price_id) { Fail "Billable item" "No stripe_price_id came back - is STRIPE_SECRET_KEY set?" }
  Write-Host "[PASS] 2. Billable item created (Stripe product $($item.data.stripe_product_id))" -ForegroundColor Green
} catch {
  Fail "Billable item" "$_`nIf this is a 503, STRIPE_SECRET_KEY is not set in the server's environment."
}

# --- Step 3: invoices - from item (x3 visits) and custom ------------------------
try {
  $invoice = Post "/api/invoices" @{ client_id = $client.data.id; billable_item_id = $item.data.id; quantity = 3 } $token
  if ($invoice.data.amount_cents -ne 9000) { Fail "Invoice" "Expected 9000 cents (3 x `$30), got $($invoice.data.amount_cents)" }
  if ($invoice.data.status -ne "open") { Fail "Invoice" "Expected status open, got $($invoice.data.status)" }
  $custom = Post "/api/invoices" @{ client_id = $client.data.id; amount_cents = 1500; description = "Holiday key pickup" } $token
  Write-Host "[PASS] 3. Invoices: 3 x `$30.00 item = `$90.00, plus a custom `$15.00" -ForegroundColor Green
} catch { Fail "Invoice" $_ }

# --- Step 4: void the custom invoice, confirm it can't be paid ------------------
try {
  $voided = Post "/api/invoices/$($custom.data.id)/void" @{} $token
  if ($voided.data.status -ne "void") { Fail "Void" "Expected void, got $($voided.data.status)" }
  $blocked = $false
  try { Post "/api/invoices/$($custom.data.id)/checkout" @{} $token | Out-Null } catch { $blocked = $true }
  if (-not $blocked) { Fail "Void" "A voided invoice accepted a checkout!" }
  Write-Host "[PASS] 4. Voided invoice refuses payment (409)" -ForegroundColor Green
} catch { Fail "Void" $_ }

# --- Step 5: Stripe Checkout - the human step -----------------------------------
try {
  $checkout = Post "/api/invoices/$($invoice.data.id)/checkout" @{} $token
  $url = $checkout.data.checkout_url
  Write-Host ""
  Write-Host "ACTION NEEDED - opening Stripe Checkout in your browser:" -ForegroundColor Yellow
  Write-Host "  $url"
  Write-Host "  Pay with test card 4242 4242 4242 4242 (any future expiry, any CVC, any ZIP)." -ForegroundColor Yellow
  Write-Host ""
  Start-Process $url
} catch { Fail "Checkout" $_ }

# --- Step 6: wait for the payment to land (webhook or sync, whichever first) ----
try {
  $paid = $null
  Write-Host "Waiting for payment (up to 5 minutes)..." -ForegroundColor Cyan
  foreach ($i in 1..100) {
    Start-Sleep -Seconds 3
    $state = Post "/api/invoices/$($invoice.data.id)/sync" @{} $token
    if ($state.data.status -eq "paid") { $paid = $state.data; break }
  }
  if (-not $paid) { Fail "Payment" "Invoice never reached status=paid. Did the test payment go through?" }
  Write-Host "[PASS] 6. Invoice paid at $($paid.paid_at)" -ForegroundColor Green
} catch { Fail "Payment" $_ }

# --- Step 7: idempotency - syncing again never records a second payment ---------
try {
  Post "/api/invoices/$($invoice.data.id)/sync" @{} $token | Out-Null
  Post "/api/invoices/$($invoice.data.id)/sync" @{} $token | Out-Null
  $txns = Get-Api "/api/invoices/$($invoice.data.id)/transactions" $token
  $succeeded = @($txns.data | Where-Object { $_.status -eq "succeeded" })
  if ($succeeded.Count -ne 1) { Fail "Idempotency" "Expected exactly 1 succeeded transaction, found $($succeeded.Count)" }
  Write-Host "[PASS] 7. Exactly one payment recorded (webhook + sync + replays = still one)" -ForegroundColor Green
} catch { Fail "Idempotency" $_ }

# --- Step 8: payment_received is in the event log -------------------------------
try {
  $events = Get-Api "/api/events" $token
  $received = @($events.data | Where-Object { $_.event_type -eq "payment_received" -and $_.subject_id -eq $invoice.data.id })
  if ($received.Count -ne 1) { Fail "Event log" "Expected exactly 1 payment_received event, found $($received.Count)" }
  Write-Host "[PASS] 8. payment_received event in the log (amount $($received[0].metadata.amount_cents) cents)" -ForegroundColor Green
} catch { Fail "Event log" $_ }

Write-Host ""
Write-Host "WEEK 5 TEST PASSED" -ForegroundColor Green
Write-Host "Also try it through the UI: open $BaseUrl, pick a client, create an invoice"
Write-Host "in the Billing section and use 'Collect payment'."
