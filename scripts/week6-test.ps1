# PetPro Connect - Week 6 manual test: scheduling end to end
#
# Usage (local):    .\scripts\week6-test.ps1
# Usage (Render):   .\scripts\week6-test.ps1 -BaseUrl "https://petpro-app.onrender.com"
#
# What it proves: service created -> recurring weekly walk booked (4 weeks)
# -> double-booking blocked with 409 -> one instance marked complete with
# walk-report data -> invoice generated automatically -> walk_completed in
# the event log -> series cancel ends the remaining walks.
#
# No Stripe interaction needed: the auto-invoice is a plain PetPro invoice
# (you'd collect it via Checkout like any Week 5 invoice).

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

# --- Step 1: health + account + client ------------------------------------------
try {
  Invoke-RestMethod -Uri "$BaseUrl/health" | Out-Null
  $signup = Post "/api/auth/signup" @{ email = "week6test+$stamp@example.com"; password = "Test-Password-123!"; fullName = "Week Six Tester"; businessName = "Scheduling Test Walking Co." }
  $token = $signup.data.access_token
  $client = Post "/api/clients" @{ full_name = "Schedule Client"; cancellation_window_hours = 24; status = "active" } $token
  Write-Host "[PASS] 1. Health + signup + client" -ForegroundColor Green
} catch { Fail "Setup" $_ }

# --- Step 2: create a per-visit service ------------------------------------------
try {
  $service = Post "/api/services" @{
    client_id = $client.data.id; name = "Private walk (30 min)"; service_type = "private_walk"
    price_cents = 3000; billing_cadence = "per_visit"; duration_minutes = 30
  } $token
  if ($service.data.status -ne "active") { Fail "Service" "Expected status active, got $($service.data.status)" }
  Write-Host "[PASS] 2. Service created: Private walk, `$30.00 per visit" -ForegroundColor Green
} catch { Fail "Service" $_ }

# --- Step 3: book a recurring weekly walk (4 weeks) -------------------------------
try {
  # Tomorrow 10:00 local, so the series never lands in the past.
  $start = (Get-Date).Date.AddDays(1).AddHours(10)
  $startIso = $start.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $series = Post "/api/appointments" @{ service_id = $service.data.id; starts_at = $startIso; repeat_weeks = 4 } $token
  if ($series.data.Count -ne 4) { Fail "Recurrence" "Expected 4 occurrences, got $($series.data.Count)" }
  $parent = $series.data[0]
  if ($parent.recurrence_rule -ne "FREQ=WEEKLY;COUNT=4") { Fail "Recurrence" "Parent recurrence_rule is $($parent.recurrence_rule)" }
  $children = @($series.data | Where-Object { $_.recurrence_parent_id -eq $parent.id })
  if ($children.Count -ne 3) { Fail "Recurrence" "Expected 3 child occurrences pointing at the parent, got $($children.Count)" }
  Write-Host "[PASS] 3. Weekly series booked: 4 occurrences, RRULE on parent" -ForegroundColor Green
} catch { Fail "Recurrence" $_ }

# --- Step 4: conflict detection - overlapping slot is rejected with 409 -----------
try {
  # 15 minutes into occurrence #2 -> must be rejected.
  $clashIso = $start.AddDays(7).AddMinutes(15).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $blocked = $false
  try {
    Post "/api/appointments" @{ service_id = $service.data.id; starts_at = $clashIso } $token | Out-Null
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 409) { $blocked = $true } else { Fail "Conflict" "Expected 409, got $status" }
  }
  if (-not $blocked) { Fail "Conflict" "An overlapping appointment was accepted - double-booking is possible!" }
  # A non-overlapping slot right after still books fine (and is cleaned up).
  $okIso = $start.AddDays(7).AddHours(2).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $ok = Post "/api/appointments" @{ service_id = $service.data.id; starts_at = $okIso } $token
  Post "/api/appointments/$($ok.data[0].id)/cancel" @{ scope = "one" } $token | Out-Null
  Write-Host "[PASS] 4. Double-booking blocked (409); adjacent slot still bookable" -ForegroundColor Green
} catch { Fail "Conflict" $_ }

