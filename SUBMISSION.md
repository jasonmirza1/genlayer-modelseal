# ModelSeal — accepted v2 project reference

Network: GenLayer **Studio Next** · RPC `https://studio-next.genlayer.com/api` · chain ID `61997` · explorer https://explorer-studio-dev.genlayer.com/

Contract: [`0xA861e33d618E0B28429872f1743021dae57548b8`](https://explorer-studio-dev.genlayer.com/address/0xA861e33d618E0B28429872f1743021dae57548b8). Read-only finalized checks on October 8, 2026 returned `profiles=1, receipts=1, version=2`. Receipt #1 for endpoint #1 is CONSISTENT. No new deployment or wallet transaction is required to read that evidence.

Website: https://modelseal.vercel.app

Status: The original Agent Tank project was accepted. This file records the existing demonstration, not a request to resubmit the same project. Its earlier video is evidence of the accepted version only. A new feature needs separately identified source, deployment and demo evidence; wallet transactions and Portal submissions remain manual.

Repository: https://github.com/jasonmirza1/genlayer-modelseal

One-liner: Consensus-based behavioral drift receipts from direct, nonce-bound probes of public AI endpoints.

Description: ModelSeal lets endpoint owners register an immutable probe suite and baseline, then asks GenLayer validators to probe the endpoint directly. Validators fetch both locked GitHub files, verify their SHA-256 bindings, send each nonce-bound HTTP challenge, and compare responses against the declared rubric. Exact response-envelope checks and complete probe coverage precede semantic consensus. The contract records CONSISTENT, DRIFT_DETECTED or INCONCLUSIVE receipts with observed outputs, hashes and reasons, and rejects used nonces. The dashboard connects an EVM wallet, registers/deactivates profiles, submits audits, tracks transaction hashes, reads finalized state and exports actual receipts. It measures observable consistency against a declared baseline; it does not prove hidden model weights. Public fixture endpoints demonstrate match, drift and invalid-evidence cases without pretending to be real AI providers.

Why consensus matters here: a single prober can lie, be rate-limited, or be served a different model than everyone else. Each validator sends its own nonce-bound challenge to the endpoint and must agree that it observed the same behavior. Deterministic contract code fixes what agreement means and re-checks the agreed payload after the equivalence boundary, so the LLM judges only semantic equivalence and never whether a receipt may be written. A drift claim one validator cannot reproduce does not become a receipt.

Beyond the boilerplate: an immutable evidence model (GitHub blob URLs pinned to a 40-hex commit, verified by SHA-256 of the exact file bytes, with the suite hash bound inside the baseline), nonce-bound direct probing of the audited endpoint, per-profile nonce replay rejection, a post-consensus deterministic re-check that rejects forged success labels, a browser-local write-recovery record that survives reloads and RPC failures, and consensus-round-outcome verification that the SDK and Transaction Kit RC2 do not provide. This contract exposes no upgrade method; new contract code requires a fresh deployment and profile registration.

Review path: Load the existing address above, inspect its finalized profile and receipt #1, and download actual evidence. A new profile or audit is optional and requires a separately reviewed fee and manual wallet approval. Clearly label programmed fixture results as fixtures, not findings about a real AI provider.

Expected outcome: A baseline fixture audit should produce a consistent receipt, a drift fixture should produce a drift receipt, and a wrong-nonce fixture should be inconclusive. Actual outcomes depend on validators; include accepted-round transaction evidence before making a success claim. The website shows no fabricated validator counts or confidence scores.

Baseline evidence: [accepted audit transaction](https://explorer-studio-dev.genlayer.com/tx/0x8469d0f6b1efc3ddc104ca0995d74b9b563e2fd15c0b4308060808c434b1bd1a). This is the earlier v2 demonstration, not a new milestone transaction. The pre-fix `0x24a810E60a41C2D861740b85401754A2Eb15000c` instance and its discarded transaction `0x94eec90c4adcb58dd443b5523a0d4ef2ca487eeded74346d6e6dd5a5c72ccdd2` are historical debugging evidence, not the current demonstration. Earlier contract normalization and dashboard outcome corrections are not newly attributed to the milestone.
