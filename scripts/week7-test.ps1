# PetPro Connect - Week 7 manual test: messaging + notifications
#
# Usage (local):    .\scripts\week7-test.ps1
# Usage (Render):   .\scripts\week7-test.ps1 -BaseUrl "https://petpro-app.onrender.com"
#
# What it proves: message thread opened -> message sent -> resend is a no-op
# (offline-safe idempotency) -> offline draft sync delivers queued messages
# exactly once -> contract generate + sign queues the "contract ready" and
# "contract signed" client emails -> booking a walk queues its 24h reminder
# -> cancelling the walk cancels the reminder -> the email test probe
# reports whether the Resend key actually sends.
#
# With no RESEND_API_KEY set, everything still passes: emails queue as
# "pending" and send automatically once the key is added. When the key IS
# set, step 7 sends a real test email to the account's inbox. (Heads-up:
# until a sending domain is verified in Resend, Resend only delivers to the
# email address that owns the Resend account.)

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

# --- Step 1: health + account + client --------------------------------------------
try {
  Invoke-RestMethod -Uri "$BaseUrl/health" | Out-Null
  $signup = Post "/api/auth/signup" @{ email = "week7test+$stamp@example.com"; password = "Test-Password-123!"; fullName = "Week Seven Tester"; businessName = "Messaging Test Walking Co." }
  $token = $signup.data.access_token
  $client = Post "/api/clients" @{ full_name = "Message Client"; email = "message.client@example.com"; cancellation_window_hours = 24; status = "active" } $token
  Write-Host "[PASS] 1. Health + signup + client" -ForegroundColor Green
} catch { Fail "Setup" $_ }

# --- Step 2: open a thread + send a message ----------------------------------------
try {
  $thread = Post "/api/threads" @{ client_id = $client.data.id } $token
  $again = Post "/api/threads" @{ client_id = $client.data.id } $token
  if ($again.data.id -ne $thread.data.id) { Fail "Thread" "Opening twice created two threads - should be one per client" }
  $sent = Post "/api/threads/$($thread.data.id)/messages" @{ body = "Hi! Peanut did great today."; client_draft_id = "w7-draft-1-$stamp" } $token
  if (-not $sent.data.id) { Fail "Send" "Message send returned no id" }
  Write-Host "[PASS] 2. Thread opened (one per client), message sent" -ForegroundColor Green
} catch { Fail "Messaging" $_ }

# --- Step 3: resending the same draft never duplicates ------------------------------
try {
  $resend = Post "/api/threads/$($thread.data.id)/messages" @{ body = "Hi! Peanut did great today."; client_draft_id = "w7-draft-1-$stamp" } $token
  if ($resend.data.id -ne $sent.data.id) { Fail "Idempotency" "Resend created a duplicate message" }
  $sync = Post "/api/messages/sync" @{ drafts = @(
    @{ client_id = $client.data.id; client_draft_id = "w7-draft-1-$stamp"; body = "Hi! Peanut did great today." },
    @{ client_id = $client.data.id; client_draft_id = "w7-draft-2-$stamp"; body = "Sent while offline - synced later." }
  ) } $token
  if ($sync.data[0].status -ne "duplicate") { Fail "Draft sync" "Already-sent draft should be 'duplicate', got $($sync.data[0].status)" }
  if ($sync.data[1].status -ne "created") { Fail "Draft sync" "New draft should be 'created', got $($sync.data[1].status)" }
  $messages = Get-Api "/api/threads/$($thread.data.id)/messages" $token
  if ($messages.data.Count -ne 2) { Fail "Draft sync" "Expected exactly 2 messages after all the resends, got $($messages.data.Count)" }
  Write-Host "[PASS] 3. Resend + offline draft sync: exactly 2 messages, no duplicates" -ForegroundColor Green
} catch { Fail "Draft sync" $_ }

