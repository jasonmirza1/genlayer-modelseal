# ModelSeal v2

Public dashboard: https://modelseal.vercel.app

ModelSeal compares observable AI endpoint behavior against an operator-declared baseline using GenLayer comparative consensus. It cannot prove hidden model weights or exclude a proxy. Version 2 replaces the earlier simulated UI and unverified evidence-packet design.

## Actual audit path

1. An owner registers a public HTTPS challenge endpoint, claimed model, immutable GitHub suite and baseline URLs, and SHA-256 of the baseline file's exact bytes.
2. Each validator fetches both files. Code checks the baseline hash and the suite hash embedded in the baseline, complete probe coverage, schema and byte limits.
3. Each validator POSTs 1–4 challenges directly to the registered endpoint, with the supplied fresh nonce and probe ID.
4. Code checks HTTP status, JSON types, byte/output limits and exact nonce/probe binding. An LLM compares each output with the baseline and rubric. Incomplete comparisons become INCONCLUSIVE.
5. Comparative consensus requires matching classifications, probe verdicts, suite hash and baseline verification, plus materially equivalent observations. A receipt stores the outputs, response hashes, file locks, nonce and reasons.
6. The finalized receipt consumes the nonce for that profile, including an INCONCLUSIVE result. Reuse is rejected before HTTP calls. An aborted transaction does not produce a receipt; consult the explorer before retrying.

The dashboard uses genlayer-js 1.1.8 with the actual selected wallet provider. Reads use `LATEST_FINAL`; writes require wallet confirmation. It preserves the submitted transaction hash locally and exposes explicit status checks. ACCEPTED and FINALIZED are separate from the audit's result and the transaction's execution outcome. No background retry or sample analytics are generated.

## Endpoint protocol

Accept `POST` with `Content-Type: application/json`:

```json
{"schema":"modelseal.challenge.v2","nonce":"<32–64 lowercase hex characters>","probe_id":"idempotency","prompt":"Explain safe payment retries."}
```

Return HTTP 200 JSON:

```json
{"nonce":"<exact request nonce>","probe_id":"idempotency","output":"Your model's actual answer"}
```

An endpoint owner can implement this adapter in front of their model. Credentials stay at the owner's adapter; validators need public access. Do not pass secrets in prompts. Non-200 responses, redirects exposed as non-200, invalid envelopes, wrong nonces and malformed comparisons yield INCONCLUSIVE. Public DNS/egress security remains the responsibility of the GenLayer web runtime; URL checks do not resolve DNS or prove a hostname remains public.

## Reproducible fixtures

These are deliberately programmed test fixtures, **not AI models or external validation evidence**:

- `https://modelseal.vercel.app/api/fixture/baseline` returns the baseline answers.
- `https://modelseal.vercel.app/api/fixture/drift` returns deliberately contradictory answers.
- `https://modelseal.vercel.app/api/fixture/invalid` returns an incorrect nonce.

The executable suite is `probe-suites/v2.json`; its matching reference is `examples/baseline-v2.json`. Obtain commit-pinned links and the baseline byte hash with `node scripts/review-links.mjs` after committing. Register each fixture as a separate profile, then submit audits from the browser. Expected outcomes are CONSISTENT, DRIFT_DETECTED and INCONCLUSIVE respectively; semantic outcomes still depend on actual network consensus. Fixture runs must be identified as such in a submission.

## Deployment and use

1. Deploy the corrected `contracts/modelseal.py` as a **new** Bradbury instance in Studio. Its constructor takes no arguments. The v2 API/storage is incompatible with v1; do not overwrite a v1 instance.
2. Wait for finalization and inspect execution success. Enter its address in the dashboard's contract field. `get_counts` must return version `2`.
3. Connect OKX or an injected EVM wallet, switch to Bradbury, and register a profile with the pinned files and digest.
4. Check the submitted transaction in the explorer. Refresh finalized state after finalization, select the profile and submit an audit.
5. Refresh finalized receipts, open a receipt and download its actual evidence JSON.

No Bradbury v2 deployment address has been fabricated or preconfigured. Local storage remembers the contract and pending transaction for this browser/account. For a shared default address, set `NEXT_PUBLIC_MODELSEAL_ADDRESS` on Vercel and redeploy after the contract is verified.

## Development and checks

```sh
npm ci
npm run build
python -B -m pytest -q tests
python -X utf8 -m genvm_linter.cli check contracts/modelseal.py
npx playwright install chromium
npx playwright test
```

Python tests require `genlayer-test`/gltest and genvm-linter. Runtime tests execute against the locally installed GenVM SDK with mocked HTTP and LLM boundaries; they do not prove distributed Bradbury settlement. Browser tests use a mocked wallet. The app can be run with `npm run dev` or deployed with `npx vercel --prod`.

## Limits

Each contract has a 10,000 profile/receipt cap, each page returns at most 20 records, and suites contain up to four probes. Endpoint answers are bounded to 2,000 characters each. Results measure consistency against a supplied baseline, not universal quality, safety, identity or a probability score. Public probes can be recognized or spoofed; changing sampling/system prompts can affect outcomes. Prompt instructions reduce injection risk but do not prove immunity. DNS rebinding/redirect restrictions depend on runtime enforcement. On-chain evidence is public.
