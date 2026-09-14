# ModelSeal — submission draft (v2)

The corrected contract is deployed on Studio Dev at `0x5fA12728120D6713671e5a18F79470994380F12D`. Do not claim a completed live audit until a new Studio Dev audit transaction is finalized successfully.

Website: https://modelseal.vercel.app

Repository: https://github.com/jasonmirza1/genlayer-modelseal

One-liner: Consensus-based behavioral drift receipts from direct, nonce-bound probes of public AI endpoints.

Description: ModelSeal lets endpoint owners register an immutable probe suite and baseline, then asks GenLayer validators to probe the endpoint directly. Validators fetch both locked GitHub files, verify their SHA-256 bindings, send each nonce-bound HTTP challenge, and compare responses against the declared rubric. Exact response-envelope checks and complete probe coverage precede semantic consensus. The contract records CONSISTENT, DRIFT_DETECTED or INCONCLUSIVE receipts with observed outputs, hashes and reasons, and rejects used nonces. The dashboard connects an EVM wallet, registers/deactivates profiles, submits audits, tracks transaction hashes, reads finalized state and exports actual receipts. It measures observable consistency against a declared baseline; it does not prove hidden model weights. Public fixture endpoints demonstrate match, drift and invalid-evidence cases without pretending to be real AI providers.

Review path: Deploy v2 on Studio Next (chain ID 61997) and load its address; connect a wallet; register the baseline fixture using the pinned suite, baseline and byte digest described in README; approve the quoted fee and wait for successful finalization; submit an audit; inspect the transaction and finalized receipt. Repeat with the drift and invalid fixtures using fresh nonces, clearly labeling them as fixtures.

Expected outcome: A baseline fixture audit should produce a consistent receipt, a drift fixture should produce a drift receipt, and a wrong-nonce fixture should be inconclusive. Actual outcomes depend on validators; include finalized transaction evidence before making a success claim. The website shows no fabricated validator counts or confidence scores.
