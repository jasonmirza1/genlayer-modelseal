# ModelSeal — submission brief

## One-liner

Consensus-backed capability and drift attestations for public AI-agent endpoints.

## What it does

ModelSeal lets an operator register a claimed model, public endpoint, baseline capability digest and an immutable probe suite locked to a Git commit. A requester supplies nonce-bound observations from that endpoint. GenLayer validators compare the observations with the registered claim and baseline, then store a structured `CONSISTENT`, `DRIFT_DETECTED`, or `INCONCLUSIVE` receipt.

The contract is deliberately precise: it detects observable capability, policy and stability drift; it does not claim that behavioral probes prove hidden weights or cryptographic model identity. Strict URL validation, immutable evidence revisions, bounded inputs, nonce binding, deterministic schema checks and fail-closed handling reduce replay, ambiguity and prompt-injection risk.

## Why it matters

Agents increasingly buy work from other agents and APIs. A silent downgrade, policy change or proxy substitution can break an automation after payment or delegation. ModelSeal gives marketplaces, agent wallets, DAOs and procurement systems a reusable on-chain signal before trusting an endpoint.

## Reproducible review path

1. Open the live dashboard and select the registered endpoint `MS-0042`.
2. Review its claimed model, public endpoint and locked 12-probe suite.
3. Click **Start consensus audit**.
4. Observe the nonce-bound audit lifecycle and stored attestation.
5. Inspect the comparison panel and prior audit history.
6. Review `contracts/modelseal.py`, `probe-suites/v1.json`, the examples and tests in the repository.

## Expected verification outcome

The dashboard completes an audit and renders a structured receipt with a status, confidence, validator agreement, evidence lock and probe-level comparison. The repository tests pass, GenVM lint/validation passes, and the Bradbury deployment link resolves to the submitted contract after deployment.

## Verification performed

- Production web build passes.
- 21 contract/source tests pass.
- GenVM lint and contract validation pass: six public methods, three read and three write.

## Links

- Website: https://modelseal.tanjirodskamado1.chatgpt.site
- GitHub: to be added after repository publication
- Bradbury contract: to be added after wallet-approved deployment
