/**
 * PetPro Connect — end-to-end API test, runnable from any command line.
 *
 * Usage (local):    npm test
 * Usage (Render):   npm test -- --base-url https://petpro-app.onrender.com
 *
 * Drives the whole loop the app supports so far in one command:
 * auth → clients/pets → contract generate/sign/immutability → billing →
 * scheduling (recurrence, conflicts, complete → auto-invoice) → event log →
 * messaging (threads, idempotent sends, offline draft sync) → notifications
 * (queued emails + reminder lifecycle) → owner portal (magic-link session,
 * overview, remote signing, Stripe checkout creation, messaging, access
 * control both directions).
 *
 * Everything here is fully automated — no browser, no Stripe Checkout step.
 * (Paying an invoice with the test card stays in week5-test.ps1, since only
 * a human can complete Stripe's hosted payment page.) The owner-portal step
 * mints its magic-link token server-side (generateLink → verifyOtp — the
 * exact flow the emailed link performs), which needs the repo's .env; when
 * testing against Render the same Supabase project backs both, so it works
 * there too.
 *
 * Exit code 0 = all steps passed; 1 = something failed (CI-friendly).
 */

const baseUrl = (() => {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--base-url');
  if (flag !== -1 && args[flag + 1]) return args[flag + 1].replace(/\/$/, '');
  const positional = args.find((a) => a.startsWith('http'));
  return (positional ?? 'http://localhost:3000').replace(/\/$/, '');
})();

let token = '';
let passed = 0;
let failed = 0;

function pass(step: string): void {
  passed++;
  console.log(`\x1b[32m[PASS]\x1b[0m ${step}`);
}
function fail(step: string, detail: unknown): never {
  failed++;
  console.log(`\x1b[31m[FAIL]\x1b[0m ${step}`);
  console.log(detail instanceof Error ? detail.message : JSON.stringify(detail, null, 2));
  console.log(`\n${passed} passed, ${failed} failed — E2E TEST FAILED against ${baseUrl}`);
  process.exit(1);
}
function assert(condition: unknown, step: string, detail: string): asserts condition {
  if (!condition) fail(step, detail);
}

interface ApiResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  errorMessage: string;
}

async function api(method: string, path: string, body?: unknown, auth?: string): Promise<ApiResult> {
  const bearer = auth ?? token;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    data?: unknown;
    error?: { message?: string };
  } | null;
  return {
    status: res.status,
    data: json?.data ?? null,
    errorMessage: json?.error?.message ?? '',
  };
}

/** For calls that must succeed — anything but 2xx fails the run. */
async function ok(method: string, path: string, body: unknown, step: string, auth?: string): Promise<ApiResult> {
  const result = await api(method, path, body, auth);
  assert(
    result.status >= 200 && result.status < 300,
    step,
    `${method} ${path} → ${result.status}: ${result.errorMessage || '(no error message)'}`
  );
  return result;
}

// 1×1 transparent PNG — the smallest thing the sign endpoint accepts.
const SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==';

