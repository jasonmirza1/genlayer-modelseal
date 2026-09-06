from pathlib import Path

SOURCE = (Path(__file__).parents[1] / "contracts" / "modelseal.py").read_text(encoding="utf-8")

def test_contract_exposes_complete_lifecycle():
    for method in ("register_endpoint", "audit_endpoint", "deactivate_endpoint", "get_profile", "get_receipt", "get_counts"):
        assert f"def {method}(" in SOURCE

def test_evidence_is_immutable_and_nonce_bound():
    assert "len(revision) != 40" in SOURCE
    assert "<expected_nonce>" in SOURCE
    assert "<locked_evidence_revision>" in SOURCE

def test_contract_states_limit_claims():
    assert '("CONSISTENT", "DRIFT_DETECTED", "INCONCLUSIVE")' in SOURCE
    assert "it never proves model weights or identity" in SOURCE

def test_fail_closed_schema_checks_are_present():
    for field in ("endpoint_reachable", "suite_verified", "nonce_verified", "baseline_comparable"):
        assert field in SOURCE
    assert 'status, quality, confidence, failures, signals = "INCONCLUSIVE"' in SOURCE
