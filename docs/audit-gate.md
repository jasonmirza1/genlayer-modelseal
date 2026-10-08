# Audit Gate: finalized evidence policies for endpoint consumers

Audit Gate turns ModelSeal v2 receipts into a reusable, read-only consumer
decision. An agent backend or endpoint router can require the newest **N
consecutive** finalized audits to be consistent with its chosen endpoint and
baseline. It is not a new audit, an access-control contract, or a certification.

The feature is published at [modelseal.vercel.app](https://modelseal.vercel.app).
Production read-only checks were verified on October 8, 2026.
The existing v2 contract does not change and does not need redeployment.

For the existing programmed fixture, [minimum 1](https://modelseal.vercel.app/api/assurance?contract=0xA861e33d618E0B28429872f1743021dae57548b8&profile=1&endpoint=https%3A%2F%2Fgenlayer-modelseal.vercel.app%2Fapi%2Ffixture%2Fbaseline&baseline=389d1aaedc8b9a18d660b30a7e87b2ce05ffe97bca7d483a19eb19c6f8115e9f&min=1)
returned ALLOW / HISTORY_MATCHED, while [minimum 2](https://modelseal.vercel.app/api/assurance?contract=0xA861e33d618E0B28429872f1743021dae57548b8&profile=1&endpoint=https%3A%2F%2Fgenlayer-modelseal.vercel.app%2Fapi%2Ffixture%2Fbaseline&baseline=389d1aaedc8b9a18d660b30a7e87b2ce05ffe97bca7d483a19eb19c6f8115e9f&min=2)
returned BLOCK / INSUFFICIENT_HISTORY. These URLs re-evaluate current finalized
state; they are not immutable proofs or claims about a real AI provider.

## What is checked

1. The consumer supplies a trusted contract address, profile ID, exact endpoint
   URL and baseline SHA-256. A suite SHA-256 pin is optional.
2. Read `get_counts` and `get_profile` using `LATEST_FINAL`.
3. Search global receipt pages backward, with at most 100 rows inspected.
   Validate each page's exact coverage and ascending IDs before walking it newest-first.
4. For the target profile, validate endpoint/file/digest bindings, nonce shape,
   verified-baseline flag, suite hash, complete unique observation/probe coverage,
   output/reason limits, and the aggregate classification.
5. Stop on a drift or inconclusive result in the required newest sequence.
   Never replace it with an older passing result. For multiple passing receipts,
   require different nonces and the same suite and probe set.
6. Re-read finalized counts and the profile. An observed change, missing evidence,
   malformed result, read failure or deadline expiry blocks authorization.

The 24,000-character consensus limit matches the contract's Python JSON encoding
(ASCII escapes and default separator spaces). It applies to the six-field
consensus payload, not the receipt metadata added afterward. Receipt bindings
retain their individual field limits.

Text validation uses Python's whitespace and Unicode code-point rules, including
NEXT LINE and U+001C-U+001F as whitespace, but not U+FEFF. Receipt evidence is
checked without trimming or otherwise normalizing the original strings.

The policy permits a newer passing sequence to recover after an older drift
**only** when it satisfies the consumer's chosen minimum. For example, with a
minimum of 2, newest results `MATCH, DRIFT, MATCH` block; `MATCH, MATCH, DRIFT`
can allow. These are newest-first examples, not a count of all historic passes.

## API

`GET /api/assurance` accepts only these parameters; unknown or repeated parameters
are rejected before any RPC access.

| Parameter | Requirement |
| --- | --- |
| `contract` | Nonzero 40-hex-digit address of the trusted deployed v2 contract |
| `profile` | Positive decimal profile ID, 1–10,000 |
| `endpoint` | Exact canonical public HTTPS URL stored in the trusted profile |
| `baseline` | Lowercase SHA-256 of the consumer's trusted baseline file |
| `min` | 1–5 consecutive consistent receipts, default 1 |
| `suite` | Optional lowercase expected suite SHA-256 |

The request cannot supply an RPC, a wallet, an endpoint-fetch instruction, an
unbounded history size, or a write method. Reads use the application's configured
Studio Next RPC through `lib/chain.ts`, not a URL from the query.

`modelseal.assurance.v1` reports include the policy, decision/reason code,
finalized counts/profile, newest-first actual receipts, bounded search scope,
snapshot recheck, read time and explicit trust limitations. `auditTime` is always
`null` because v2 stores no audit timestamp.

All responses use `Cache-Control: private, no-store, max-age=0`. Valid policy
results, including `BLOCK`, return HTTP 200; read failures/timeouts or observed
state changes return HTTP 503 with a `BLOCK` report. Invalid requests return
HTTP 400. **HTTP 200 by itself never means ALLOW.**

Each evaluation has a 12-second deadline and at most five 20-row history pages,
plus two count/profile read pairs. The deadline stops authorization and additional
pages, but does not cancel an already-in-flight SDK transport request. Production
hosts should apply ordinary rate limiting; the public API is not an authenticated
or rate-limited service by itself.

## Dashboard

Load a trusted v2 contract, then open **Audit Gate**. Populate pins from a loaded
profile if desired, review those pins, choose a minimum and select **Check policy ·
no transaction**. No wallet connection is required.

Changing any pin or contract clears a prior result and aborts the browser request.
Late results cannot cross into the new scope. A failed check does not restore an
older ALLOW. Download the policy report or copy its API URL for an integration.
The browser has a 15-second timeout covering both the response and its JSON body.
Expiry aborts the request, keeps access blocked and re-enables retry even if a
transport ignores abort. Cancelled requests cannot overwrite a newer result.
The selector shows the loaded profile page; profiles outside that page can be
selected by entering their ID and trusted pins explicitly.

## Backend/CI integration

Use the library directly with your own finalized read adapter:

```ts
import { evaluateAssurance } from './lib/assurance';
import { read } from './lib/chain';

const policy = {
  contract: trustedContractAddress,
  profileId: trustedProfileId,
  expectedEndpoint: trustedEndpoint,
  expectedBaselineDigest: trustedBaselineDigest,
  minConsistentReceipts: 2,
};
const report = await evaluateAssurance(
  (method, args) => read(policy.contract, method, args),
  policy,
);
if (report.decision !== 'ALLOW') {
  throw new Error('Endpoint historical-consistency policy blocked: ' + report.code);
}
// Continue only with separate endpoint authorization, availability and security checks.
```

For the HTTP API, validate scope and evidence using `matchesAssuranceReport` and
require both an OK response and `report.decision === 'ALLOW'`. Trust your API host;
this validator checks structure and internal consistency, not RPC truth.

A ready-to-run CLI example accepts the API URL copied from Audit Gate:

```sh
node --experimental-strip-types scripts/check-assurance.mjs "<copied API URL>"
```

Node 22.13 or newer is required. Exit 0 means scoped ALLOW; BLOCK, unavailable
reads, malformed reports, redirects and mismatched scope exit 1. HTTPS is required
except for localhost development. Do not cache a positive report as a permanent
endpoint permission. The API is same-origin by default; use a backend integration
or host your own adapter rather than assuming cross-origin browser access.

## Trust boundary

- Choose the contract code, RPC, API host and baseline yourself. A registered
  operator can declare a weak or malicious baseline; filling pins from a profile
  does not make it trustworthy.
- The reader trusts finalized storage produced by the selected contract's
  consensus logic. It does not independently replay probes or verify a
  cryptographic storage proof.
- Separate `LATEST_FINAL` calls are not an atomic block-hash snapshot. Rechecks
  detect observed count/profile changes, not every possible malicious code rewrite
  or a change just after the check. Contract/RPC trust remains essential.
- `checkedAt` is the read time, not the audit time. There is no age/freshness policy
  in v1; an old matching receipt may still satisfy the historical policy.
- Response hashes describe the original challenge response envelope. That envelope
  is not stored in full; the gate validates hash shape and contract bindings, not
  an independent recomputation from output text.
- The programmed fixture is a protocol demonstration, not evidence about a real
  model's hidden weights. Public probes cannot exclude proxying or probe recognition.

## Verification

`tests/assurance.test.mjs` covers the deterministic policy, HTTP adapter and report
validation. `tests/browser/assurance.spec.ts` covers walletless checks, policy
invalidation, late responses, outage handling, downloads and mobile layout.
Browser/RPC fixtures are explicitly mocked; they are not claimed as new live
consensus transactions. Existing wallet recovery and contract tests remain separate.
