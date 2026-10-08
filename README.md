# ModelSeal v2

Public dashboard: https://modelseal.vercel.app

ModelSeal compares observable AI endpoint behavior against an operator-declared baseline using GenLayer comparative consensus. It cannot prove hidden model weights or exclude a proxy. Version 2 replaces the earlier simulated UI and unverified evidence-packet design.

## Milestone: Audit Gate

Audit Gate adds a walletless, read-only consumer API and dashboard policy for
finalized v2 evidence. It checks the newest 1–5 consecutive receipts against
explicit endpoint/baseline pins, with an optional suite hash, and blocks on
drift, inconclusive results, malformed evidence, incomplete bounded history or
failed/changing reads. An older passing receipt cannot hide a newer failure.

Publication is approved; deployment verification is pending. This feature does
not change the existing contract or require a new transaction. ALLOW means
historical baseline consistency, not model identity, safety or freshness:
v2 receipts have no audit timestamps.

See [integration and trust boundaries](docs/audit-gate.md) and the
[milestone delta ledger](docs/milestone-v1.md). The API is `GET /api/assurance`;
the CLI example is `scripts/check-assurance.mjs`.

## Network

| | |
|---|---|
| Network | GenLayer Studio Next / Studio Dev (Consensus v0.6 preview) |
| RPC | `https://studio-dev.genlayer.com/api` (canonical) |
| Browser alias | `https://studio-next.genlayer.com/api` — same deployment, same chain ID |
| Chain ID | `61997` |
| Explorer | https://explorer-studio-dev.genlayer.com/ |

Consensus v0.6 migration notes: https://docs.genlayer.com/developers/consensus-v06-migration
Network configuration: https://docs.genlayer.com/developers/intelligent-contracts/deploying/network-configuration

`studio-dev` is the documented SDK/RPC target and is what the dashboard pins; `studio-next` is a web alias for the same preview and answers identically. Override with `NEXT_PUBLIC_GENLAYER_RPC_URL` if that changes. Chain ID `61997` is fixed in code so the SDK's consensus addresses always match the network.

This preview is explicitly temporary: the network documentation warns to expect resets and not to depend on its state for durable deployments. Keep the contract source, the pinned evidence URLs and the baseline digest in the repository so a deployment can be recreated, and re-verify the contract address before relying on it.

## Why this needs consensus

A single prober cannot be trusted to report what an endpoint said: it can lie, be rate-limited, or be served a different model. ModelSeal makes each validator send its own nonce-bound challenge to the endpoint and then requires them to agree, through `gl.eq_principle.prompt_comparative`, that they observed the same behavior. Deterministic code fixes what agreement means — identical status, identical suite hash, identical probe verdicts, materially equivalent outputs — so the LLM only judges semantic equivalence, never whether a receipt may be written. A drift claim that one validator cannot reproduce does not become a receipt.

## Actual audit path

1. An owner registers a public HTTPS challenge endpoint, claimed model, immutable GitHub suite and baseline URLs, and SHA-256 of the baseline file's exact bytes.
2. Each validator fetches both files. Code checks the baseline hash and the suite hash embedded in the baseline, complete probe coverage, schema and byte limits.
3. Each validator POSTs 1–4 challenges directly to the registered endpoint, with the supplied fresh nonce and probe ID.
4. Code checks HTTP status, JSON types, byte/output limits and exact nonce/probe binding. An LLM compares each output with the baseline and rubric. Unverifiable evidence becomes INCONCLUSIVE, drawn from a closed set of reasons so every node reports it identically. A model that ignores the response contract is a per-node failure, not a finding about the endpoint, so it aborts the transaction instead: no receipt is written and the nonce stays spendable.
5. Comparative consensus requires matching classifications, probe verdicts, suite hash and baseline verification, plus materially equivalent observations. A receipt stores the outputs, response hashes, file locks, nonce and reasons.
6. The finalized receipt consumes the nonce for that profile, including an INCONCLUSIVE result. Reuse is rejected before HTTP calls. An aborted transaction does not produce a receipt; consult the explorer before retrying.