# --- Step 5: mark the first walk complete with walk-report data -------------------
try {
  $completion = Post "/api/appointments/$($parent.id)/complete" @{
    completion_notes = "Great loop around the park"
    good_dog = $true
    got_a_treat = $true
  } $token
  $appt = $completion.data.appointment
  if ($appt.status -ne "completed") { Fail "Complete" "Expected status completed, got $($appt.status)" }
  if ($appt.good_dog -ne $true -or $appt.got_a_treat -ne $true) { Fail "Complete" "Walk-report flags not stored on the appointment" }
  if (-not $appt.actual_start_at) { Fail "Complete" "actual_start_at was not stored" }
  Write-Host "[PASS] 5. Walk completed with report data (good dog, got a treat)" -ForegroundColor Green
} catch { Fail "Complete" $_ }

# --- Step 6: auto-invoice for the per-visit service --------------------------------
try {
  $invoice = $completion.data.invoice
  if (-not $invoice) { Fail "Auto-invoice" "Completing a per_visit walk returned no invoice" }
  if ($invoice.amount_cents -ne 3000) { Fail "Auto-invoice" "Expected 3000 cents, got $($invoice.amount_cents)" }
  if ($invoice.status -ne "open") { Fail "Auto-invoice" "Expected status open, got $($invoice.status)" }
  if ($invoice.service_id -ne $service.data.id) { Fail "Auto-invoice" "Invoice is not linked to the service" }
  $invoices = Get-Api "/api/invoices?client_id=$($client.data.id)" $token
  if (@($invoices.data).Count -ne 1) { Fail "Auto-invoice" "Expected exactly 1 invoice for the client, found $(@($invoices.data).Count)" }
  Write-Host "[PASS] 6. Invoice auto-generated: `$30.00, open, linked to the service" -ForegroundColor Green
} catch { Fail "Auto-invoice" $_ }

# --- Step 7: double-complete is refused; events are in the log --------------------
try {
  $again = $false
  try { Post "/api/appointments/$($parent.id)/complete" @{} $token | Out-Null } catch { $again = $true }
  if (-not $again) { Fail "Idempotency" "Completing the same walk twice was accepted (would double-bill!)" }
  $events = Get-Api "/api/events" $token
  $walkDone = @($events.data | Where-Object { $_.event_type -eq "walk_completed" -and $_.subject_id -eq $parent.id })
  if ($walkDone.Count -ne 1) { Fail "Event log" "Expected exactly 1 walk_completed event, found $($walkDone.Count)" }
  if ($walkDone[0].metadata.good_dog -ne $true) { Fail "Event log" "walk_completed payload is missing the walk-report data" }
  if (-not $walkDone[0].metadata.next_appointment_starts_at) { Fail "Event log" "walk_completed payload is missing next_appointment_starts_at" }
  $scheduled = @($events.data | Where-Object { $_.event_type -eq "appointment_scheduled" })
  if ($scheduled.Count -lt 1) { Fail "Event log" "No appointment_scheduled event found" }
  Write-Host "[PASS] 7. Double-complete refused (409); walk_completed event carries the report + next walk" -ForegroundColor Green
} catch { Fail "Idempotency/events" $_ }

# --- Step 8: cancel the rest of the series -----------------------------------------
try {
  $next = ($series.data | Where-Object { $_.id -ne $parent.id } | Sort-Object starts_at)[0]
  $ended = Post "/api/appointments/$($next.id)/cancel" @{ scope = "following" } $token
  if (@($ended.data).Count -ne 3) { Fail "Series cancel" "Expected 3 cancelled walks, got $(@($ended.data).Count)" }
  $remaining = Get-Api "/api/appointments?status=scheduled" $token
  if (@($remaining.data).Count -ne 0) { Fail "Series cancel" "Expected no scheduled walks left, found $(@($remaining.data).Count)" }
  Write-Host "[PASS] 8. 'Cancel following' ended the remaining 3 walks" -ForegroundColor Green
} catch { Fail "Series cancel" $_ }

Write-Host ""
Write-Host "WEEK 6 TEST PASSED" -ForegroundColor Green
Write-Host "Also try it through the UI: open $BaseUrl -> Schedule tab -> + New appointment."
Write-Host "Book a weekly walk, then 'Mark complete' - the invoice appears in the client's Billing section."
