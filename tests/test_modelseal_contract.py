import importlib.util, sys, types
from pathlib import Path
import pytest

SHA="a"*40
SUITE=f"https://github.com/example/modelseal/blob/{SHA}/probes/suite.json"
EVIDENCE=f"https://github.com/example/modelseal/blob/{SHA}/evidence/run.json"

class TreeMap(dict):
    def __class_getitem__(cls,_): return cls
class U256(int): pass
class Address(str):
    @property
    def as_hex(self): return str(self)
class Write:
    def __call__(self,fn): return fn
class Public:
    write=Write()
    @staticmethod
    def view(fn): return fn
class VM:
    class UserError(Exception): pass
class Web:
    page='{"nonce":"abcdefghijklmnop","results":[]}'
    @classmethod
    def render(cls,url,mode="text"): cls.url=url; return cls.page
class Nondet:
    web=Web(); raw={}
    @classmethod
    def exec_prompt(cls,prompt,response_format=None): cls.prompt=prompt; return cls.raw
class Eq:
    @classmethod
    def prompt_comparative(cls,fn,principle): cls.principle=principle; return fn()
class GL:
    Contract=object; public=Public(); vm=VM; message=types.SimpleNamespace(sender_address=Address("0xOwner")); nondet=Nondet(); eq_principle=Eq()

def load_contract():
    stub=types.ModuleType("genlayer"); stub.TreeMap=TreeMap; stub.u256=U256; stub.gl=GL; stub.allow_storage=lambda cls:cls
    old=sys.modules.get("genlayer"); sys.modules["genlayer"]=stub
    try:
        spec=importlib.util.spec_from_file_location("modelseal_test",Path(__file__).parents[1]/"contracts"/"modelseal.py")
        module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
    finally:
        if old is None: del sys.modules["genlayer"]
        else: sys.modules["genlayer"]=old

def instance(module):
    obj=object.__new__(module.ModelSeal); obj.profiles=TreeMap(); obj.receipts=TreeMap(); obj.profile_count=U256(0); obj.receipt_count=U256(0); return obj

def register(obj): return obj.register_endpoint("Nova Research Agent","https://api.nova.example/v1","Nova 72B v3.1",SUITE,"b"*64)

def good_result():
    return {"status":"CONSISTENT","confidence":94,"evidence_quality":"ENOUGH","endpoint_reachable":True,"suite_verified":True,"nonce_verified":True,"baseline_comparable":True,"summary":"Observed capabilities match the baseline.","capability_failures":[],"drift_signals":[]}

def test_registers_immutable_profile():
    obj=instance(load_contract()); item=register(obj)
    assert item["probe_suite_revision"]==SHA and item["baseline_digest"]=="b"*64
    assert obj.get_counts()=={"profiles":1,"receipts":0}

@pytest.mark.parametrize("url",["http://api.example/v1","https://user@api.example/v1","https://api.example/v1#fragment"])
def test_rejects_unsafe_endpoints(url):
    obj=instance(load_contract())
    with pytest.raises(Exception): obj.register_endpoint("Agent",url,"Model",SUITE,"b"*64)

@pytest.mark.parametrize("url",["https://example.com/file.json","https://github.com/a/b/blob/main/file.json",SUITE+"?raw=1"])
def test_rejects_mutable_evidence(url):
    with pytest.raises(Exception): instance(load_contract())._locked_github(url)

def test_consistent_receipt_requires_complete_evidence():
    obj=instance(load_contract()); register(obj); Nondet.raw=good_result()
    result=obj.audit_endpoint("1",EVIDENCE,"abcdefghijklmnop")
    assert result["status"]=="CONSISTENT" and result["confidence"]==94
    assert "raw.githubusercontent.com" in Web.url and obj.get_counts()["receipts"]==1

def test_concrete_signal_forces_drift():
    obj=instance(load_contract()); register(obj); Nondet.raw=good_result(); Nondet.raw["drift_signals"]=["Tool-call success fell below threshold"]
    assert obj.audit_endpoint("1",EVIDENCE,"abcdefghijklmnop")["status"]=="DRIFT_DETECTED"

@pytest.mark.parametrize("field",["endpoint_reachable","suite_verified","nonce_verified","baseline_comparable"])
def test_missing_required_verification_fails_closed(field):
    obj=instance(load_contract()); register(obj); Nondet.raw=good_result(); del Nondet.raw[field]
    result=obj.audit_endpoint("1",EVIDENCE,"abcdefghijklmnop")
    assert result["status"]=="INCONCLUSIVE" and result["confidence"]==0

def test_empty_or_oversized_evidence_fails_closed():
    obj=instance(load_contract()); register(obj); Web.page=""
    assert obj.audit_endpoint("1",EVIDENCE,"abcdefghijklmnop")["status"]=="INCONCLUSIVE"
    Web.page="x"*16001
    assert obj.audit_endpoint("1",EVIDENCE,"abcdefghijklmnop")["status"]=="INCONCLUSIVE"

def test_drift_without_signals_is_not_accepted():
    obj=instance(load_contract()); register(obj); Nondet.raw=good_result(); Nondet.raw["status"]="DRIFT_DETECTED"
    assert obj.audit_endpoint("1",EVIDENCE,"abcdefghijklmnop")["status"]=="INCONCLUSIVE"

def test_only_owner_can_deactivate():
    obj=instance(load_contract()); register(obj); GL.message.sender_address=Address("0xOther")
    with pytest.raises(Exception,match="owner"): obj.deactivate_endpoint("1")
    GL.message.sender_address=Address("0xOwner"); assert obj.deactivate_endpoint("1")["active"] is False

def test_nonce_is_required():
    obj=instance(load_contract()); register(obj)
    with pytest.raises(Exception,match="Nonce"): obj.audit_endpoint("1",EVIDENCE,"short")