The dashboard uses `genlayer-js@2.0.0-rc.1` with `@genlayer/transaction-kit@0.1.0-rc.2` and `@genlayer/transaction-kit-react@0.1.0-rc.2`, driving the actual selected wallet provider. Reads use `LATEST_FINAL`; every write is quoted through the fee-aware review panel and requires wallet confirmation. No background retry or sample analytics are generated.

### FINALIZED is not "applied"

On Studio Next a transaction reaches `FINALIZED` whether or not its consensus round was accepted. A round that ends `MAJORITY_DISAGREE` finalizes with the leader's execution result still reported as `FINISHED_WITH_RETURN`, and every storage write it made is discarded. `isSuccessful()` in `genlayer-js` and the `successful` flag in Transaction Kit RC2 are both derived from status plus execution result only, so both report success for such a round, and the RC2 React panel prints "Validators agreed and the execution succeeded."

ModelSeal therefore does not use those signals to report a result. After tracking settles, `lib/chain.ts` resolves the round outcome from the SDK transaction lifecycle and treats a write as applied only when the outcome is `accepted` **and** the execution result is `FINISHED_WITH_RETURN`. Anything else is reported as discarded, with the round outcome and leader execution result shown verbatim. An unresolved outcome is held as unknown rather than assumed successful.

Fee reviews cannot replace an unresolved write. The wallet and chain are checked again before signing. A browser-local recovery record retains the action, wallet, contract, transaction hashes and the resolved round outcome through reloads and RPC failures. Use **Check recorded transaction** to re-read the outcome. A missing hash is an unknown outcome, not permission to retry: inspect wallet activity and finalized state first. Recovery is local to this browser, not a global transaction index.

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

An endpoint owner can implement this adapter in front of their model. Credentials stay at the owner's adapter; validators need public access. Do not pass secrets in prompts. Non-200 responses, redirects exposed as non-200, unreachable hosts, invalid envelopes and wrong nonces yield INCONCLUSIVE. A malformed comparison from the judging model aborts the transaction instead of producing a receipt. Public DNS/egress security remains the responsibility of the GenLayer web runtime; URL checks do not resolve DNS or prove a hostname remains public.

## Reproducible fixtures

These are deliberately programmed test fixtures, **not AI models or external validation evidence**:

- `https://modelseal.vercel.app/api/fixture/baseline` returns the baseline answers.
- `https://modelseal.vercel.app/api/fixture/drift` returns deliberately contradictory answers.
- `https://modelseal.vercel.app/api/fixture/invalid` returns an incorrect nonce.

The existing on-chain profile records `https://genlayer-modelseal.vercel.app/api/fixture/baseline`. This milestone deploys the dashboard at `https://modelseal.vercel.app`; it does not change that registered URL or assume the two hosts share a deployment. The contract stores the exact canonical URL registered by its owner.

The executable suite is `probe-suites/v2.json`; its matching reference is `examples/baseline-v2.json`. Obtain commit-pinned links and the baseline byte hash with `node scripts/review-links.mjs` after committing. Register each fixture as a separate profile, then submit audits from the browser. Expected outcomes are CONSISTENT, DRIFT_DETECTED and INCONCLUSIVE respectively; semantic outcomes still depend on actual network consensus. Fixture runs must be identified as such in a submission.

## Deployment and use

For a new instance, deploy `contracts/modelseal.py` against RPC `https://studio-dev.genlayer.com/api`, chain ID `61997`. Its constructor takes no arguments. To inspect the existing accepted demonstration, use the address below; no redeployment is needed.

### Upgradability, precisely

