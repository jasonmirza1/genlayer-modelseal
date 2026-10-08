# Proposed ModelSeal milestone v1: Audit Gate

Status: reviewed; publication approved; deployment verification pending; not submitted.
Work started October 8, 2026. Milestone eligibility and points remain a steward
decision; the accepted project is not being resubmitted.

## Accepted baseline and attribution

The user supplied Portal evidence that ModelSeal was accepted as an Agent Tank
project with 2,500 GLP and published in Project Explorer. The accepted flow already
had endpoint registration, nonce-bound comparative consensus, immutable GitHub
evidence, finalized receipts and a dashboard.

The previously demonstrated deployment was
`0xA861e33d618E0B28429872f1743021dae57548b8`. The user showed receipt #1 for
endpoint #1, classified CONSISTENT, and accepted audit transaction:

https://explorer-studio-dev.genlayer.com/tx/0x8469d0f6b1efc3ddc104ca0995d74b9b563e2fd15c0b4308060808c434b1bd1a

That earlier transaction is baseline evidence, **not** a new milestone transaction.
The finalized deployment was re-read successfully on October 8, 2026; availability
must still be rechecked before submission because Studio Next is a preview network.

At the start of this work, local HEAD was `7127ce6`, with substantial earlier
uncommitted fixes already present. A fresh GitHub fetch showed public `origin/main`
at `353cc74e71ff79fafa814dd364749646a611665a`. Therefore a future GitHub diff may
contain earlier v2 corrections too. Those corrections are committed separately
before the Audit Gate feature. Do not label them as newly built for this
milestone. This ledger isolates the new consumer feature.

## New delta

| Accepted capability | New milestone capability |
| --- | --- |
| Humans inspect receipts in the dashboard | Other apps consume a scoped read-only JSON policy |
| Global ascending receipt pages | Bounded newest-first per-profile sequence evaluation |
| Receipt classification | Fail-closed pinned endpoint/baseline policy, optional suite pin |
| Individual audit result | 1–5 consecutive newest consistent receipts, no cherry-picking |
| Manual receipt download | Policy report with selected receipts, scope and limitations |
| Wallet needed for audit writes | Walletless policy checks and backend/CI consumer example |

New implementation files:

- `lib/assurance.ts` — policy validation, bounded finalized reader, evidence
  invariants, HTTP response adapter and consumer report validator.
- `app/api/assurance/route.ts` — read-only finalized-state API.
- `components/assurance-console.tsx` — dashboard policy interface.
- `scripts/check-assurance.mjs` — fail-closed CLI/backend integration example.
- `tests/assurance.test.mjs` and `tests/browser/assurance.spec.ts` — negative
  cases, scoped output and interface regression coverage.
- `docs/audit-gate.md` and this ledger — integration and exact delta.
- Small `app/page.tsx` wiring for the new Audit Gate tab.

The milestone does not change `contracts/modelseal.py`, the consensus mechanism
or wallet transaction/recovery implementation. It reuses real finalized v2
receipts rather than creating another deployment or fee round.

## Why it matters

ModelSeal's consensus output becomes a reusable input for an endpoint router,
agent backend or CI policy instead of remaining a one-off dashboard verdict.
Newer failures, malformed evidence, policy mismatches and uncertain reads block
access. The integration remains honest about what historical behavioral
consistency cannot establish: model identity, safety, availability or freshness.

## Verification on October 8, 2026

- 105 Python tests passed: 95 contract unit tests and 10 direct GenVM integration
  tests. GenVM fixtures use mocked web/model evidence; they are not chain writes.
- 103 Node tests passed, including 82 new policy/HTTP/report/CLI tests and the
  21 existing outcome and wallet transaction-safety tests.
- All 19 Chromium tests passed: 11 new gate tests and 8 existing wallet/browser
  regressions. Desktop and mobile gate captures were also visually inspected.
- Production build, TypeScript, application lint and GenVM contract lint/validation
  passed. The local HTTP CLI test requires loopback networking; it passed outside
  the restricted execution sandbox.
- Contract, chain adapter, wallet recovery and existing wallet browser-test file
  hashes stayed unchanged from the start of this milestone work.
- Review corrections align the receipt-size limit with the contract's six-field
  Python JSON payload and give browser reads a 15-second deadline through body
  parsing, with safe retry and late-result isolation. Regression tests reproduced
  both defects before correction. Six mocked checks against the actual Python
  contract validator confirmed gate parity, including exactly 24,000 characters,
  rejection at 24,001 and Unicode escaping. These checks were not chain writes.
- Nonblank text validation now matches Python's whitespace rules and retains
  original evidence strings. Six additional regression tests cover all 29 Python
  whitespace code points, BOM-only nonblank text, tampered positive reports and
  Unicode field-length boundaries. Four tests reproduced the mismatch before the
  fix. Another 1,200 mocked comparisons against the actual Python contract
  validator matched the gate, including whitespace, BOM, astral characters and
  length limits. These are local validator checks, not live consensus rounds.
- A further independent 3,000 deterministic history scenarios matched the
  newest-consecutive policy and passed scope-bound report validation.

Read-only live checks of the existing contract returned finalized counts
`profiles=1, receipts=1, version=2`. The scope-bound report validator accepted both
the passing and blocking reports:

| Check | Result |
| --- | --- |
| Trusted endpoint/baseline, minimum 1 | ALLOW · HISTORY_MATCHED · receipt #1 |
| Same pins, minimum 2 | BLOCK · INSUFFICIENT_HISTORY · receipt #1 |

The complete local production API plus CLI path was checked at
`2026-10-08T08:59:33.611Z` (minimum 1, exit 0) and
`2026-10-08T08:59:39.455Z` (minimum 2, expected exit 1).
This used real finalized RPC reads, without endpoint re-probing, signatures or
wallet transactions. It is not a new deployment or an audit-freshness claim.
The temporary local test server was stopped afterward.

## Before submitting

1. Review the local feature and tests, keeping earlier v2 corrections separately
   identified in the GitHub history/delta.
2. Publish the approved code and deploy the frontend/API only after authorization.
3. Recheck the current trusted contract's finalized state without signing anything.
4. Demonstrate a real read-only policy check; if only one receipt exists, require
   two and show INSUFFICIENT_HISTORY. A deliberately wrong baseline pin can show
   POLICY_MISMATCH without an extra wallet transaction.
5. Record a silent normal screen recording if a video is used. Do not present
   mocked drift/outage tests as live chain evidence.
6. Attach repository/diff, deployed app/API, integration documentation, report and
   any new demo video separately. Do not reuse the old video as proof of this feature.
7. Fill the Portal milestone for the published ModelSeal project. The user reviews
   and submits manually.

Do not say this feature is live until deployment is verified. Portal submission
remains manual and no reward amount is promised.
