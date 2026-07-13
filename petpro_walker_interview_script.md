# PetPro Connect — Walker Interview Script

**Format:** 30 minutes, one-on-one, video call or in person with the prototype on your screen/phone.
**Who:** 5–10 working dog walkers. Aim for a mix: solo walkers with under 10 clients, established solo walkers (15–30 clients), and at least one small team (2+ walkers) for the Business-tier questions.
**Goal:** Test three bets before writing production code:

1. **The Professional-tier bet** — will walkers pay monthly for GPS tracking + report cards + e-signing?
2. **The free-cap bet** — is 10 active clients the right wall between Free and Professional?
3. **The workflow bet** — does the walk loop (contract → schedule → walk → report card → invoice) match how they actually work?

**The one rule:** you are not selling. Every time you explain, defend, or pitch, you contaminate the data. Ask, demo, shut up, and write down what they say — especially the parts you don't like.

---

## Before the session (2 min prep)

* Open the prototype and reset it (refresh — seeded data returns).
* Have your note grid ready (bottom of this doc).
* Confirm recording consent if recording.

---

## Part 1 — Their world today (8 min)

Do not show the prototype yet. You're mapping their current workflow and pain so you can compare their words against your feature list.

1. "Walk me through yesterday. From the first dog to the last — what did you use to manage it?"
   *Listen for: paper, texts, spreadsheets, Time To Pet, Scout, PocketSuite, Venmo requests.*
2. "How does a brand-new client go from 'found you' to 'first walk'? What's the paperwork?"
   *Listen for: whether contracts exist at all, how they're signed, how long onboarding takes.*
3. "How do you get paid, and how often do you chase a payment?"
4. "What do owners ask you for the most?"
   *You're hoping to hear photo updates / 'how was the walk' unprompted. If they say it before you show report cards, mark it — that's strong signal.*
5. "What's the most annoying part of the business side — not the dogs, the business?"

**Red flag to note:** if they describe their current setup as "fine, honestly" with no energy, they may not be a buyer no matter how good the demo is.

---

## Part 2 — Prototype demo, think-aloud (12 min)

Hand them the prototype (or share screen and give them control). Say exactly this:

> "This is an early prototype — nothing you say can hurt my feelings, and confusion is the most useful thing you can give me. Please think out loud as you go."

Then give tasks, not a tour. **Do not narrate. Do not rescue them for at least 10 seconds when they're stuck.** Where they get stuck IS the finding.

**Task 1 — Onboarding:** "Priya is a new client whose contract isn't signed. Find her and get her set up so you can start walking Pickles."
*Watch: do they find the pending-contract cue on the Today screen or hunt through Clients? Does 'sign & activate' make sense? After: "How does this compare to how you onboard someone today?"*

**Task 2 — The walk loop:** "It's 10 AM. Take Zeus on his walk — do whatever you'd naturally do during and after."
*Watch: do they find Start walk? Do they snap photos unprompted? At the report card: pause and ask, "What would your clients say if they got this?" — this is the money question for the Professional tier. Note their exact words.*

**Task 3 — Getting paid:** "Maya owes you for last week. Handle it."

**Task 4 — Owner's view (verbal, not in prototype):** "While you're walking Zeus, his owner can open a link and watch the walk live on a map. When you hit a dead zone in the park, they see 'low-signal area — tracking continues' instead of a frozen dot, and the route fills in after. Gut reaction?"
*Listen for: 'my clients would love that' vs. 'that feels like surveillance of ME.' Walker discomfort with being watched is a real adoption risk — note it verbatim.*

Wrap: "If you had this today, what's missing before you'd actually switch?" *Their first answer is your real backlog.*

---

## Part 3 — Money (7 min)

Order matters: value first, then price, then the free cap.

1. "Of everything you just saw, what single thing is most valuable to you?" *(Write it down before moving on.)*
2. "What do you currently pay for software, if anything?"
3. Van Westendorp, shortened — ask all four, in this order, about the full app with GPS + report cards + e-sign + auto-invoicing:
   * "At what monthly price would this feel so cheap you'd doubt the quality?"
   * "At what price does it feel like a good deal?"
   * "At what price does it start feeling expensive, but you'd still consider it?"
   * "At what price is it simply too expensive?"
4. The free-cap probe — don't name our cap; find theirs: "Imagine a free version for walkers just starting out. It's limited by number of active clients. At how many clients would that limit start to pinch you into paying?"
   *If several established walkers say 12–15, our 10 is right. If they say 5–6, we're giving away too much.*
5. Teams only: "Would you pay a higher tier to see your employees' schedules, walk routes, and client messages in one place? What's that worth per month?"

**Do not** reveal your planned prices in the session, even if asked. "We're deciding that based on these conversations" is the honest answer.

---

## Part 4 — Close (3 min)

1. "On a scale of 1–10, how disappointed would you be if this product never launched?" *(A 'very disappointed' from 40%+ of interviews is the classic product-market-fit signal.)*
2. "Who's the best walker you know that I should talk to?" *(Recruits your next interviews.)*
3. "Can I come back to you when there's a beta?" *(Yes = your pilot waitlist. Get contact info.)*

---

## Note grid (one per interview)

| Field | Entry |
|---|---|
| Name / business / # clients / solo or team | |
| Current tools | |
| Onboarding today (contract? signed how?) | |
| Task 1 — stuck points, quotes | |
| Task 2 — reaction to report card (verbatim) | |
| Task 3 — stuck points | |
| Live-view reaction (delight vs. surveillance) | |
| Most valuable single feature | |
| Van Westendorp: cheap / deal / expensive / too much | |
| Free-cap pinch point (# clients) | |
| Disappointment score (1–10) | |
| "What's missing before you'd switch" | |
| Referral + beta consent | |

---

## After 5+ interviews — decision rules

* **Professional tier validated** if: report cards or GPS live view is the top-value pick for most walkers, AND the median "good deal" price supports your cost structure.
* **Free cap:** set it just below the median pinch point.
* **Kill/repair signal:** if walkers consistently rank auto-invoicing or scheduling above GPS, the tier paywall is on the wrong feature — move GPS down and gate invoicing instead. Cheaper to learn this now than after launch.
* **Surveillance signal:** if 2+ walkers bristle at owner live view, add a walker-controlled "share live location" toggle per walk to the spec before build.