The constructor adds the deploying wallet to `gl.storage.Root.get().upgraders`. Per the [upgradability documentation](https://docs.genlayer.com/developers/intelligent-contracts/features/upgradability), the runtime calls `root.lock_default()` after `__init__`, locking the root, code, `locked_slots` and `upgraders` slots; a sender listed in `upgraders` bypasses those restrictions and may write the code slot.

Permission is necessary but not sufficient. GenVM has no upgrade entry point and the CLI has no upgrade command: replacing code requires the contract to **expose its own write method** that assigns to `Root.get().code`. This contract does not define one, so shipping new code means deploying a new instance and registering profiles again. Two practical notes if you add such a method later: `DynArray` in the v0.6 SDK offers `assign()` rather than the `truncate()`/`extend()` pair shown in the documentation, and it writes one element at a time, so assigning a multi-kilobyte `VLA[u8]` costs a storage write per byte.

1. For a new deployment, wait for finalization, then confirm the round outcome is **accepted**, not merely that the status is `FINALIZED`. Enter the address in the dashboard's contract field; `get_counts` must return version `2`.
2. For a new profile or audit, connect OKX or an injected EVM wallet, switch to Studio Next, and review the Transaction Kit fee quote before approving. Existing profiles and receipts can be read without a wallet.
3. Open any submitted transaction in the explorer. Refresh finalized state once the round is accepted, select the profile and submit an audit only if a new audit is wanted.
4. Refresh finalized receipts, open a receipt and download its actual evidence JSON.

### Current deployment status

The existing accepted demonstration uses [`0xA861e33d618E0B28429872f1743021dae57548b8`](https://explorer-studio-dev.genlayer.com/address/0xA861e33d618E0B28429872f1743021dae57548b8). Read-only finalized checks on October 8, 2026 returned `profiles = 1`, `receipts = 1`, `version = 2`. Receipt #1 for endpoint #1 is CONSISTENT. Its [accepted audit transaction](https://explorer-studio-dev.genlayer.com/tx/0x8469d0f6b1efc3ddc104ca0995d74b9b563e2fd15c0b4308060808c434b1bd1a) belongs to the earlier v2 demonstration, not the new milestone. It uses a programmed fixture, not a real AI provider.

The older instance `0x24a810E60a41C2D861740b85401754A2Eb15000c` is historical pre-fix evidence, not the dashboard default. Its audit attempt `0x94eec90c4adcb58dd443b5523a0d4ef2ca487eeded74346d6e6dd5a5c72ccdd2` finalized with `MAJORITY_DISAGREE` / `undetermined` and wrote no receipt. That failure motivated the earlier contract normalization and dashboard round-outcome corrections. Those corrections are not newly attributed to the milestone.

There is no exposed upgrade method in this contract. Source readback previously failed with the network's `gen_getContractCode` backend error; no claim is made that today's local source was independently recovered from deployed bytecode. Preview network state may reset, so recheck finalized counts and evidence before relying on the address.

The historical Bradbury deployment remains evidence of the earlier build, but it does not satisfy the Agent Tank Studio Next requirement.

## Demo video

The original Agent Tank submission was accepted; its earlier recording demonstrates that version only. For a new milestone, make a separate silent normal screen recording of the new functionality against real finalized state. Do not present mocked tests as live consensus or imply a new wallet transaction occurred. Attach the published video separately from source, deployment, documentation and report evidence. Local old recordings and capture helpers are excluded from deployment.

## Development and checks

```sh
npm ci
npm test                 # 103 policy, outcome and transaction-safety tests
npm run lint
npm run build
python -B -m pytest -q -p no:cacheprovider   # 105 contract / GenVM tests
genvm-lint check contracts/modelseal.py      # add --json for machine output
npx playwright install chromium
npx playwright test      # 19 gate and wallet/browser regressions
```

On Windows, set `PYTHONUTF8=1` before the Python commands so the linter can print its status glyphs.

Python dependencies are pinned to tested commits of the v0.6-compatible prereleases in `requirements.txt`. The SDK integration tests run the real GenVM Python runtime with mocked HTTP and LLM boundaries; they do not prove distributed Studio Next settlement. Two of them reproduce the production failure directly: a model answer wrapped in a code fence or prose must still produce a receipt, and an unusable model answer must write nothing at all. Browser tests use a mocked wallet and RPC and include a case asserting that a finalized round with `outcome: undetermined` is never presented as a completed write. Transaction-safety tests exercise submission recovery, signing guards and round-outcome verification. The app can be run with `npm run dev` or deployed with `npx vercel --prod`.

## Limits

Each contract has a 10,000 profile/receipt cap, each page returns at most 20 records, and suites contain up to four probes. Endpoint answers are bounded to 2,000 characters each. Results measure consistency against a supplied baseline, not universal quality, safety, identity or a probability score. Public probes can be recognized or spoofed; changing sampling/system prompts can affect outcomes. Prompt instructions reduce injection risk but do not prove immunity. DNS rebinding/redirect restrictions depend on runtime enforcement. On-chain evidence is public.