async function main(): Promise<void> {
  console.log(`Testing against ${baseUrl}\n`);
  const stamp = Date.now();

  // --- 1. Health + auth ----------------------------------------------------
  {
    const health = await api('GET', '/health');
    assert(health.status === 200, '1. Health', `GET /health → ${health.status}. Is the server running?`);

    const email = `e2e+${stamp}@example.com`;
    const password = 'Test-Password-123!';
    const signup = await ok('POST', '/api/auth/signup', {
      email,
      password,
      fullName: 'E2E Tester',
      businessName: 'E2E Walking Co.',
    }, '1. Signup');
    token = signup.data.access_token;

    const login = await ok('POST', '/api/auth/login', { email, password }, '1. Login');
    token = login.data.access_token;

    const me = await ok('GET', '/api/auth/me', undefined, '1. Session');
    assert(me.data.account?.account_type === 'professional', '1. Session', 'auth/me did not return a professional account');
    pass('1. Health + signup + login + session');
  }

  // --- 2. CRM: client + pets + search ---------------------------------------
  const client = (
    await ok('POST', '/api/clients', {
      full_name: 'E2E Client',
      email: `e2e.client+${stamp}@example.com`, // unique per run — step 11 links the owner portal to it
      cancellation_window_hours: 24,
      status: 'active',
    }, '2. Client')
  ).data;
  {
    await ok('POST', `/api/clients/${client.id}/pets`, { name: `Biscuit${stamp}`, breed: 'Beagle', weight_lb: 24 }, '2. Pet');
    await ok('POST', `/api/clients/${client.id}/pets`, { name: 'Waffles', breed: 'Corgi' }, '2. Pet 2');
    const search = await ok('GET', `/api/clients?q=Biscuit${stamp}`, undefined, '2. Search');
    assert(
      search.data.length === 1 && search.data[0].id === client.id,
      '2. Search',
      `Searching the pet's name should surface exactly its client; got ${search.data.length} result(s)`
    );
    // P2-13: a client with an email gets a portal welcome. It links to
    // /portal rather than carrying a magic link, so it can't burn the
    // Supabase mailer's ~2/hour budget on someone who isn't ready to log in.
    const inviteQueue = (await ok('GET', '/api/notifications', undefined, '2. Portal invite')).data as {
      payload: { template?: string; client_id?: string };
    }[];
    assert(
      inviteQueue.some((r) => r.payload.template === 'portal_invite' && r.payload.client_id === client.id),
      '2. Portal invite',
      'P2-13: creating a client with an email did not queue the portal invite'
    );
    pass('2. Client + 2 pets + search by pet name + portal invite queued');
  }

  // --- 3. Contract: generate → sign → locked --------------------------------
  {
    const template = (await ok('POST', '/api/contract-templates/seed', {}, '3. Template seed')).data;
    const generated = (
      await ok('POST', '/api/contracts', {
        template_id: template.id,
        client_id: client.id,
        variables: {
          walk_type: 'Private Walk',
          photo_consent: 'Yes',
          service_price: '$30.00 per 30-minute walk',
          service_schedule: 'Mon/Wed/Fri, 30-minute midday walk',
          start_date: 'July 20, 2026',
          no_show_fee: '$25.00',
          emergency_vet_cap: '$500.00',
          key_handling: 'No keys held',
        },
      }, '3. Generate')
    ).data;
    const contract = generated.contract;
    assert(contract.status === 'draft', '3. Generate', `Expected draft, got ${contract.status}`);

    const signed = (
      await ok('POST', `/api/contracts/${contract.id}/sign`, { signer_name: 'E2E Client', signature_image: SIGNATURE }, '3. Sign')
    ).data;
    assert(signed.status === 'signed', '3. Sign', `Expected signed, got ${signed.status}`);

    const edit = await api('PATCH', `/api/contracts/${contract.id}`, { generated_html: '<p>tampered</p>' });
    assert(edit.status === 409, '3. Immutability', `Editing a signed contract returned ${edit.status}, expected 409`);
    const resign = await api('POST', `/api/contracts/${contract.id}/sign`, { signer_name: 'Again', signature_image: SIGNATURE });
    assert(resign.status === 409, '3. Immutability', `Re-signing returned ${resign.status}, expected 409`);
    pass('3. Contract generated, signed, and locked (edit + re-sign both 409)');
  }

  // --- 4. Billing: custom invoice + void refuses payment ---------------------
  {
    const invoice = (
      await ok('POST', '/api/invoices', { client_id: client.id, amount_cents: 1500, description: 'E2E holiday key pickup' }, '4. Invoice')
    ).data;
    assert(invoice.status === 'open', '4. Invoice', `Expected open, got ${invoice.status}`);
    const voided = (await ok('POST', `/api/invoices/${invoice.id}/void`, {}, '4. Void')).data;
    assert(voided.status === 'void', '4. Void', `Expected void, got ${voided.status}`);
    const checkout = await api('POST', `/api/invoices/${invoice.id}/checkout`, {});
    assert(checkout.status === 409, '4. Void', `Checkout on a voided invoice returned ${checkout.status}, expected 409`);
    pass('4. Invoice created, voided, and voided invoice refuses payment (409)');
  }

  // --- 5. Scheduling: service + weekly series + conflict ---------------------
  const tomorrow10 = new Date();
  tomorrow10.setDate(tomorrow10.getDate() + 1);
  tomorrow10.setHours(10, 0, 0, 0);
  const service = (
    await ok('POST', '/api/services', {
      client_id: client.id,
      name: 'Private walk (30 min)',
      service_type: 'private_walk',
      price_cents: 3000,
      billing_cadence: 'per_visit',
      duration_minutes: 30,
    }, '5. Service')
  ).data;
  let series: { id: string; starts_at: string; recurrence_rule: string | null; recurrence_parent_id: string | null }[];
  {
    assert(service.status === 'active', '5. Service', `Expected active, got ${service.status}`);
    series = (
      await ok('POST', '/api/appointments', {
        service_id: service.id,
        starts_at: tomorrow10.toISOString(),
        repeat_weeks: 4,
      }, '5. Series')
    ).data;
    assert(series.length === 4, '5. Series', `Expected 4 occurrences, got ${series.length}`);
    assert(series[0].recurrence_rule === 'FREQ=WEEKLY;COUNT=4', '5. Series', `Parent RRULE is ${series[0].recurrence_rule}`);

    const clash = await api('POST', '/api/appointments', {
      service_id: service.id,
      starts_at: new Date(tomorrow10.getTime() + 7 * 24 * 3600 * 1000 + 15 * 60 * 1000).toISOString(),
    });
    assert(clash.status === 409, '5. Conflict', `Overlapping slot returned ${clash.status}, expected 409 — double-booking possible!`);
    assert(/double-book/i.test(clash.errorMessage), '5. Conflict', `409 message doesn't explain the clash: "${clash.errorMessage}"`);

    // Multi-day series (tester feedback 2026-07-18): base day + extra_starts
    // book as one series — 2 days a week for 2 weeks = 4 rows, one parent.
    const multiBase = new Date(tomorrow10.getTime() + 2 * 24 * 3600 * 1000 + 4 * 3600 * 1000); // +2 days, 14:00
    const multiExtra = new Date(multiBase.getTime() + 2 * 24 * 3600 * 1000);
    const multi = (
      await ok('POST', '/api/appointments', {
        service_id: service.id,
        starts_at: multiBase.toISOString(),
        repeat_weeks: 2,
        extra_starts: [multiExtra.toISOString()],
      }, '5. Multi-day')
    ).data as typeof series;
    assert(multi.length === 4, '5. Multi-day', `2 days × 2 weeks should be 4 walks, got ${multi.length}`);
    const parent = multi.find((a) => a.recurrence_rule);
    assert(parent, '5. Multi-day', 'No occurrence carries the recurrence rule');
    assert(
      multi.filter((a) => a.recurrence_parent_id === parent.id).length === 3,
      '5. Multi-day',
      'Children not linked to the series parent'
    );
    // Compare as epoch ms — the DB serializes timestamps as +00:00, not Z.
    const expectedStarts = [0, 2, 7, 9].map((d) => multiBase.getTime() + d * 24 * 3600 * 1000);
    const actualStarts = multi.map((a) => Date.parse(a.starts_at)).sort((a, b) => a - b);
    assert(
      JSON.stringify(actualStarts) === JSON.stringify(expectedStarts),
      '5. Multi-day',
      `Occurrence dates wrong: ${multi.map((a) => a.starts_at).join(', ')}`
    );
    const multiEnded = (await ok('POST', `/api/appointments/${parent.id}/cancel`, { scope: 'following' }, '5. Multi-day cancel')).data;
    assert(multiEnded.length === 4, '5. Multi-day cancel', `End series should cancel all 4, got ${multiEnded.length}`);
    pass('5. Service + 4-week series booked; double-booking blocked (409); multi-day series (2 days/week × 2 weeks) booked and ended as one');
  }

  // --- 6. Complete → walk report + auto-invoice, exactly once ----------------
  {
    const completion = (
      await ok('POST', `/api/appointments/${series[0].id}/complete`, {
        completion_notes: 'E2E full loop',
        good_dog: true,
        got_a_treat: true,
      }, '6. Complete')
    ).data;
    assert(completion.appointment.status === 'completed', '6. Complete', `Expected completed, got ${completion.appointment.status}`);
    assert(completion.appointment.good_dog === true, '6. Complete', 'Walk-report flags not stored');
    assert(completion.invoice, '6. Auto-invoice', 'Completing a per_visit walk returned no invoice');
    assert(completion.invoice.amount_cents === 3000, '6. Auto-invoice', `Expected 3000 cents, got ${completion.invoice.amount_cents}`);
    assert(completion.invoice.service_id === service.id, '6. Auto-invoice', 'Invoice not linked to the service');

    const again = await api('POST', `/api/appointments/${series[0].id}/complete`, {});
    assert(again.status === 409, '6. Idempotency', `Double-complete returned ${again.status}, expected 409 (would double-bill!)`);

    const ended = (await ok('POST', `/api/appointments/${series[1].id}/cancel`, { scope: 'following' }, '6. Series cancel')).data;
    assert(ended.length === 3, '6. Series cancel', `Expected 3 cancelled walks, got ${ended.length}`);
    pass('6. Walk completed once (double-complete 409), $30 auto-invoice, series ended');
  }

  // --- 7. Event log carries the whole story ----------------------------------
  {
    const events = (await ok('GET', '/api/events?limit=100', undefined, '7. Events')).data as {
      event_type: string;
      subject_id: string | null;
      metadata: Record<string, unknown>;
    }[];
    for (const expected of ['client_created', 'contract_signed', 'appointment_scheduled', 'walk_completed', 'invoice_generated']) {
      assert(events.some((e) => e.event_type === expected), '7. Events', `No ${expected} event in the log`);
    }
    const walk = events.find((e) => e.event_type === 'walk_completed' && e.subject_id === series[0].id);
    assert(walk, '7. Events', 'walk_completed event missing for the completed appointment');
    assert(walk.metadata.good_dog === true, '7. Events', 'walk_completed payload missing the walk report');
    assert(walk.metadata.next_appointment_starts_at, '7. Events', 'walk_completed payload missing next_appointment_starts_at');
    pass('7. Event log: client_created, contract_signed, appointment_scheduled, walk_completed (full payload), invoice_generated');
  }

  // --- 8. Profile mapping + per-day boarding + session count -----------------
  {
    const updated = (
      await ok('PATCH', '/api/auth/profile', {
        business_name: 'E2E Boarding Co.',
        // PH-1: phone is an accounts column, not a professional_profiles one —
        // the route splits it out, so this also proves the split works.
        phone: '(555)010-7788',
        offered_service_types: ['private_walk', 'boarding'],
      }, '8. Profile update')
    ).data;
    assert(
      Array.isArray(updated.offered_service_types) && updated.offered_service_types.length === 2,
      '8. Profile update',
      `offered_service_types not stored: ${JSON.stringify(updated.offered_service_types)}`
    );
    const me = await ok('GET', '/api/auth/me', undefined, '8. Profile readback');
    assert(
      me.data.profile.offered_service_types.includes('boarding'),
      '8. Profile readback',
      'auth/me does not return the saved offered_service_types'
    );
    assert(
      me.data.account.phone === '(555)010-7788',
      '8. Profile readback',
      `PH-1: account phone not saved or not returned by auth/me (got ${JSON.stringify(me.data.account.phone)})`
    );

    // Day-priced boarding: a 44-hour stay bills as 2 days.
    const boarding = (
      await ok('POST', '/api/services', {
        client_id: client.id,
        name: 'Overnight boarding',
        service_type: 'boarding',
        price_cents: 5000,
        billing_cadence: 'per_day',
      }, '8. Boarding service')
    ).data;
    const stayStart = new Date(tomorrow10.getTime() + 10 * 3600 * 1000); // tomorrow 20:00 — clear of the walk slots
    const stay = (
      await ok('POST', '/api/appointments', {
        service_id: boarding.id,
        starts_at: stayStart.toISOString(),
        ends_at: new Date(stayStart.getTime() + 44 * 3600 * 1000).toISOString(),
      }, '8. Boarding stay')
    ).data;

    // Boarding is not exclusive time: a second boarder can overlap the stay,
    // and a walk can be booked mid-stay. Walk-vs-walk conflicts still 409.
    await ok('POST', '/api/appointments', {
      service_id: boarding.id,
      starts_at: new Date(stayStart.getTime() + 3600 * 1000).toISOString(),
      ends_at: new Date(stayStart.getTime() + 30 * 3600 * 1000).toISOString(),
    }, '8. Second overlapping boarder');
    const walkDuringStay = (
      await ok('POST', '/api/appointments', {
        service_id: service.id, // the per-visit walk service from step 5
        starts_at: new Date(stayStart.getTime() + 14 * 3600 * 1000).toISOString(),
      }, '8. Walk mid-stay')
    ).data;
    const walkClash = await api('POST', '/api/appointments', {
      service_id: service.id,
      starts_at: new Date(stayStart.getTime() + 14 * 3600 * 1000 + 10 * 60 * 1000).toISOString(),
    });
    assert(
      walkClash.status === 409,
      '8. Walk-vs-walk still guarded',
      `Overlapping walks should still 409 even with boarding exempt; got ${walkClash.status}`
    );
    await ok('POST', `/api/appointments/${walkDuringStay[0].id}/cancel`, { scope: 'one' }, '8. Cleanup walk');

    const done = (await ok('POST', `/api/appointments/${stay[0].id}/complete`, {}, '8. Boarding complete')).data;
    assert(done.invoice, '8. Boarding complete', 'Completing a per_day stay returned no invoice');
    assert(
      done.invoice.amount_cents === 10000,
      '8. Boarding complete',
      `44-hour stay at $50/day should invoice $100.00 (2 days), got ${done.invoice.amount_cents} cents`
    );
    assert(/2 days/.test(done.invoice.description), '8. Boarding complete', `Description missing day count: "${done.invoice.description}"`);

    // "# of sessions" is stored on package services.
    const pkg = (
      await ok('POST', '/api/services', {
        client_id: client.id,
        name: 'Training package',
        service_type: 'training_session',
        price_cents: 50000,
        billing_cadence: 'per_package',
        session_count: 10,
      }, '8. Package service')
    ).data;
    assert(pkg.session_count === 10, '8. Package service', `session_count not stored, got ${pkg.session_count}`);
    pass('8. Profile mapping saved; boarding non-exclusive (2nd boarder + mid-stay walk OK, walk-vs-walk still 409); per-day stay billed 2 days = $100; session_count stored');
  }

  // --- 9. Messaging: thread + idempotent sends + offline draft sync ----------
  {
    const thread = (await ok('POST', '/api/threads', { client_id: client.id }, '9. Thread')).data;
    const sameThread = (await ok('POST', '/api/threads', { client_id: client.id }, '9. Thread reuse')).data;
    assert(sameThread.id === thread.id, '9. Thread reuse', 'Second open created a second thread — should be one per client');

    const sent = (
      await ok('POST', `/api/threads/${thread.id}/messages`, { body: 'Hello from E2E', client_draft_id: `e2e-d1-${stamp}` }, '9. Send')
    ).data;
    const resend = (
      await ok('POST', `/api/threads/${thread.id}/messages`, { body: 'Hello from E2E', client_draft_id: `e2e-d1-${stamp}` }, '9. Resend')
    ).data;
    assert(resend.id === sent.id, '9. Resend', 'Resending the same draft created a duplicate message');

    const synced = (
      await ok('POST', '/api/messages/sync', {
        drafts: [
          { client_id: client.id, client_draft_id: `e2e-d1-${stamp}`, body: 'Hello from E2E' },
          { client_id: client.id, client_draft_id: `e2e-d2-${stamp}`, body: 'Queued while offline' },
        ],
      }, '9. Draft sync')
    ).data as { client_draft_id: string; status: string }[];
    assert(synced[0].status === 'duplicate', '9. Draft sync', `Already-sent draft should report duplicate, got ${synced[0].status}`);
    assert(synced[1].status === 'created', '9. Draft sync', `New draft should report created, got ${synced[1].status}`);

    const messages = (await ok('GET', `/api/threads/${thread.id}/messages`, undefined, '9. List')).data;
    assert(messages.length === 2, '9. List', `Expected exactly 2 messages, got ${messages.length}`);

    const threads = (await ok('GET', '/api/threads', undefined, '9. Threads list')).data as {
      id: string; unread_count: number; last_message: { body: string } | null;
    }[];
    const mine = threads.find((t) => t.id === thread.id);
    assert(mine, '9. Threads list', 'Thread missing from the list');
    assert(mine.last_message?.body === 'Queued while offline', '9. Threads list', 'last_message preview is stale');
    assert(mine.unread_count === 0, '9. Threads list', 'Own messages counted as unread');
    pass('9. Messaging: one thread per client, resend + draft sync idempotent, previews correct');
  }

  // --- 10. Notifications: queued emails + reminder lifecycle ------------------
  {
    const rows = (await ok('GET', '/api/notifications', undefined, '10. Queue')).data as {
      category: string; status: string; payload: { template?: string; appointment_id?: string };
    }[];
    for (const template of ['contract_ready', 'contract_signed']) {
      assert(
        rows.some((r) => r.payload.template === template),
        '10. Queue',
        `No ${template} notification queued by the contract flow`
      );
    }
    // Walks 2–4 of the series got 24h reminders, then step 6 cancelled those
    // walks — their reminders must be cancelled too, never sent.
    const cancelledIds = new Set(series.slice(1).map((s) => s.id));
    const reminders = rows.filter((r) => r.category === 'appointment_reminder' && cancelledIds.has(r.payload.appointment_id ?? ''));
    assert(reminders.length === 3, '10. Reminders', `Expected 3 reminders for the cancelled series walks, got ${reminders.length}`);
    assert(
      reminders.every((r) => r.status === 'cancelled'),
      '10. Reminders',
      `Cancelling walks must cancel their reminders; statuses: ${reminders.map((r) => r.status).join(', ')}`
    );

    // Draining the queue is opt-in (PETPRO_E2E_SEND=1) and it must stay that
    // way. Every recipient this suite creates is at example.com — an IANA
    // reserved domain that accepts no mail — so a real send pass produces one
    // hard bounce per queued row. That was harmless while the sandbox sender
    // refused non-owner recipients, but now that eastwestoak.com is verified
    // those bounces land against its reputation, which is slow to repair.
    if (process.env.PETPRO_E2E_SEND === '1') {
      const processed = (await ok('POST', '/api/notifications/process', {}, '10. Process')).data as {
        configured: boolean; sent: number; failed: number;
      };
      pass(`10. Notifications: contract emails queued, cancelled walks' reminders cancelled, queue drained on request (configured=${processed.configured}, ${processed.sent} sent, ${processed.failed} failed — expect failures, these recipients don't exist)`);
    } else {
      pass('10. Notifications: contract emails queued, cancelled walks\' reminders cancelled (send pass skipped so example.com recipients can\'t bounce against the verified domain — set PETPRO_E2E_SEND=1 to drain it deliberately)');
    }
  }

  // --- 11. Owner portal: magic-link session → view, sign, pay, message -------
  {
    const ownerEmail = `e2e.client+${stamp}@example.com`;

    // Mint the magic-link token exactly the way the emailed link does
    // (generateLink → verifyOtp) — a script has no inbox to click through.
    let ownerToken = '';
    {
      const { supabaseAdmin, supabaseAnon } = await import('../src/config/supabase');
      // generateLink only works for existing auth users (the real emailed
      // flow creates one via signInWithOtp) — create it up front.
      await supabaseAdmin.auth.admin.createUser({ email: ownerEmail, email_confirm: true });
      const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: 'magiclink', email: ownerEmail });
      assert(!error && data, '11. Magic link', `generateLink failed: ${error?.message}`);
      const { data: verified, error: verifyError } = await supabaseAnon.auth.verifyOtp({
        token_hash: data.properties.hashed_token,
        type: 'magiclink',
      });
      assert(!verifyError && verified.session, '11. Magic link', `verifyOtp failed: ${verifyError?.message}`);
      ownerToken = verified.session.access_token;
    }

    // Session exchange creates the owner account and links the client record.
    const session = (await ok('POST', '/api/portal/session', { access_token: ownerToken }, '11. Session')).data;
    assert(session.account.account_type === 'owner', '11. Session', `Expected owner account, got ${session.account.account_type}`);
    assert(
      session.clients.some((c: { id: string }) => c.id === client.id),
      '11. Session',
      'The owner\'s email did not link to their client record'
    );

    // Seed what the portal home shows: an upcoming walk + a fresh draft contract.
    const nextWalk = new Date(tomorrow10.getTime() - 3600 * 1000); // tomorrow 09:00 — clear of the other slots
    await ok('POST', '/api/appointments', { service_id: service.id, starts_at: nextWalk.toISOString() }, '11. Upcoming walk');
    const template = (await ok('POST', '/api/contract-templates/seed', {}, '11. Template')).data;
    const draft = (await ok('POST', '/api/contracts', { template_id: template.id, client_id: client.id }, '11. Draft')).data.contract;

    const overview = (await ok('GET', '/api/portal/overview', undefined, '11. Overview', ownerToken)).data;
    assert(overview.clients.length === 1, '11. Overview', `Expected 1 linked client, got ${overview.clients.length}`);
    assert(
      overview.clients[0].professional?.business_name === 'E2E Boarding Co.',
      '11. Overview',
      'Overview missing the professional\'s business name'
    );
    // C-3: the owner must be able to see how to reach their walker.
    assert(
      overview.clients[0].professional?.phone === '(555)010-7788',
      '11. Overview',
      `C-3: walker phone missing from the portal overview (got ${JSON.stringify(overview.clients[0].professional?.phone)})`
    );
    assert(
      typeof overview.clients[0].professional?.email === 'string' && overview.clients[0].professional.email.includes('@'),
      '11. Overview',
      'C-3: walker email missing from the portal overview'
    );
    assert(
      overview.appointments.some((a: { client_id: string }) => a.client_id === client.id),
      '11. Overview',
      'Upcoming visit missing from the portal overview'
    );
    assert(
      overview.contracts.some((k: { id: string; status: string }) => k.id === draft.id && k.status === 'draft'),
      '11. Overview',
      'The draft agreement is missing from the portal overview'
    );

    // The owner signs remotely — same signature capture, their login is the identity.
    const signed = (
      await ok('POST', `/api/portal/contracts/${draft.id}/sign`, { signer_name: 'E2E Owner', signature_image: SIGNATURE }, '11. Portal sign', ownerToken)
    ).data;
    assert(signed.status === 'signed', '11. Portal sign', `Expected signed, got ${signed.status}`);
    const notifyRows = (await ok('GET', '/api/notifications', undefined, '11. Notify')).data as {
      payload: { template?: string; contract_id?: string };
    }[];
    assert(
      notifyRows.some((r) => r.payload.template === 'contract_signed' && r.payload.contract_id === draft.id),
      '11. Notify',
      'Portal signing did not queue the contract_signed email'
    );

    // Pay leg: the portal creates a real Stripe Checkout session; an unpaid
    // one stays open after a sync. (Completing payment needs a human — that
    // stays in week5-test.ps1.)
    const invoice = (
      await ok('POST', '/api/invoices', { client_id: client.id, amount_cents: 2000, description: 'E2E portal pay leg' }, '11. Invoice')
    ).data;
    const checkout = (await ok('POST', `/api/portal/invoices/${invoice.id}/checkout`, {}, '11. Checkout', ownerToken)).data;
    assert(
      typeof checkout.checkout_url === 'string' && checkout.checkout_url.includes('checkout.stripe.com'),
      '11. Checkout',
      `Portal checkout did not return a Stripe URL: ${checkout.checkout_url}`
    );
    const syncedInvoice = (await ok('POST', `/api/portal/invoices/${invoice.id}/sync`, {}, '11. Sync', ownerToken)).data;
    assert(syncedInvoice.status === 'open', '11. Sync', `Unpaid invoice should stay open after sync, got ${syncedInvoice.status}`);

    // Message leg: owner → professional, idempotent like everything else.
    const thread = (await ok('POST', '/api/portal/threads', { client_id: client.id }, '11. Thread', ownerToken)).data;
    const sent = (
      await ok('POST', `/api/portal/threads/${thread.id}/messages`, { body: 'Portal hello', client_draft_id: `e2e-o1-${stamp}` }, '11. Owner send', ownerToken)
    ).data;
    const resent = (
      await ok('POST', `/api/portal/threads/${thread.id}/messages`, { body: 'Portal hello', client_draft_id: `e2e-o1-${stamp}` }, '11. Owner resend', ownerToken)
    ).data;
    assert(
      resent.duplicate === true && resent.message.id === sent.message.id,
      '11. Owner resend',
      'Resending the same portal draft created a duplicate message'
    );
    const proView = (await ok('GET', `/api/threads/${thread.id}/messages`, undefined, '11. Professional sees it')).data as { body: string }[];
    assert(proView.some((m) => m.body === 'Portal hello'), '11. Professional sees it', 'Owner message not visible to the professional');

    // O-2: the walker replies and the owner must be able to notice. This is
    // what makes the read-only portal (D2) workable — "message your walker"
    // is the only correction path, so the reply has to surface somewhere.
    // Relative to a baseline: earlier steps already left professional messages
    // unread in this thread, so assert the delta rather than an absolute count.
    const baseUnread = (await ok('GET', '/api/portal/overview', undefined, '11. Unread baseline', ownerToken)).data.unread_messages;
    await ok('POST', `/api/threads/${thread.id}/messages`, { body: 'Walker reply', client_draft_id: `e2e-o2-${stamp}` }, '11. Walker reply');
    const withUnread = (await ok('GET', '/api/portal/overview', undefined, '11. Unread', ownerToken)).data;
    assert(
      withUnread.unread_messages === baseUnread + 1,
      '11. Unread',
      `O-2: walker reply should raise unread from ${baseUnread} to ${baseUnread + 1}, got ${withUnread.unread_messages}`
    );
    // The walker's reply queues an email, scheduled 5 minutes out so a chatty
    // thread doesn't send one per message.
    const msgQueue = (await ok('GET', '/api/notifications', undefined, '11. Message email')).data as {
      category: string; status: string; scheduled_for: string; payload: { template?: string };
    }[];
    const queuedMessageEmail = msgQueue.find((r) => r.payload.template === 'message_received');
    assert(Boolean(queuedMessageEmail), '11. Message email', 'O-2: walker reply did not queue a message_received email');
    assert(
      new Date(queuedMessageEmail!.scheduled_for).getTime() > Date.now() + 60_000,
      '11. Message email',
      'O-2: message email should be deferred, not sent immediately'
    );

    await ok('POST', `/api/portal/threads/${thread.id}/read`, {}, '11. Owner reads', ownerToken);
    const afterRead = (await ok('GET', '/api/portal/overview', undefined, '11. Unread cleared', ownerToken)).data;
    assert(
      afterRead.unread_messages === 0,
      '11. Unread cleared',
      `O-2: unread should be 0 after the owner reads, got ${afterRead.unread_messages}`
    );

    // Access control seals the seam: neither token works on the other side.
    const ownerOnPro = await api('GET', '/api/clients', undefined, ownerToken);
    assert(ownerOnPro.status === 403, '11. Access control', `Owner token on professional routes returned ${ownerOnPro.status}, expected 403`);
    const proOnPortal = await api('GET', '/api/portal/overview', undefined);
    assert(proOnPortal.status === 403, '11. Access control', `Professional token on portal routes returned ${proOnPortal.status}, expected 403`);

    pass('11. Owner portal: magic-link session linked the client; overview complete; remote sign queued the email; Stripe checkout created (stays open unpaid); owner↔professional messaging idempotent; cross-role access 403 both ways');
  }

  // --- 12. Prepaid visits draw down instead of re-invoicing (R-2/R-3) -------
  // The founder's report: completing a walk the client had already paid for
  // still prompted to invoice them. This asserts the money behaviour in both
  // directions — a prepaid walk bills NOTHING, and the walk past the end of
  // the package bills again — because getting either half wrong is a
  // charge to a real client.
  {
    const prepaidClient = (
      await ok('POST', '/api/clients', { full_name: `Prepaid ${stamp}` }, '12. Client')
    ).data;
    const prepaidService = (
      await ok('POST', '/api/services', {
        client_id: prepaidClient.id,
        service_type: 'private_walk',
        price_cents: 3000,
        billing_cadence: 'per_visit',
        duration_minutes: 30,
        status: 'active',
      }, '12. Service')
    ).data;

    const pkg = (
      await ok('POST', '/api/invoices', {
        client_id: prepaidClient.id,
        amount_cents: 6000,
        description: '2-walk package',
        service_id: prepaidService.id,
        sessions_purchased: 2,
      }, '12. Package invoice')
    ).data;

    // An UNPAID package must credit nothing, or a client could walk for free
    // simply by never paying.
    const unpaid = (await ok('GET', `/api/services?client_id=${prepaidClient.id}`, undefined, '12. Unpaid balance')).data;
    assert(
      unpaid[0].session_balance === null,
      '12. Unpaid package',
      `An unpaid package must credit no visits; got ${JSON.stringify(unpaid[0].session_balance)}`
    );

    const { supabaseAdmin } = await import('../src/config/supabase');
    await supabaseAdmin
      .from('invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', pkg.id);

    const paidBalance = (await ok('GET', `/api/services?client_id=${prepaidClient.id}`, undefined, '12. Paid balance')).data;
    assert(
      paidBalance[0].session_balance?.remaining === 2,
      '12. Paid package',
      `Paid package should leave 2 visits; got ${JSON.stringify(paidBalance[0].session_balance)}`
    );

    const billed: (number | null)[] = [];
    for (let i = 0; i < 3; i++) {
      const booked = (
        await ok('POST', '/api/appointments', {
          client_id: prepaidClient.id,
          service_id: prepaidService.id,
          starts_at: new Date(Date.now() + (i + 1) * 26 * 3600e3).toISOString(),
          duration_minutes: 30,
        }, `12. Book ${i + 1}`)
      ).data;
      const appt = Array.isArray(booked) ? booked[0] : booked;
      const done = (await ok('POST', `/api/appointments/${appt.id}/complete`, {}, `12. Complete ${i + 1}`)).data;
      billed.push(done.invoice ? done.invoice.amount_cents : null);
    }
    assert(
      billed[0] === null && billed[1] === null,
      '12. Prepaid drawdown',
      `The two prepaid walks must bill nothing; billed ${JSON.stringify(billed)}`
    );
    assert(
      billed[2] === 3000,
      '12. Post-package billing',
      `The walk after the package runs out must bill $30 again; billed ${JSON.stringify(billed)}`
    );

    const finalInvoices = (await ok('GET', `/api/invoices?client_id=${prepaidClient.id}`, undefined, '12. Invoices')).data;
    assert(
      finalInvoices.length === 2,
      '12. Invoice count',
      `Expected exactly 2 invoices (the package + the one walk past it); got ${finalInvoices.length}`
    );

    pass('12. Prepaid visits: unpaid package credits nothing, paid package draws down (2 walks billed $0), the walk past it bills $30 again — exactly 2 invoices');
  }

  // --- 13. Contract term + renewal notices (R-10/R-11/R-16) ----------------
  // The failure modes here are both bad: never warning (the walker loses the
  // client) and warning wrongly (the client is told their agreement is
  // expiring when it isn't). This asserts the window in both directions, the
  // no-duplicate rule, and that the term is editable while the DOCUMENT
  // stays immutable — which is the whole hard constraint.
  {
    const ymd = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
    const termClient = (
      await ok('POST', '/api/clients', { full_name: `Term ${stamp}`, email: `term${stamp}@example.com` }, '13. Client')
    ).data;
    const templates = (await ok('GET', '/api/contract-templates', undefined, '13. Templates')).data;

    const signContract = async (endDate: string | null, label: string) => {
      const gen = (
        await ok('POST', '/api/contracts', {
          template_id: templates[0].id,
          client_id: termClient.id,
          end_date: endDate,
          renewal_notice_days: 30,
          variables: { walk_type: 'Private walk', service_price: '$30.00', schedule: 'Weekdays' },
        }, `13. Generate ${label}`)
      ).data;
      const contract = gen.contract ?? gen;
      await ok('POST', `/api/contracts/${contract.id}/sign`, {
        signer_name: 'Term Client',
        signature_image:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      }, `13. Sign ${label}`);
      return contract;
    };

    const expiring = await signContract(ymd(10), 'expiring');
    const farOff = await signContract(ymd(200), 'far-off');

    const { queueDueRenewalNotices } = await import('../src/services/NotificationService');
    const { supabaseAdmin } = await import('../src/config/supabase');
    await queueDueRenewalNotices();

    const renewalTemplatesFor = async (contractId: string) => {
      const { data } = await supabaseAdmin
        .from('notification_queue')
        .select('payload')
        .contains('payload', { contract_id: contractId });
      return (data ?? [])
        .map((r: any) => r.payload.template as string)
        .filter((t) => t.startsWith('contract_renewal'))
        .sort();
    };

    const expiringQueued = await renewalTemplatesFor(expiring.id);
    assert(
      expiringQueued.length === 2,
      '13. Renewal queued',
      `An agreement ending in 10 days (30-day notice) should warn BOTH parties; queued ${JSON.stringify(expiringQueued)}`
    );
    const farQueued = await renewalTemplatesFor(farOff.id);
    assert(
      farQueued.length === 0,
      '13. Renewal window',
      `An agreement ending in 200 days must not warn yet; queued ${JSON.stringify(farQueued)}`
    );

    // Re-running must not re-queue — the queue itself is the "already sent"
    // record, so a host that reboots often can't spam a client.
    await queueDueRenewalNotices();
    const afterSecondPass = await renewalTemplatesFor(expiring.id);
    assert(
      afterSecondPass.length === 2,
      '13. Renewal idempotency',
      `A second pass must not re-queue; now ${JSON.stringify(afterSecondPass)}`
    );

    // The term is editable on a SIGNED agreement; the document is not.
    const extended = await ok('PATCH', `/api/contracts/${expiring.id}`, { end_date: ymd(300) }, '13. Extend term');
    assert(
      extended.data.end_date === ymd(300),
      '13. Term editable',
      `Extending a signed agreement's term should succeed; got ${extended.data.end_date}`
    );
    const tamper = await api('PATCH', `/api/contracts/${expiring.id}`, { generated_html: '<p>tampered</p>' });
    assert(
      tamper.status === 409,
      '13. Document still immutable',
      `Editing a signed contract's HTML must still 409; got ${tamper.status}`
    );

    pass('13. Contract term: renewal warns both parties inside the window, stays silent outside it, never double-queues; term editable once signed while the document still 409s');
  }

  // --- 14. Sending an invoice to an absent owner (R-17) --------------------
  // Founder finding during the Week 5 test-card run: with the owner not
  // present, there was no way to get them the invoice at all. This asserts
  // the send, and then probes the new PUBLIC pay surface for over-reach —
  // a login-free endpoint is worth testing like one.
  {
    const payClient = (
      await ok('POST', '/api/clients', { full_name: `Absent ${stamp}`, email: `absent${stamp}@example.com` }, '14. Client')
    ).data;
    const payInvoice = (
      await ok('POST', '/api/invoices', {
        client_id: payClient.id, amount_cents: 9000, description: 'August walks',
      }, '14. Invoice')
    ).data;
    assert(
      payInvoice.pay_token === null && payInvoice.sent_at === null,
      '14. Unsent invoice',
      'A freshly created invoice must have no pay link and no sent_at — sending is explicit (D7)'
    );

    const sent = (await ok('POST', `/api/invoices/${payInvoice.id}/send`, {}, '14. Send')).data;
    assert(
      typeof sent.pay_token === 'string' && sent.pay_token.length >= 40 && !!sent.sent_at,
      '14. Send',
      `Sending should mint a high-entropy pay token and stamp sent_at; got token=${sent.pay_token}, sent_at=${sent.sent_at}`
    );

    // Re-sending must REUSE the token, or a link already sitting in the
    // client's inbox stops working the moment the walker chases them.
    const resent = (await ok('POST', `/api/invoices/${payInvoice.id}/send`, {}, '14. Resend')).data;
    assert(
      resent.pay_token === sent.pay_token,
      '14. Resend',
      'Re-sending must reuse the existing pay token, not mint a new one'
    );

    // The public surface, called with NO Authorization header.
    const publicRes = await fetch(`${baseUrl}/api/pay/${sent.pay_token}`);
    const publicJson = (await publicRes.json()) as any;
    assert(
      publicRes.status === 200 && publicJson.ok,
      '14. Public pay lookup',
      `The pay link must work without any login; got ${publicRes.status}`
    );
    const exposed = Object.keys(publicJson.data.invoice);
    assert(
      !exposed.includes('client_id') && !exposed.includes('professional_account_id') && !exposed.includes('pay_token'),
      '14. Pay link scope',
      `The pay link must not expose the client, the professional, or its own token; got ${exposed.join(', ')}`
    );

    // The token is NOT a general-purpose key.
    const wrongDoor = await fetch(`${baseUrl}/api/clients`, {
      headers: { Authorization: `Bearer ${sent.pay_token}` },
    });
    assert(
      wrongDoor.status === 401,
      '14. Pay token is not a session',
      `A pay token used as a bearer token must be rejected; got ${wrongDoor.status}`
    );

    const bogus = await fetch(`${baseUrl}/api/pay/notarealtokenatallnotarealtoken1234`);
    assert(bogus.status === 404, '14. Bogus token', `An unknown token must 404; got ${bogus.status}`);

    // A client with no email can't be sent to — refuse clearly rather than
    // half-sending and leaving the walker thinking it went out.
    const noEmail = (await ok('POST', '/api/clients', { full_name: `NoEmail ${stamp}` }, '14. Client 2')).data;
    const noEmailInvoice = (
      await ok('POST', '/api/invoices', { client_id: noEmail.id, amount_cents: 1000, description: 'Walk' }, '14. Invoice 2')
    ).data;
    const refused = await api('POST', `/api/invoices/${noEmailInvoice.id}/send`, {});
    assert(
      refused.status === 422,
      '14. No email',
      `Sending to a client with no email must 422 with a clear message; got ${refused.status}`
    );

    pass('14. Invoice sending: explicit send mints a scoped pay token (resend reuses it), the public pay link works with no login and exposes nothing beyond that one invoice, the token is not a session, and a client with no email is refused');
  }

  console.log(`\n\x1b[32m${passed} steps passed — E2E TEST PASSED against ${baseUrl}\x1b[0m`);
}

main().catch((err) => fail('Unexpected error', err));
