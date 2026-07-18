/**
 * Structural contract check (T-2).
 *
 * The professional app (public/app.js) and the pet-owner portal
 * (public/portal.js) are independent frontends that share one styles.css.
 * A handful of CSS declarations are load-bearing: remove them and a screen
 * breaks silently — no error, no console warning, nothing visibly wrong
 * until someone tries to use it.
 *
 * That is not hypothetical. F-8 (2026-07-18) moved the contract pane's
 * height onto a new wrapper and updated only app.js; the portal's contract
 * viewer collapsed from 440px to 150px, shipped, and reached real testers
 * before anyone noticed.
 *
 * This script is the guard. It runs as part of `npm test` and standalone as
 * `npm run check:structure`. It is deliberately readable: when it fails, the
 * message has to make sense to whoever just edited the CSS — including a
 * designer who has never opened this repo.
 *
 * Adding a contract: add an entry to CONTRACTS below. Keep `why` concrete —
 * it is the whole point of the failure message.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const CSS = 'public/styles.css';
const APP = 'public/app.js';
const PORTAL = 'public/portal.js';
const SHARED = 'public/shared.js';

/**
 * hook      — the data-* attribute, in both the CSS selector and the markup
 * props     — declarations that must survive in the CSS rule for that hook
 * markup    — files whose markup must carry the hook
 * why       — what actually breaks, in plain language
 */
const CONTRACTS = [
  {
    hook: 'data-doc-shell',
    props: ['height'],
    markup: [SHARED],
    why: 'The contract viewer needs a definite height. Without one the iframe inside falls back to its ~150px intrinsic default and the contract becomes unreadable. (This is the exact bug that shipped to testers in d8259b9.)',
  },
  {
    hook: 'data-doc-frame',
    props: ['transform-origin', 'height'],
    markup: [SHARED],
    why: 'The zoom controls scale this element. Without transform-origin: 0 0 the document scales from its centre and drifts out of the frame.',
  },
  {
    hook: 'data-sigpad',
    props: ['touch-action', 'display'],
    markup: [SHARED],
    why: 'touch-action: none is what lets a finger draw. Without it the browser treats the drag as a page scroll and signing is impossible on phones and tablets — the devices clients actually sign on.',
  },
];

/* T-3 moved the sign screen into shared.js, so the two frontends can no
   longer disagree about it — the divergence check below has nothing left to
   compare. What replaces it is a load-order check: shared.js defines
   window.PetPro, and both pages read it at startup, so a page that loads its
   own script first (or drops shared.js entirely) throws on first render.
   Cheap to verify statically, and the failure is otherwise a blank screen. */
const LOAD_ORDER = [
  { page: 'public/index.html', script: 'app.js' },
  { page: 'public/portal.html', script: 'portal.js' },
];

/** Pull the declaration body for `[hook] { ... }` out of the stylesheet. */
function ruleBody(css, hook) {
  const m = css.match(new RegExp(`\\[${hook}\\]\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

/** A declaration counts only if it has a real value — `height: auto` is a lie. */
function hasProp(body, prop) {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'));
  if (!m) return false;
  const value = m[1].trim().toLowerCase();
  return value !== '' && value !== 'auto' && value !== 'initial' && value !== 'unset' && value !== '0';
}

const css = read(CSS);
const sources = new Map([APP, PORTAL, SHARED].map((f) => [f, read(f)]));
const failures = [];

for (const c of CONTRACTS) {
  const body = ruleBody(css, c.hook);
  if (body === null) {
    failures.push({
      contract: c,
      problem: `${CSS} has no rule for [${c.hook}] — the whole contract is gone.`,
    });
  } else {
    const missing = c.props.filter((p) => !hasProp(body, p));
    if (missing.length) {
      failures.push({
        contract: c,
        problem: `[${c.hook}] in ${CSS} is missing a required declaration: ${missing.join(', ')}.`,
      });
    }
  }

  for (const file of c.markup) {
    if (!sources.get(file).includes(c.hook)) {
      failures.push({
        contract: c,
        problem: `${file} no longer carries the ${c.hook} attribute, so the CSS contract cannot apply to it.`,
      });
    }
  }
}

// Load order: shared.js defines window.PetPro and both frontends read it at
// startup, so it must be the first of the two script tags on each page.
for (const { page, script } of LOAD_ORDER) {
  const html = read(page);
  const sharedAt = html.indexOf('/shared.js');
  const ownAt = html.indexOf(`/${script}`);
  if (sharedAt === -1) {
    failures.push({
      contract: { why: `${script} calls window.PetPro at startup; without shared.js the page throws on first render and shows a blank screen.` },
      problem: `${page} does not load /shared.js.`,
    });
  } else if (ownAt !== -1 && sharedAt > ownAt) {
    failures.push({
      contract: { why: `${script} reads window.PetPro at startup, so shared.js must execute first. Both tags are deferred, which preserves document order.` },
      problem: `${page} loads /${script} before /shared.js.`,
    });
  }
}

// Divergence check: kept for any contract still rendered per-frontend. After
// T-3 the sign screen lives in shared.js, so this has nothing to compare —
// it stays because the next shared contract may not start out shared.
for (const c of CONTRACTS) {
  const present = c.markup.filter((f) => sources.get(f).includes(c.hook));
  if (present.length > 0 && present.length < c.markup.length) {
    const absent = c.markup.filter((f) => !present.includes(f));
    failures.push({
      contract: c,
      problem: `${c.hook} exists in ${present.join(', ')} but not in ${absent.join(', ')} — the two frontends have diverged. This is how the F-8 portal regression happened.`,
    });
  }
}

if (failures.length === 0) {
  console.log(`\x1b[32m[PASS]\x1b[0m structural contracts intact (${CONTRACTS.length} checked across app + portal)`);
  process.exit(0);
}

console.error(`\n\x1b[31mSTRUCTURAL CONTRACT BROKEN — ${failures.length} problem(s)\x1b[0m\n`);
console.error('Something load-bearing was removed. The app will not throw an error;');
console.error('the affected screen will just quietly stop working.\n');
for (const f of failures) {
  console.error(`  \x1b[31m✗\x1b[0m ${f.problem}`);
  console.error(`    What breaks: ${f.contract.why}`);
  console.error(`    Fix: restore the declaration(s) in the STRUCTURAL CONTRACT block at the top of ${CSS},`);
  console.error(`         or talk to engineering if the redesign genuinely needs a different approach.\n`);
}
process.exit(1);
