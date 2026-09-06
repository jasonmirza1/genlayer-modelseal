'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowUpRight, CheckCircle2, ChevronRight, CircleDot, Clock3, Fingerprint, GitCommitHorizontal, Network, Play, Plus, Radar, ShieldCheck, TerminalSquare, TriangleAlert, Wallet } from 'lucide-react';

type EthereumProvider = {
  isOkxWallet?: boolean;
  providers?: EthereumProvider[];
  request: (args:{method:string;params?:unknown[]})=>Promise<unknown>;
  on?: (event:string,handler:(value:unknown)=>void)=>void;
  removeListener?: (event:string,handler:(value:unknown)=>void)=>void;
};
declare global { interface Window { ethereum?:EthereumProvider; okxwallet?:EthereumProvider } }

type AuditStatus = 'CONSISTENT' | 'DRIFT_DETECTED' | 'INCONCLUSIVE';
const audits: Array<{ id:string; endpoint:string; claim:string; status:AuditStatus; score:number; time:string }> = [
  { id:'MS-0042', endpoint:'api.nova-agent.dev', claim:'Nova 72B · v3.1', status:'CONSISTENT', score:94, time:'12 min ago' },
  { id:'MS-0041', endpoint:'inference.orbit.ai', claim:'Orbit Reasoner · r8', status:'DRIFT_DETECTED', score:41, time:'2 hr ago' },
  { id:'MS-0040', endpoint:'gateway.kinetic.xyz', claim:'Kinetic Tool · 2.4', status:'INCONCLUSIVE', score:58, time:'Yesterday' },
];
const probeRows = [
  { label:'Tool schema adherence', baseline:'0.96', observed:'0.95' }, { label:'Reasoning capability', baseline:'0.89', observed:'0.87' },
  { label:'Context retention', baseline:'0.92', observed:'0.91' }, { label:'Safety boundary', baseline:'0.98', observed:'0.97' },
];
const statusTone: Record<AuditStatus,string> = { CONSISTENT:'status good', DRIFT_DETECTED:'status bad', INCONCLUSIVE:'status warn' };

