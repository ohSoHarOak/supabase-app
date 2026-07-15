/**
 * PetPro Connect — end-to-end API test, runnable from any command line.
 *
 * Usage (local):    npm test
 * Usage (Render):   npm test -- --base-url https://petpro-app.onrender.com
 *
 * Drives the whole loop the app supports so far in one command:
 * auth → clients/pets → contract generate/sign/immutability → billing →
 * scheduling (recurrence, conflicts, complete → auto-invoice) → event log.
 *
 * Everything here is fully automated — no browser, no Stripe Checkout step.
 * (Paying an invoice with the test card stays in week5-test.ps1, since only
 * a human can complete Stripe's hosted payment page.)
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

async function api(method: string, path: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
async function ok(method: string, path: string, body: unknown, step: string): Promise<ApiResult> {
  const result = await api(method, path, body);
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
      email: 'e2e.client@example.com',
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
    pass('2. Client + 2 pets + search by pet name');
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
    pass('5. Service + 4-week series booked; double-booking blocked with readable 409');
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

  console.log(`\n\x1b[32m${passed} steps passed — E2E TEST PASSED against ${baseUrl}\x1b[0m`);
}

main().catch((err) => fail('Unexpected error', err));
