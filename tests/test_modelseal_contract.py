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
    authorized_upgraders=[]
    state={'suite':SUITE_BYTES,'base':BASE_BYTES,'output':'Repeating has no duplicate effect.','nonce':NONCE,'status':200,'answer':{'summary':'Observable behavior matches.','probes':[{'id':'explain','verdict':'MATCH','reason':'Same operational semantics.'}]},'answer_text':None}
    def response(body,status=200):return types.SimpleNamespace(body=body,status=status)
    def get(url):
        calls.append(('GET',url))
        raw = state['suite'] if '/suite.json?' in url else state['base']
        envelope = {'type':'file','encoding':'base64','size':len(raw),'content':base64.b64encode(raw).decode()}
        return response(json.dumps(envelope).encode())
    def request(url,**kwargs):
        calls.append(('POST',url,json.loads(kwargs['body'])))
        return response(json.dumps({'nonce':state['nonce'],'probe_id':'explain','output':state['output']}).encode(),state['status'])
    # A real model returns text, so the stub returns text too: answer_text lets a
    # test reproduce the wrappers models actually emit around the JSON object.
    def exec_prompt(*a,**kw):
        return state['answer_text'] if state['answer_text'] is not None else json.dumps(state['answer'])
    root=types.SimpleNamespace(upgraders=types.SimpleNamespace(get=lambda:authorized_upgraders))
    gl=types.ModuleType('genlayer');gl.contract=types.SimpleNamespace(Contract=object);gl.storage=types.SimpleNamespace(TreeMap=TreeMap,Root=types.SimpleNamespace(get=lambda:root));gl.u256=int;gl.public=types.SimpleNamespace(write=lambda f:f,view=lambda f:f);gl.vm=types.SimpleNamespace(UserError=ValueError);gl.message=types.SimpleNamespace(sender_address=types.SimpleNamespace(as_hex='0xOwner'));gl.nondet=types.SimpleNamespace(web=types.SimpleNamespace(get=get,request=request),exec_prompt=exec_prompt);gl.eq_principle=types.SimpleNamespace(prompt_comparative=lambda fn,*args,**kw:fn())
    stub=gl
    old=sys.modules.get('genlayer');sys.modules['genlayer']=stub
    try:
        spec=importlib.util.spec_from_file_location('modelseal_test',Path(__file__).parents[1]/'contracts/modelseal.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    finally:
        if old is None:sys.modules.pop('genlayer')
        else:sys.modules['genlayer']=old
    obj=module.ModelSeal();obj.profiles={};obj.receipts={};obj.used_nonces={};obj.profile_count=0;obj.receipt_count=0
    obj.register_endpoint('Agent','https://agent.acme.com/challenge','Declared model',SUITE_URL,BASE_URL,hashlib.sha256(BASE_BYTES).hexdigest())
    assert authorized_upgraders == [gl.message.sender_address]
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
def test_malformed_llm_verdict_aborts_without_receipt(env,answer):
    # A model that ignores the response contract has reported nothing about the
    # endpoint. Recording INCONCLUSIVE would both fabricate a verdict and spend
    # the nonce, and because the failure is per-node it would also desynchronise
    # the consensus payload. Aborting is identical on every node.
    obj,state,_,_=env;state['answer']=answer
    with pytest.raises(ValueError,match='JSON contract'):obj.audit_endpoint('1',NONCE)
    assert obj.receipt_count==0 and not obj.receipts and not obj.used_nonces

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

@pytest.mark.parametrize('field', ['output', 'prompt', 'rubric', 'baseline'])
def test_whitespace_evidence_is_inconclusive(env, field):
    obj,state,_,_=env
    if field == 'output': state['output'] = '  '
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

@pytest.mark.parametrize('field', ['summary', 'reason'])
def test_whitespace_model_text_aborts(env, field):
    obj,state,_,_=env
    if field == 'summary': state['answer']['summary'] = '  \n'
    else: state['answer']['probes'][0]['reason'] = '  '
    with pytest.raises(ValueError,match='JSON contract'):obj.audit_endpoint('1',NONCE)
    assert obj.receipt_count==0 and not obj.used_nonces

def test_oversized_comparison_aborts_without_receipt(env):
    obj,state,_,_=env
    state['answer']['extra']='x'*16001
    with pytest.raises(ValueError,match='JSON contract'):obj.audit_endpoint('1',NONCE)
    assert obj.receipt_count==0 and not obj.used_nonces

@pytest.mark.parametrize('wrapper', [
    '```json\n{body}\n```',
    '```JSON\r\n{body}\r\n```',
    '```\n{body}\n```',
    'Here is the comparison:\n\n{body}\n\nTell me if you want more detail.',
    '\n\n  {body}\n',
])
def test_verdict_survives_wrapped_model_output(env, wrapper):
    # Reproduces the Studio Next failure: the model returned the verdict wrapped
    # in prose or a fenced block, json.loads raised at char 0, and the block
    # returned INCONCLUSIVE while other nodes returned a real verdict, which made
    # the round disagree and silently discarded the receipt write.
    obj,state,_,_=env
    state['answer_text']=wrapper.format(body=json.dumps(state['answer']))
    result=obj.audit_endpoint('1',NONCE)
    assert result['status']=='CONSISTENT' and result['baseline_verified']
    assert result['probes'][0]['verdict']=='MATCH'
    assert obj.receipt_count==1 and json.loads(obj.receipts['1'])['status']=='CONSISTENT'

def test_a_non_latin_verdict_is_not_rejected_for_its_encoding(env):
    # The size limit is UTF-8 bytes. Measuring an ASCII-escaped re-serialisation
    # instead would reject a perfectly valid non-Latin reason.
    obj,state,_,_=env
    state['answer']['summary']='行为与基准一致。'*40
    state['answer']['probes'][0]['reason']='语义等价。'*40
    result=obj.audit_endpoint('1',NONCE)
    assert result['status']=='CONSISTENT' and obj.receipt_count==1
    assert result['probes'][0]['reason']==state['answer']['probes'][0]['reason']

@pytest.mark.parametrize('text', ['I cannot compare these outputs.', '', 'null', '[]', '{unterminated object', 'x'*16001])
def test_unusable_model_output_aborts_without_receipt(env, text):
    obj,state,_,_=env
    state['answer_text']=text
    with pytest.raises(ValueError,match='JSON contract'):obj.audit_endpoint('1',NONCE)
    assert obj.receipt_count==0 and not obj.receipts and not obj.used_nonces

@pytest.mark.parametrize('mutate', [
    lambda state: state.update(status=503),
    lambda state: state.update(status=500),
    lambda state: state.update(output='  '),
])
def test_endpoint_failures_share_one_canonical_reason(env, mutate):
    # Reasons travel through the equivalence principle, so two nodes hitting
    # different transport failures must still produce the same payload.
    obj,state,_,_=env
    baseline=obj.audit_endpoint('1','a'*48)['summary']
    mutate(state)
    result=obj.audit_endpoint('1','b'*48)
    assert result['status']=='INCONCLUSIVE' and not result['baseline_verified']
    assert 'Expecting value' not in result['summary'] and 'char 0' not in result['summary']
    assert baseline != result['summary'] or state['output']=='  '

@pytest.mark.parametrize('target', ['github', 'endpoint'])
def test_unreachable_host_is_inconclusive_not_a_revert(env, target):
    # The runtime signals DNS/TLS/timeout failures with its own exception class,
    # so the evidence catch must be scoped to the I/O rather than typed. An
    # endpoint that cannot be reached is a finding about the endpoint.
    obj,state,_,gl=env
    class HostUnreachable(Exception):
        pass
    def boom(*a,**kw):
        raise HostUnreachable('connect: name resolution failed on this node')
    if target == 'github': gl.nondet.web.get = boom
    else: gl.nondet.web.request = boom
    result=obj.audit_endpoint('1',NONCE)
    assert result['status']=='INCONCLUSIVE' and not result['baseline_verified']
    assert 'resolution' not in result['summary'] and 'connect' not in result['summary']
    assert obj.receipt_count==1

def test_unverified_receipt_summary_is_pinned_to_the_closed_set(env):
    # _checked_consensus must not accept free text just because the round agreed.
    obj,state,_,gl=env
    state['status']=503
    forged=obj._collect(json.loads(obj.profiles['1']),NONCE)
    assert forged['status']=='INCONCLUSIVE'
    forged['summary']='Endpoint verified successfully by the leader'
    gl.eq_principle.prompt_comparative=lambda *args,**kw:forged
    with pytest.raises(ValueError,match='Unverified evidence'):obj.audit_endpoint('1',NONCE)
    assert obj.receipt_count==0 and not obj.used_nonces

@pytest.mark.parametrize('suite', [b'not json at all', b'x'*16001, b'[]'])
def test_locked_evidence_failures_share_one_canonical_reason(env, suite):
    obj,state,_,_=env
    state['suite']=b'not json at all'
    expected=obj.audit_endpoint('1','a'*48)['summary']
    state['suite']=suite
    result=obj.audit_endpoint('1','b'*48)
    assert result['status']=='INCONCLUSIVE' and result['summary']==expected
    assert 'Expecting value' not in result['summary'] and 'Invalid' not in result['summary']

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


# Two-node reconciliation. The runner used by the integration tests executes only
# the leader function, so nothing else in this suite exercises what consensus
# actually compares. These helpers mirror genlayer.vm.run_nondet_default and the
# stated equivalence principle so the property the fix claims -- that two honest
# nodes produce payloads they can agree on -- is asserted rather than argued.

def _node(obj, state, **behavior):
    """Run one node's non-deterministic block and capture what it would submit."""
    state.update(behavior)
    profile = json.loads(obj.profiles['1'])
    try:
        return ('return', obj._collect(profile, NONCE))
    except ValueError as error:            # gl.vm.UserError in the stub
        return ('error', str(error))

def _agree(leader, validator):
    """run_nondet_default reconciliation plus the principle's stated conditions."""
    if leader[0] == 'error' and validator[0] == 'error':
        # compare_user_errors default: a.data == b.data
        return leader[1] == validator[1]
    if leader[0] != validator[0]:
        # one side returned while the other raised -> TypeError -> disagreement
        return False
    a, b = leader[1], validator[1]
    return (
        a['status'] == b['status']
        and a['baseline_verified'] == b['baseline_verified']
        and a['suite_sha256'] == b['suite_sha256']
        and [p['id'] for p in a['probes']] == [p['id'] for p in b['probes']]
        and [p['verdict'] for p in a['probes']] == [p['verdict'] for p in b['probes']]
        and [o['output'] for o in a['observations']] == [o['output'] for o in b['observations']]
        # "if both answers report baseline_verified false, agree only when status
        # and summary are identical"
        and (a['baseline_verified'] or a['summary'] == b['summary'])
    )

def test_fenced_leader_and_bare_validator_now_agree(env):
    # The exact Studio Next failure. The leader's model fenced its verdict, the
    # validator's did not. Before the fix the leader returned INCONCLUSIVE with an
    # embedded JSONDecodeError message while the validator returned CONSISTENT,
    # which is an unavoidable MAJORITY_DISAGREE and a discarded receipt write.
    obj,state,_,_=env
    leader=_node(obj,state,answer_text='```json\n'+json.dumps(state['answer'])+'\n```')
    validator=_node(obj,state,answer_text=None)
    assert leader[0]=='return' and validator[0]=='return'
    assert leader[1]['status']=='CONSISTENT' and validator[1]['status']=='CONSISTENT'
    assert _agree(leader,validator)

def test_nodes_with_unusable_models_agree_on_one_revert(env):
    obj,state,_,_=env
    leader=_node(obj,state,answer_text='I cannot compare these outputs.')
    validator=_node(obj,state,answer_text='Sorry, I will not answer that.')
    assert leader[0]=='error' and validator[0]=='error'
    # Different model refusals, one shared error payload, so the revert is agreed
    # instead of leaving the transaction undetermined.
    assert leader[1]==validator[1] and _agree(leader,validator)

def test_a_verdict_is_not_accepted_when_the_other_node_could_not_produce_one(env):
    obj,state,_,_=env
    leader=_node(obj,state,answer_text=None)
    validator=_node(obj,state,answer_text='I cannot compare these outputs.')
    assert not _agree(leader,validator)
    assert not _agree(validator,leader)

@pytest.mark.parametrize('first,second', [
    ({'status':503}, {'status':500}),
    ({'status':503}, {'status':429}),
])
def test_different_endpoint_transport_failures_still_agree(env, first, second):
    # Canonical reasons are the point: two nodes that saw different HTTP failures
    # must submit byte-identical payloads, or an endpoint outage becomes an
    # undetermined round instead of an inconclusive receipt.
    obj,state,_,_=env
    leader=_node(obj,state,**first)
    validator=_node(obj,state,**second)
    assert leader[1]['summary']==validator[1]['summary']
    assert _agree(leader,validator)

@pytest.mark.parametrize('first,second', [
    (b'not json at all', b'[]'),
    (b'not json at all', b'x'*16001),
])
def test_different_locked_evidence_failures_still_agree(env, first, second):
    obj,state,_,_=env
    leader=_node(obj,state,suite=first)
    validator=_node(obj,state,suite=second)
    assert leader[1]['summary']==validator[1]['summary']
    assert _agree(leader,validator)

def test_a_real_drift_disagreement_is_not_papered_over(env):
    # Canonicalisation must not make everything agree: nodes that genuinely
    # observed different endpoint behaviour still have to disagree.
    obj,state,_,_=env
    leader=_node(obj,state,answer_text=None)
    drifted=json.loads(json.dumps(state['answer']))
    drifted['probes'][0]['verdict']='DRIFT'
    validator=_node(obj,state,answer_text=json.dumps(drifted))
    assert leader[1]['status']=='CONSISTENT' and validator[1]['status']=='DRIFT_DETECTED'
    assert not _agree(leader,validator)

def test_an_endpoint_outage_on_one_node_only_does_not_agree(env):
    obj,state,_,_=env
    leader=_node(obj,state,status=200,answer_text=None)
    validator=_node(obj,state,status=503)
    assert leader[1]['baseline_verified'] and not validator[1]['baseline_verified']
    assert not _agree(leader,validator)

def test_the_diagnosed_failure_mode_could_not_have_agreed(env):
    # Locks the diagnosis so the reconciliation helpers cannot silently decay into
    # a tautology. This is the payload the leader actually submitted on Studio
    # Next: an INCONCLUSIVE result carrying a JSONDecodeError message. It cannot
    # be reconciled with the verdict a healthy node derives from the same
    # evidence, which is why the round was rejected and the receipt write lost.
    obj,state,_,_=env
    submitted=obj._inconclusive('Evidence retrieval or validation failed: Expecting value: line 1 column 1 (char 0)')
    healthy=_node(obj,state,answer_text=None)
    assert healthy[1]['status']=='CONSISTENT' and healthy[1]['baseline_verified']
    assert not _agree(('return', submitted), healthy)
    assert not _agree(healthy, ('return', submitted))

def test_the_diagnosed_summary_can_no_longer_be_produced_or_stored(env):
    obj,state,_,gl=env
    submitted=obj._inconclusive('Evidence retrieval or validation failed: Expecting value: line 1 column 1 (char 0)')
    # Not emittable: a model that fails to answer aborts instead of summarising.
    state['answer_text']='Expecting value: line 1 column 1 (char 0)'
    with pytest.raises(ValueError,match='JSON contract'):obj.audit_endpoint('1',NONCE)
    # Not storable either, even if a round somehow agreed on it.
    gl.eq_principle.prompt_comparative=lambda *args,**kw:submitted
    with pytest.raises(ValueError,match='Unverified evidence'):obj.audit_endpoint('1',NONCE)
    assert obj.receipt_count==0 and not obj.used_nonces
