import hashlib
import base64
import json
from pathlib import Path

def test_live_challenge_and_replay_in_genvm(direct_vm, direct_deploy_compat):
    sha='a'*40
    suite={'schema':'modelseal.probes.v2','probes':[{'id':'explain','prompt':'Explain idempotency.','rubric':'Repeat without duplicate effect.'}]}
    suite_raw=json.dumps(suite)
    baseline=json.dumps({'schema':'modelseal.baseline.v2','suite_sha256':hashlib.sha256(suite_raw.encode()).hexdigest(),'responses':{'explain':'Repeated requests have the same effect as one request.'}})
    nonce='c'*48
    suite_envelope=json.dumps({'type':'file','encoding':'base64','size':len(suite_raw.encode()),'content':base64.b64encode(suite_raw.encode()).decode()})
    baseline_envelope=json.dumps({'type':'file','encoding':'base64','size':len(baseline.encode()),'content':base64.b64encode(baseline.encode()).decode()})
    direct_vm.mock_web(r'.*api\.github\.com/repos/example/modelseal/contents/suite\.json\?ref=a{40}.*',{'status':200,'body':suite_envelope})
    direct_vm.mock_web(r'.*api\.github\.com/repos/example/modelseal/contents/baseline\.json\?ref=a{40}.*',{'status':200,'body':baseline_envelope})
    direct_vm.mock_web(r'.*agent\.acme\.com/challenge.*',{'method':'POST','status':200,'body':json.dumps({'nonce':nonce,'probe_id':'explain','output':'Repeating does not duplicate its effect.'})})
    direct_vm.mock_llm(r'.*Compare endpoint outputs.*',json.dumps(json.dumps({'summary':'Same behavior.','probes':[{'id':'explain','verdict':'MATCH','reason':'Equivalent effect.'}]})))
    c=direct_deploy_compat(str(Path(__file__).parents[2]/'contracts/modelseal.py'))
    c.register_endpoint('Agent','https://agent.acme.com/challenge','Declared',f'https://github.com/example/modelseal/blob/{sha}/suite.json',f'https://github.com/example/modelseal/blob/{sha}/baseline.json',hashlib.sha256(baseline.encode()).hexdigest())
    r=c.audit_endpoint('1',nonce)
    assert r['status']=='CONSISTENT',r['summary']
    assert r['baseline_verified'] and r['observations'][0]['probe_id']=='explain'
    assert c.get_counts()['receipts']==1
    import pytest
    with pytest.raises(Exception,match='Nonce already used'):
        c.audit_endpoint('1',nonce)

def test_tampered_baseline_in_genvm(direct_vm,direct_deploy_compat):
    sha='a'*40
    empty=json.dumps({'type':'file','encoding':'base64','size':2,'content':base64.b64encode(b'{}').decode()})
    direct_vm.mock_web(r'.*api\.github\.com/repos/.*',{'status':200,'body':empty})
    c=direct_deploy_compat(str(Path(__file__).parents[2]/'contracts/modelseal.py'))
    c.register_endpoint('Agent','https://agent.acme.com/challenge','Declared',f'https://github.com/example/modelseal/blob/{sha}/suite.json',f'https://github.com/example/modelseal/blob/{sha}/baseline.json','b'*64)
    result=c.audit_endpoint('1','c'*48)
    assert result['status']=='INCONCLUSIVE' and not result['baseline_verified']