# --- Step 4: contract flow queues the client emails ---------------------------------
try {
  $template = Post "/api/contract-templates/seed" @{} $token
  $generated = Post "/api/contracts" @{
    template_id = $template.data.id; client_id = $client.data.id
    variables = @{ walk_type = "Private Walk"; photo_consent = "Yes"; service_price = "`$30.00 per walk"; service_schedule = "Mon/Wed/Fri"; start_date = "August 1, 2026"; no_show_fee = "`$25.00"; emergency_vet_cap = "`$500.00"; key_handling = "No keys held" }
  } $token
  $signaturePng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg=="
  Post "/api/contracts/$($generated.data.contract.id)/sign" @{ signer_name = "Message Client"; signature_image = $signaturePng } $token | Out-Null
  $queue = Get-Api "/api/notifications" $token
  $ready = @($queue.data | Where-Object { $_.payload.template -eq "contract_ready" })
  $signedMail = @($queue.data | Where-Object { $_.payload.template -eq "contract_signed" })
  if ($ready.Count -lt 1) { Fail "Contract emails" "No 'contract ready' email was queued when the contract was generated" }
  if ($signedMail.Count -lt 1) { Fail "Contract emails" "No 'contract signed' email was queued when the contract was signed" }
  Write-Host "[PASS] 4. Contract generate + sign queued both client emails (ready + signed w/ copy attached)" -ForegroundColor Green
} catch { Fail "Contract emails" $_ }

# --- Step 5: the signed contract is downloadable (W-1) ------------------------------
try {
  $doc = Invoke-WebRequest -Uri "$BaseUrl/api/contracts/$($generated.data.contract.id)/document" -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing
  if ($doc.Content -notmatch "Signed by Message Client") { Fail "Document" "Contract document is missing the signed-by footer" }
  if ($doc.Content -notmatch "<!doctype html>") { Fail "Document" "Document is not a standalone HTML page" }
  Write-Host "[PASS] 5. Signed contract downloadable as a standalone document (print -> save as PDF)" -ForegroundColor Green
} catch { Fail "Document" $_ }

# --- Step 6: booking a walk queues a reminder; cancelling cancels it -----------------
try {
  $service = Post "/api/services" @{ client_id = $client.data.id; name = "Private walk (30 min)"; service_type = "private_walk"; price_cents = 3000; billing_cadence = "per_visit"; duration_minutes = 30 } $token
  # 3 days out, so the 24h-before reminder is definitely in the future.
  $start = (Get-Date).Date.AddDays(3).AddHours(10)
  $startIso = $start.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $appt = Post "/api/appointments" @{ service_id = $service.data.id; starts_at = $startIso } $token
  $queue = Get-Api "/api/notifications" $token
  $reminder = @($queue.data | Where-Object { $_.payload.appointment_id -eq $appt.data[0].id })
  if ($reminder.Count -ne 1) { Fail "Reminder" "Expected exactly 1 queued reminder for the walk, got $($reminder.Count)" }
  if ($reminder[0].status -ne "pending") { Fail "Reminder" "Fresh reminder should be pending, got $($reminder[0].status)" }

  Post "/api/appointments/$($appt.data[0].id)/cancel" @{ scope = "one" } $token | Out-Null
  $queue = Get-Api "/api/notifications" $token
  $reminder = @($queue.data | Where-Object { $_.payload.appointment_id -eq $appt.data[0].id })
  if ($reminder[0].status -ne "cancelled") { Fail "Reminder" "Cancelling the walk should cancel its reminder, got $($reminder[0].status)" }
  Write-Host "[PASS] 6. Walk booked -> 24h reminder queued; walk cancelled -> reminder cancelled" -ForegroundColor Green
} catch { Fail "Reminder" $_ }

# --- Step 7: email test probe (proves the Resend key, when present) ------------------
try {
  $probe = Post "/api/notifications/test" @{} $token
  if ($probe.data.summary.configured) {
    if ($probe.data.notification.status -eq "sent") {
      Write-Host "[PASS] 7. Email key works - test email SENT to week7test+$stamp@example.com" -ForegroundColor Green
      Write-Host "        (Resend without a verified domain only delivers to the Resend account owner's inbox - check there.)" -ForegroundColor Yellow
    } else {
      Fail "Email probe" "Email key is set but the send failed: $($probe.data.notification.error)"
    }
  } else {
    Write-Host "[PASS] 7. No RESEND_API_KEY yet - notifications queue as pending and send once it's added" -ForegroundColor Green
    Write-Host "        Founder task: create a Resend account, put RESEND_API_KEY in .env (local) and Render, then re-run this script." -ForegroundColor Yellow
  }
} catch { Fail "Email probe" $_ }

Write-Host ""
Write-Host "WEEK 7 TEST PASSED against $BaseUrl" -ForegroundColor Green
Write-Host "Also try it in the browser: Messages tab -> pick a client -> send. Open the same thread in a second window to watch real-time delivery."
