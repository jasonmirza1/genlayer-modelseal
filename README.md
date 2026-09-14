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

The dashboard uses `genlayer-js@2.0.0-rc.1` and Transaction Kit RC2 with the actual selected wallet provider. Reads use `LATEST_FINAL`; every write is quoted through the fee-aware review panel and requires wallet confirmation. It tracks through finalization and separates consensus status from execution success. No background retry or sample analytics are generated.

Fee reviews cannot replace an unresolved write. The wallet and chain are checked again before signing. A browser-local recovery record retains the action, wallet, contract and available transaction hashes through reloads and RPC failures. Use **Check recorded transaction** to re-read its outcome; only confirmed finalization with successful execution is reported as success. A missing hash is an unknown outcome, not permission to retry: inspect wallet activity and finalized state first. Recovery is local to this browser, not a global transaction index.

After consensus, deterministic checks reject unsupported success labels, missing/duplicate observations, malformed hashes, unverified baselines, contradictory per-probe verdicts and whitespace-only evidence. These checks complement semantic consensus; they do not independently prove the truth of an endpoint's responses.

## Endpoint protocol

Accept `POST` with `Content-Type: application/json`:

```json
{"schema":"modelseal.challenge.v2","nonce":"<16–32 bytes as an even number of lowercase hex characters>","probe_id":"idempotency","prompt":"Explain safe payment retries."}
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

1. Open **Studio Next**, select chain ID `61997`, and deploy `contracts/modelseal.py` as a new instance. Its constructor takes no arguments. Do not overwrite the historical Bradbury instance.
2. Wait for finalization and inspect execution success. Enter its address in the dashboard's contract field. `get_counts` must return version `2`.
3. Connect OKX or an injected EVM wallet, switch to Studio Next, and register a profile with the pinned files and digest. Review the Transaction Kit fee quote before approving.
4. Check the submitted transaction in the explorer. Refresh finalized state after finalization, select the profile and submit an audit.
5. Refresh finalized receipts, open a receipt and download its actual evidence JSON.

The verified Studio Dev deployment is `0x5fA12728120D6713671e5a18F79470994380F12D`; deployment transaction `0x835ff9eb666f15fc51721f17fa1bc4b237537c84b7fb4d9939a47a51245b6e6e` completed with successful GenVM execution. Local storage remembers an explicitly selected Studio Dev contract for this browser. The historical Bradbury deployment remains evidence of the earlier build, but it does not satisfy the Agent Tank Studio Next requirement.

## Development and checks

```sh
npm ci
npm test
npm run lint
npm run build
python -B -m pytest -q -p no:cacheprovider
genvm-lint check --json contracts/modelseal.py
npx playwright install chromium
npx playwright test
```

Python dependencies are pinned to tested commits of the v0.6-compatible prereleases in `requirements.txt`. The two SDK integration tests execute with mocked HTTP and LLM boundaries; they do not prove distributed Studio Next settlement. Browser tests use a mocked wallet/RPC; transaction-safety tests exercise submission recovery and signing guards. The app can be run with `npm run dev` or deployed with `npx vercel --prod`.

## Limits

Each contract has a 10,000 profile/receipt cap, each page returns at most 20 records, and suites contain up to four probes. Endpoint answers are bounded to 2,000 characters each. Results measure consistency against a supplied baseline, not universal quality, safety, identity or a probability score. Public probes can be recognized or spoofed; changing sampling/system prompts can affect outcomes. Prompt instructions reduce injection risk but do not prove immunity. DNS rebinding/redirect restrictions depend on runtime enforcement. On-chain evidence is public.
