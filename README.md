# ModelSeal

ModelSeal is an AI endpoint capability and behavioral drift auditor for the GenLayer Agent Tank hackathon. It records endpoint claims, locks probe suites and evidence packets to immutable Git commits, and uses comparative validator consensus to classify audits as `CONSISTENT`, `DRIFT_DETECTED`, or `INCONCLUSIVE`.

ModelSeal does not claim to prove hidden model weights. It provides an auditable signal that an endpoint's observable capabilities remain consistent with a registered baseline.

## What it demonstrates

- Immutable endpoint profiles with a claimed model, public HTTPS endpoint, probe-suite revision, and SHA-256 baseline digest.
- Nonce-bound evidence packets locked to full 40-character Git commits.
- Comparative consensus over capability failures and behavioral drift signals.
- Fail-closed normalization for weak, malformed, unreachable, unlocked, or inconsistent evidence.
- A responsive audit dashboard with endpoint registration, audit history, evidence comparison, and a runnable demo state.

## Local development

```bash
npm install
npm run dev
```

The Intelligent Contract is at `contracts/modelseal.py`.

## Audit states

- `CONSISTENT`: validators found adequate evidence and no material deviation.
- `DRIFT_DETECTED`: one or more capability failures or drift signals were agreed.
- `INCONCLUSIVE`: evidence was weak, malformed, unreachable, or did not reach semantic agreement.

## Security model

Probe suites and evidence use immutable GitHub blob URLs. Evidence is bounded and treated as untrusted data inside the validator prompt. Required booleans must be present, confidence is bounded to 0–100, and the contract refuses to treat a drift verdict without concrete signals as verified drift.

## Limitations

Behavioral probes cannot prove a provider's underlying model weights and can be affected by system prompts, sampling, gateways, and deliberate fingerprint spoofing. ModelSeal therefore reports consistency and drift evidence, not cryptographic model identity.
