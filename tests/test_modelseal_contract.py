import importlib.util
import base64
import hashlib
import json
import sys
import types
from pathlib import Path
import pytest

SHA = 'a' * 40
SUITE_URL = f'https://github.com/example/modelseal/blob/{SHA}/suite.json'
BASE_URL = f'https://github.com/example/modelseal/blob/{SHA}/baseline.json'
NONCE = 'c' * 48
SUITE = {'schema':'modelseal.probes.v2','probes':[{'id':'explain','prompt':'Explain idempotency.','rubric':'Must explain repeat without duplicate effect.'}]}
SUITE_BYTES = json.dumps(SUITE).encode()
BASE = {'schema':'modelseal.baseline.v2','suite_sha256':hashlib.sha256(SUITE_BYTES).hexdigest(),'responses':{'explain':'Repeating the operation has the same effect as performing it once.'}}
BASE_BYTES = json.dumps(BASE).encode()

class TreeMap(dict):
    def __class_getitem__(cls, key): return cls

@pytest.fixture
def env():
    calls=[]
    state={'suite':SUITE_BYTES,'base':BASE_BYTES,'output':'Repeating has no duplicate effect.','nonce':NONCE,'status':200,'answer':{'summary':'Observable behavior matches.','probes':[{'id':'explain','verdict':'MATCH','reason':'Same operational semantics.'}]}}
    def response(body,status=200):return types.SimpleNamespace(body=body,status=status)
    def get(url):
        calls.append(('GET',url))
        raw = state['suite'] if '/suite.json?' in url else state['base']
        envelope = {'type':'file','encoding':'base64','size':len(raw),'content':base64.b64encode(raw).decode()}
        return response(json.dumps(envelope).encode())
    def request(url,**kwargs):
        calls.append(('POST',url,json.loads(kwargs['body'])))
        return response(json.dumps({'nonce':state['nonce'],'probe_id':'explain','output':state['output']}).encode(),state['status'])
    gl=types.ModuleType('genlayer');gl.contract=types.SimpleNamespace(Contract=object);gl.storage=types.SimpleNamespace(TreeMap=TreeMap);gl.u256=int;gl.public=types.SimpleNamespace(write=lambda f:f,view=lambda f:f);gl.vm=types.SimpleNamespace(UserError=ValueError);gl.message=types.SimpleNamespace(sender_address=types.SimpleNamespace(as_hex='0xOwner'));gl.nondet=types.SimpleNamespace(web=types.SimpleNamespace(get=get,request=request),exec_prompt=lambda *a,**kw:json.dumps(state['answer']));gl.eq_principle=types.SimpleNamespace(prompt_comparative=lambda fn,*args,**kw:fn())
    stub=gl
    old=sys.modules.get('genlayer');sys.modules['genlayer']=stub
    try:
        spec=importlib.util.spec_from_file_location('modelseal_test',Path(__file__).parents[1]/'contracts/modelseal.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    finally:
        if old is None:sys.modules.pop('genlayer')
        else:sys.modules['genlayer']=old
    obj=module.ModelSeal();obj.profiles={};obj.receipts={};obj.used_nonces={};obj.profile_count=0;obj.receipt_count=0
    obj.register_endpoint('Agent','https://agent.acme.com/challenge','Declared model',SUITE_URL,BASE_URL,hashlib.sha256(BASE_BYTES).hexdigest())
    return obj,state,calls,gl

def test_fetches_suite_baseline_and_posts_challenge(env):
    obj,state,calls,_=env
    r=obj.audit_endpoint('1',NONCE)
    assert r['status']=='CONSISTENT' and r['baseline_verified']
    assert [c[0] for c in calls]==['GET','GET','POST']
    assert calls[-1][2]['nonce']==NONCE and calls[-1][2]['prompt']==SUITE['probes'][0]['prompt']
    assert r['observations'][0]['output']==state['output']
    assert calls[0][1].startswith('https://api.github.com/repos/example/modelseal/contents/suite.json?ref=')

def test_invalid_github_envelope_fails_closed(env):
    obj,state,calls,_=env
    original_get=obj._github_response
    class BadResponse:
        status=200
        body=b'{"type":"dir","encoding":"base64","size":1,"content":"eA=="}'
    obj._github_response=lambda response: original_get(BadResponse())
    assert obj.audit_endpoint('1',NONCE)['status']=='INCONCLUSIVE'
    assert not any(c[0]=='POST' for c in calls)

def test_replay_rejected_without_network(env):
    obj,_,calls,_=env;obj.audit_endpoint('1',NONCE);before=len(calls)
    with pytest.raises(ValueError,match='already used'):obj.audit_endpoint('1',NONCE)
    assert len(calls)==before and obj.receipt_count==1

@pytest.mark.parametrize('field,value',[('base',b'{}'),('suite',b'{}'),('suite',b'x'*16001),('suite',b'[]'),('base',b'bad json')])
def test_invalid_locked_evidence_never_calls_endpoint(env,field,value):
    obj,state,calls,_=env;state[field]=value
    assert obj.audit_endpoint('1',NONCE)['status']=='INCONCLUSIVE'
    assert not any(c[0]=='POST' for c in calls)

@pytest.mark.parametrize('field,value',[('nonce','d'*48),('status',503),('output',''),('output','x'*2001)])
def test_invalid_live_response_fails_closed(env,field,value):
    obj,state,_,_=env;state[field]=value
    assert obj.audit_endpoint('1',NONCE)['status']=='INCONCLUSIVE'

@pytest.mark.parametrize('answer',[None,{},[],{'summary':'ok','probes':[]},{'summary':'ok','probes':[{'id':'other','verdict':'MATCH','reason':'ok'}]},{'summary':'ok','probes':[{'id':'explain','verdict':'APPROVE','reason':'ok'}]}])
def test_malformed_llm_verdict_fails_closed(env,answer):
    obj,state,_,_=env;state['answer']=answer
    assert obj.audit_endpoint('1',NONCE)['status']=='INCONCLUSIVE'

def test_drift_comes_from_per_probe_verdict(env):
    obj,state,_,_=env;state['answer']['probes'][0]['verdict']='DRIFT'
    assert obj.audit_endpoint('1',NONCE)['status']=='DRIFT_DETECTED'

@pytest.mark.parametrize('url',['https://','https://localhost/','https://127.0.0.1/','https://2130706433/','https://[::1]/','https://user@acme.com/','https://acme.com/a/../b','https://acme.com/%2e%2e/b','https://acme.com/a\\b','https://acme.com:8080/','https://acme.com/?x=y','https://api.local/'])
def test_rejects_unsafe_or_ambiguous_endpoint(env,url):
    with pytest.raises(ValueError):env[0]._endpoint(url)

@pytest.mark.parametrize('path',['../secret','%2e%2e/secret','a//b','./a'])
def test_rejects_github_path_traversal(env,path):
    with pytest.raises(ValueError):env[0]._locked(f'https://github.com/example/repo/blob/{SHA}/{path}')

def test_deactivation_owner_and_pagination(env):
    obj,_,_,gl=env;gl.message.sender_address.as_hex='0xOther'
    with pytest.raises(ValueError,match='owner'):obj.deactivate_endpoint('1')
    gl.message.sender_address.as_hex='0xOwner';obj.deactivate_endpoint('1')
    with pytest.raises(ValueError,match='inactive'):obj.audit_endpoint('1',NONCE)
    assert len(obj.list_profiles(0,20))==1 and obj.list_profiles(1,20)==[]
    with pytest.raises(ValueError):obj.list_profiles(-1,20)

def test_inconclusive_consumes_nonce(env):
    obj,state,_,_=env;state['status']=503;obj.audit_endpoint('1',NONCE)
    with pytest.raises(ValueError,match='already used'):obj.audit_endpoint('1',NONCE)

@pytest.mark.parametrize('nonce', ['a'*31, 'a'*33, 'a'*63, 'a'*65, 'A'*48])
def test_nonce_requires_whole_lowercase_bytes(env, nonce):
    obj,_,calls,_=env
    with pytest.raises(ValueError, match='nonce'):obj.audit_endpoint('1',nonce)
    assert calls == [] and obj.receipt_count == 0

@pytest.mark.parametrize('field', ['summary', 'reason', 'output', 'prompt', 'rubric', 'baseline'])
def test_whitespace_is_not_evidence(env, field):
    obj,state,_,_=env
    if field == 'summary': state['answer']['summary'] = '  \n'
    elif field == 'reason': state['answer']['probes'][0]['reason'] = '  '
    elif field == 'output': state['output'] = '  '
    else:
        suite=json.loads(state['suite']); baseline=json.loads(state['base'])
        if field == 'baseline': baseline['responses']['explain'] = '  '
        else: suite['probes'][0][field] = '  '
        state['suite']=json.dumps(suite).encode()
        baseline['suite_sha256']=hashlib.sha256(state['suite']).hexdigest()
        state['base']=json.dumps(baseline).encode()
        profile=json.loads(obj.profiles['1'])
        profile['baseline_digest']=hashlib.sha256(state['base']).hexdigest()
        obj.profiles['1']=json.dumps(profile)
    assert obj.audit_endpoint('1',NONCE)['status'] == 'INCONCLUSIVE'

def test_oversized_comparison_fails_closed(env):
    obj,state,_,_=env
    state['answer']['extra']='x'*16001
    assert obj.audit_endpoint('1',NONCE)['status']=='INCONCLUSIVE'

@pytest.mark.parametrize('mutation', [
    lambda r:r.update(status='DRIFT_DETECTED'),
    lambda r:r.update(probes=[]),
    lambda r:r.update(baseline_verified=False),
    lambda r:r.update(baseline_verified=1),
    lambda r:r.update(suite_sha256=''),
    lambda r:r.update(observations=[]),
    lambda r:r['observations'][0].update(response_sha256='bogus'),
    lambda r:r['observations'][0].update(output=' '),
    lambda r:r['observations'].append(r['observations'][0]),
    lambda r:r['probes'][0].update(verdict='INCONCLUSIVE'),
    lambda r:r['probes'][0].update(id='other'),
    lambda r:r.update(summary=' '),
    lambda r:r.update(extra='untrusted'),
])
def test_consensus_boundary_rejects_forged_success_without_state_change(env, mutation):
    obj,_,_,gl=env
    result=obj._collect(json.loads(obj.profiles['1']),NONCE)
    mutation(result)
    gl.eq_principle.prompt_comparative=lambda *args:result
    with pytest.raises(ValueError):obj.audit_endpoint('1',NONCE)
    assert obj.receipt_count == 0 and not obj.receipts and not obj.used_nonces

def test_genuine_ambiguous_verdict_preserves_verified_evidence(env):
    obj,state,_,_=env
    state['answer']['probes'][0]['verdict']='INCONCLUSIVE'
    result=obj.audit_endpoint('1',NONCE)
    assert result['status']=='INCONCLUSIVE' and result['baseline_verified']
    assert len(result['observations'])==1