export default function Home() {
  const [running,setRunning]=useState(false); const [finished,setFinished]=useState(false); const [selected,setSelected]=useState(audits[0].id);
  const [account,setAccount]=useState(''); const [chainId,setChainId]=useState(''); const [walletError,setWalletError]=useState(''); const [connecting,setConnecting]=useState(false);
  const selectedAudit=useMemo(()=>audits.find(a=>a.id===selected)??audits[0],[selected]);
  function runAudit(){setRunning(true);setFinished(false);window.setTimeout(()=>{setRunning(false);setFinished(true)},1300)}
  function getProvider(){return window.okxwallet??window.ethereum?.providers?.find(provider=>provider.isOkxWallet)??window.ethereum}
  async function connectWallet(){
    const provider=getProvider(); setWalletError('');
    if(!provider){setWalletError('Install OKX Wallet or another EVM wallet.');return}
    setConnecting(true);
    try{
      const accounts=await provider.request({method:'eth_requestAccounts'}) as string[];
      let activeChain=await provider.request({method:'eth_chainId'}) as string;
      if(parseInt(activeChain,16)!==4221){
        try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x107D'}]})}
        catch(error){
          if((error as {code?:number}).code!==4902)throw error;
          await provider.request({method:'wallet_addEthereumChain',params:[{chainId:'0x107D',chainName:'GenLayer Bradbury',nativeCurrency:{name:'GEN',symbol:'GEN',decimals:18},rpcUrls:['https://rpc-bradbury.genlayer.com'],blockExplorerUrls:['https://explorer-bradbury.genlayer.com']}]});
        }
        activeChain=await provider.request({method:'eth_chainId'}) as string;
      }
      setAccount(accounts[0]??''); setChainId(activeChain);
    }catch(error){setWalletError(error instanceof Error?error.message:'Wallet connection was rejected.')}finally{setConnecting(false)}
  }
  useEffect(()=>{
    const provider=getProvider(); if(!provider)return;
    const accountsChanged=(value:unknown)=>setAccount(((value as string[])?.[0])??'');
    const chainChanged=(value:unknown)=>setChainId(String(value));
    provider.on?.('accountsChanged',accountsChanged); provider.on?.('chainChanged',chainChanged);
    void Promise.all([provider.request({method:'eth_accounts'}),provider.request({method:'eth_chainId'})]).then(([accounts,chain])=>{setAccount(((accounts as string[])?.[0])??'');setChainId(String(chain))}).catch(()=>undefined);
    return()=>{provider.removeListener?.('accountsChanged',accountsChanged);provider.removeListener?.('chainChanged',chainChanged)};
  },[]);
  useEffect(()=>{
    const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options?:{signal:AbortSignal})=>void|Promise<void>}}).modelContext;
    if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    void Promise.resolve(context.registerTool({
      name:'start_endpoint_audit',title:'Start endpoint audit',description:'Run the visible ModelSeal capability and behavioral drift audit for the selected endpoint.',
      inputSchema:{type:'object',properties:{profileId:{type:'string'}},required:['profileId'],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      execute:(input:unknown)=>{const value=input as {profileId?:unknown};if(value?.profileId!=='MS-0042')throw new Error('Unknown endpoint profile');runAudit();return {profileId:'MS-0042',status:'audit_started'}},
    },{signal:lifecycle.signal})).catch(()=>undefined);
    return()=>lifecycle.abort();
  },[]);
  const currentStatus:AuditStatus=finished?'CONSISTENT':selectedAudit.status; const currentScore=finished?96:selectedAudit.score;
  return <main className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark"><Fingerprint size={19}/></span><span>MODELSEAL</span></div>
      <nav aria-label="Primary navigation"><button className="nav-item active"><Radar size={17}/> Audit console</button><button className="nav-item"><Network size={17}/> Endpoints <span>03</span></button><button className="nav-item"><Fingerprint size={17}/> Probe suites</button><button className="nav-item"><Activity size={17}/> History</button></nav>
      <div className="sidebar-foot"><div className="network-dot"><i className={chainId&&parseInt(chainId,16)!==4221?'wrong-network':''}/> {chainId&&parseInt(chainId,16)!==4221?'Wrong network':'Bradbury Testnet'}</div>{account?<button className="wallet connected" onClick={connectWallet}><Wallet size={14}/>{account.slice(0,5)}…{account.slice(-4)}</button>:<button className="wallet" onClick={connectWallet} disabled={connecting}><Wallet size={14}/>{connecting?'Connecting…':'Connect wallet'}</button>}{walletError&&<small className="wallet-error">{walletError}</small>}</div></aside>
    <section className="workspace"><header className="topbar"><div><p className="eyebrow">Endpoint assurance</p><h1>Audit console</h1></div><button className="secondary"><Plus size={16}/> Register endpoint</button></header>
      <div className="metric-grid"><article><span>Monitored endpoints</span><strong>03</strong><small><i className="live-dot"/> All reachable</small></article><article><span>Audits this epoch</span><strong>42</strong><small>Epoch 141 · 68% complete</small></article><article><span>Consistency rate</span><strong>91.4%</strong><small className="up">↑ 2.8% over 7 days</small></article><article className="alert-metric"><span>Open drift signals</span><strong>01</strong><small>Review required</small></article></div>
      <div className="main-grid"><section className="panel audit-panel"><div className="panel-head"><div><p className="eyebrow">New verification</p><h2>Run probe suite</h2></div><span className="suite-lock"><GitCommitHorizontal size={14}/> suite@8f31c2a</span></div>
        <div className="form-grid"><label>Registered endpoint<select defaultValue="nova"><option value="nova">Nova Research Agent</option><option value="orbit">Orbit Procurement Agent</option></select></label><label>Claimed model<input defaultValue="Nova 72B · v3.1"/></label><label className="wide">Public inference URL<input defaultValue="https://api.nova-agent.dev/v1/respond"/></label></div>
        <div className="probe-summary"><div><TerminalSquare size={18}/><span><strong>Capability + behavior suite</strong><small>12 nonce-bound probes · deterministic rubric · comparative consensus</small></span></div><ChevronRight size={17}/></div>
        <button className="run-button" onClick={runAudit} disabled={running}>{running?<><span className="spinner"/>Collecting validator evidence…</>:<><Play size={16} fill="currentColor"/>{finished?'Run again':'Start consensus audit'}</>}</button><p className="form-note">No credentials are stored. The endpoint must be publicly reachable for validators.</p></section>
        <section className="panel result-panel"><div className="panel-head"><div><p className="eyebrow">Latest attestation</p><h2>{finished?'New result':selectedAudit.id}</h2></div><span className={statusTone[currentStatus]}><CircleDot size={13}/>{currentStatus.replace('_',' ')}</span></div>
          <div className="score-ring" style={{'--score':`${currentScore}%`} as React.CSSProperties}><div><strong>{currentScore}</strong><span>/100</span></div></div><h3>{currentStatus==='CONSISTENT'?'Endpoint behavior matches the registered baseline':currentStatus==='DRIFT_DETECTED'?'Material capability drift detected':'Evidence did not reach agreement'}</h3><p className="result-copy">Validators agreed on capability coverage and behavioral similarity. This is an audit signal, not proof of the underlying model weights.</p><div className="result-meta"><span><ShieldCheck size={15}/> 5 / 5 validators</span><span><Clock3 size={15}/> 18.4 sec</span></div><a href="#evidence">View evidence packet <ArrowUpRight size={14}/></a></section></div>
      <section className="panel history-panel" id="evidence"><div className="panel-head"><div><p className="eyebrow">Onchain record</p><h2>Recent audits</h2></div><button className="text-button">View all <ChevronRight size={15}/></button></div><div className="table-wrap"><table><thead><tr><th>Audit</th><th>Endpoint</th><th>Claim</th><th>Result</th><th>Confidence</th><th>Time</th></tr></thead><tbody>{audits.map(a=><tr key={a.id} className={selected===a.id?'selected-row':''} onClick={()=>setSelected(a.id)}><td className="mono">{a.id}</td><td>{a.endpoint}</td><td>{a.claim}</td><td><span className={statusTone[a.status]}>{a.status==='CONSISTENT'?<CheckCircle2 size={13}/>:<TriangleAlert size={13}/>} {a.status.replace('_',' ')}</span></td><td>{a.score}%</td><td>{a.time}</td></tr>)}</tbody></table></div></section>
      <section className="panel probe-panel"><div className="panel-head"><div><p className="eyebrow">Evidence detail</p><h2>Probe comparison</h2></div><span className="mono subtle">nonce 7D4A…91C2</span></div><div className="probe-list">{probeRows.map(r=><div className="probe-row" key={r.label}><span>{r.label}</span><div className="bar"><i style={{width:`${Number(r.observed)*100}%`}}/></div><span className="mono">{r.baseline}</span><span className="mono observed">{r.observed}</span><CheckCircle2 size={15}/></div>)}</div></section>
    </section></main>;
}
