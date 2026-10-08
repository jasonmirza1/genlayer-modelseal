import hashlib
import base64
import json
from pathlib import Path

import pytest

SHA = 'a' * 40
NONCE = 'c' * 48
CONTRACT = str(Path(__file__).parents[2] / 'contracts/modelseal.py')
SUITE = {'schema':'modelseal.probes.v2','probes':[{'id':'explain','prompt':'Explain idempotency.','rubric':'Repeat without duplicate effect.'}]}
SUITE_RAW = json.dumps(SUITE)
BASELINE_RAW = json.dumps({'schema':'modelseal.baseline.v2','suite_sha256':hashlib.sha256(SUITE_RAW.encode()).hexdigest(),'responses':{'explain':'Repeated requests have the same effect as one request.'}})
VERDICT = {'summary':'Same behavior.','probes':[{'id':'explain','verdict':'MATCH','reason':'Equivalent effect.'}]}


def _envelope(raw: str) -> str:
    return json.dumps({'type':'file','encoding':'base64','size':len(raw.encode()),'content':base64.b64encode(raw.encode()).decode()})


def _mock_evidence(direct_vm, endpoint=None):
    # The runner matches the first registered mock for a URL, so the endpoint
    # response has to be supplied here rather than re-registered afterwards.
    direct_vm.mock_web(r'.*api\.github\.com/repos/example/modelseal/contents/suite\.json\?ref=a{40}.*',{'status':200,'body':_envelope(SUITE_RAW)})
    direct_vm.mock_web(r'.*api\.github\.com/repos/example/modelseal/contents/baseline\.json\?ref=a{40}.*',{'status':200,'body':_envelope(BASELINE_RAW)})
    direct_vm.mock_web(r'.*agent\.acme\.com/challenge.*', endpoint or {'method':'POST','status':200,'body':json.dumps({'nonce':NONCE,'probe_id':'explain','output':'Repeating does not duplicate its effect.'})})


def _mock_answer(direct_vm, text: str):
    # The runner hands exec_prompt raw model text, so the mock is double encoded:
    # the outer layer is what the host returns, the inner string is what the model
    # actually wrote, wrapper and all.
    direct_vm.mock_llm(r'.*Compare endpoint outputs.*', json.dumps(text))


def _register(direct_deploy_compat):
    contract = direct_deploy_compat(CONTRACT)
    contract.register_endpoint('Agent','https://agent.acme.com/challenge','Declared',f'https://github.com/example/modelseal/blob/{SHA}/suite.json',f'https://github.com/example/modelseal/blob/{SHA}/baseline.json',hashlib.sha256(BASELINE_RAW.encode()).hexdigest())
    return contract


def test_live_challenge_and_replay_in_genvm(direct_vm, direct_deploy_compat):
    _mock_evidence(direct_vm)
    _mock_answer(direct_vm, json.dumps(VERDICT))
    c = _register(direct_deploy_compat)
    r = c.audit_endpoint('1', NONCE)
    assert r['status'] == 'CONSISTENT', r['summary']
    assert r['baseline_verified'] and r['observations'][0]['probe_id'] == 'explain'
    assert c.get_counts()['receipts'] == 1
    with pytest.raises(Exception, match='Nonce already used'):
        c.audit_endpoint('1', NONCE)


@pytest.mark.parametrize('wrapper', [
    '```json\n{body}\n```',
    '```\n{body}\n```',
    'Here is my comparison.\n\n{body}\n\nHappy to expand on any probe.',
])
def test_wrapped_model_answer_still_writes_a_receipt(direct_vm, direct_deploy_compat, wrapper):
    # This is the Studio Next failure end to end in the real SDK: the model wrote
    # the verdict inside a fence or a sentence. Before the fix json.loads raised
    # at char 0, the block returned INCONCLUSIVE, validators that parsed their own
    # answer returned a verdict instead, and the disagreeing round threw away the
    # receipt write while the transaction still reported FINALIZED.
    _mock_evidence(direct_vm)
    _mock_answer(direct_vm, wrapper.format(body=json.dumps(VERDICT)))
    c = _register(direct_deploy_compat)
    r = c.audit_endpoint('1', NONCE)
    assert r['status'] == 'CONSISTENT', r['summary']
    assert r['probes'][0]['verdict'] == 'MATCH'
    assert c.get_counts()['receipts'] == 1


@pytest.mark.parametrize('text', ['I cannot compare these outputs.', 'null', '{unterminated'])
def test_unusable_model_answer_writes_nothing_in_genvm(direct_vm, direct_deploy_compat, text):
    _mock_evidence(direct_vm)
    _mock_answer(direct_vm, text)
    c = _register(direct_deploy_compat)
    with pytest.raises(Exception):
        c.audit_endpoint('1', NONCE)
    assert c.get_counts()['receipts'] == 0


def test_unreachable_evidence_host_is_inconclusive_in_genvm(direct_vm, direct_deploy_compat):
    # No web mock at all, so the runner itself raises from inside gl.nondet.web.get
    # with its own exception class. That is the shape of a real DNS/TLS/timeout
    # failure, and it must reach the canonical reason rather than aborting: the
    # evidence catch is scoped to the I/O, not typed to a known exception.
    c = _register(direct_deploy_compat)
    r = c.audit_endpoint('1', NONCE)
    assert r['status'] == 'INCONCLUSIVE' and not r['baseline_verified']
    assert r['summary'] == 'Locked probe suite or baseline could not be retrieved and verified'
    assert c.get_counts()['receipts'] == 1


def test_endpoint_failure_is_inconclusive_without_exception_text(direct_vm, direct_deploy_compat):
    _mock_evidence(direct_vm, {'method':'POST','status':503,'body':'gateway down'})
    _mock_answer(direct_vm, json.dumps(VERDICT))
    c = _register(direct_deploy_compat)
    r = c.audit_endpoint('1', NONCE)
    assert r['status'] == 'INCONCLUSIVE' and not r['baseline_verified']
    assert 'Expecting value' not in r['summary'] and 'char 0' not in r['summary']
    assert c.get_counts()['receipts'] == 1


def test_tampered_baseline_in_genvm(direct_vm, direct_deploy_compat):
    direct_vm.mock_web(r'.*api\.github\.com/repos/.*',{'status':200,'body':_envelope('{}')})
    c = direct_deploy_compat(CONTRACT)
    c.register_endpoint('Agent','https://agent.acme.com/challenge','Declared',f'https://github.com/example/modelseal/blob/{SHA}/suite.json',f'https://github.com/example/modelseal/blob/{SHA}/baseline.json','b'*64)
    result = c.audit_endpoint('1', NONCE)
    assert result['status'] == 'INCONCLUSIVE' and not result['baseline_verified']
