'use client';
/* oxlint-disable react/react-compiler -- browser wallet and finalized-chain state are synchronized by effects */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Fingerprint,
  Wallet,
  LogOut,
  RefreshCw,
  Plus,
  Play,
  Download,
} from 'lucide-react';
import {
  createTransactionKit,
  type TransactionKit,
} from '@genlayer/transaction-kit';
import {
  GenLayerTransactionPanel,
  type SubmitInput,
  type TrackedStatus,
} from '@genlayer/transaction-kit-react';
import {
  read,
  isAddress,
  consensusOutcome,
  describeOutcome,
  EXPLORER,
  NETWORK,
  STUDIO_NEXT_CHAIN,
  STUDIO_NEXT_CHAIN_ID,
} from '@/lib/chain';
import {
  PENDING_KEY,
  loadPending,
  protectTransactions,
  executed,
  // `verified` is already a contract-load flag in this component.
  verified as outcomeResolved,
  settled,
  type PendingRecord,
} from '@/lib/transaction-safety';

type Injected = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isOkxWallet?: boolean;
  providers?: Injected[];
  on?: (event: string, handler: (v: unknown) => void) => void;
  removeListener?: (event: string, handler: (v: unknown) => void) => void;
};
declare global {
  interface Window {
    ethereum?: Injected;
    okxwallet?: Injected;
  }
}
type Profile = {
  id: string;
  owner: string;
  name: string;
  endpoint: string;
  claimed_model: string;
  probe_suite_url: string;
  baseline_url: string;
  baseline_digest: string;
  active: boolean;
};
type Receipt = {
  id: string;
  profile_id: string;
  status: string;
  summary: string;
  nonce: string;
  probes: { id: string; verdict: string; reason: string }[];
  observations: unknown[];
};
const tabs = ['Audit console', 'Endpoints', 'Probe suites', 'History'] as const;
function getProvider() {
  return (
    window.okxwallet ??
    window.ethereum?.providers?.find((p) => p.isOkxWallet) ??
    window.ethereum
  );
}
function errorText(e: unknown) {
  return e && typeof e === 'object' && 'message' in e
    ? String(e.message)
    : 'Request failed. Check the wallet or explorer before retrying.';
}
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [tab, setTab] = useState<(typeof tabs)[number]>('Audit console');
  const [account, setAccount] = useState('');
  const [chain, setChain] = useState('');
  const [walletBusy, setWalletBusy] = useState(false);
  const [address, setAddress] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [verified, setVerified] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [counts, setCounts] = useState({ profiles: 0, receipts: 0 });
  const [profileOffset, setProfileOffset] = useState(0);
  const [receiptOffset, setReceiptOffset] = useState(0);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<Receipt | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [register, setRegister] = useState(false);
  const [pendingTx, setPendingTx] = useState<{
    label: string;
    tx: SubmitInput;
    kit: TransactionKit;
  } | null>(null);
  const [pendingRecord, setPendingRecord] = useState<PendingRecord | null>(
    null,
  );
  const [recoveryError, setRecoveryError] = useState('');
  const [checking, setChecking] = useState(false);
  const [provider, setProvider] = useState<Injected | undefined>(undefined);
  const providerRef = useRef<Injected | undefined>(undefined);
  const disconnected = useRef(false);
  const generation = useRef(0);
  const readGeneration = useRef(0);
  const selectedProfile = profiles.find((p) => p.id === selected);
  const ready =
    verified &&
    !!account &&
    parseInt(chain, 16) === STUDIO_NEXT_CHAIN_ID &&
    !busy &&
    !pendingTx &&
    !pendingRecord &&
    !recoveryError;

  useEffect(() => {
    // Initialization intentionally synchronizes persisted browser state once.
    // oxlint-disable-next-line react/react-compiler
    const saved =
      localStorage.getItem('modelseal.contract.studio-next') ??
      process.env.NEXT_PUBLIC_MODELSEAL_ADDRESS ??
      '0xA861e33d618E0B28429872f1743021dae57548b8';
    if (isAddress(saved)) {
      setAddress(saved);
      setAddressInput(saved);
    }
    disconnected.current =
      localStorage.getItem('modelseal.wallet.disconnected') === '1';
    try {
      setPendingRecord(loadPending(localStorage));
    } catch (e) {
      setRecoveryError(errorText(e));
    }
    const p = getProvider();
    providerRef.current = p;
    setProvider(p);
  }, []);
  useEffect(() => {
    const p = provider;
    if (!p) return;
    let active = true;
    const token = generation.current;
    const accounts = (v: unknown) => {
      if (active && !disconnected.current)
        setAccount(Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '');
    };
    const chains = (v: unknown) => setChain(String(v));
    p.on?.('accountsChanged', accounts);
    p.on?.('chainChanged', chains);
    void p
      .request({ method: 'eth_accounts' })
      .then((v) => {
        if (generation.current === token) accounts(v);
      })
      .catch(() => {});
    void p
      .request({ method: 'eth_chainId' })
      .then(chains)
      .catch(() => {});
    return () => {
      active = false;
      p.removeListener?.('accountsChanged', accounts);
      p.removeListener?.('chainChanged', chains);
    };
  }, [provider]);
  async function connect() {
    setError('');
    setWalletBusy(true);
    const token = ++generation.current;
    try {
      const p = getProvider();
      if (!p)
        throw new Error(
          'Open this site in the OKX wallet browser or install an EVM wallet extension.',
        );
      providerRef.current = p;
      setProvider(p);
      const accounts = (await p.request({
        method: 'eth_requestAccounts',
      })) as string[];
      if (token !== generation.current) return;
      if (!accounts[0]) throw new Error('Wallet returned no account.');
      disconnected.current = false;
      localStorage.removeItem('modelseal.wallet.disconnected');
      setAccount(accounts[0]);
      await switchNetwork();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWalletBusy(false);
    }
  }
  async function switchNetwork() {
    const p = providerRef.current;
    if (!p) return;
    try {
      await p.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: NETWORK.chainId }],
      });
    } catch (e) {
      if ((e as { code?: number }).code !== 4902) throw e;
      await p.request({ method: 'wallet_addEthereumChain', params: [NETWORK] });
      await p.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: NETWORK.chainId }],
      });
    }
    setChain(String(await p.request({ method: 'eth_chainId' })));
  }
  async function disconnect() {
    ++generation.current;
    disconnected.current = true;
    localStorage.setItem('modelseal.wallet.disconnected', '1');
    setAccount('');
    setWalletBusy(true);
    setError('');
    try {
      await providerRef.current?.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      });
    } catch {
      setNotice(
        'Disconnected from ModelSeal. You can also remove site permission in your wallet settings.',
      );
    } finally {
      setWalletBusy(false);
    }
  }
  const refresh = useCallback(async () => {
    const token = ++readGeneration.current;
    if (!isAddress(address)) {
      setBusy(false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const c = (await read(address, 'get_counts')) as {
        profiles: number;
        receipts: number;
        version: string;
      };
      if (
        !c ||
        c.version !== '2' ||
        !Number.isSafeInteger(c.profiles) ||
        !Number.isSafeInteger(c.receipts) ||
        c.profiles < 0 ||
        c.receipts < 0
      )
        throw new Error(
          'This address is not a ModelSeal v2 deployment. Deploy the corrected contract first.',
        );
      const [p, r] = await Promise.all([
        read(address, 'list_profiles', [profileOffset, 20]),
        read(address, 'list_receipts', [receiptOffset, 20]),
      ]);
      if (token !== readGeneration.current) return;
      if (!Array.isArray(p) || !Array.isArray(r))
        throw new Error('Invalid finalized contract page.');
      setCounts(c);
      setProfiles(p as Profile[]);
      setReceipts(r as Receipt[]);
      setVerified(true);
      setSelected((old) =>
        (p as Profile[]).some((x) => x.id === old)
          ? old
          : ((p as Profile[])[0]?.id ?? ''),
      );
    } catch (e) {
      if (token !== readGeneration.current) return;
      setVerified(false);
      setProfiles([]);
      setReceipts([]);
      setCounts({ profiles: 0, receipts: 0 });
      setDetail(null);
      setError(errorText(e));
    } finally {
      if (token === readGeneration.current) setBusy(false);
    }
  }, [address, profileOffset, receiptOffset]);
  useEffect(() => {
    // Contract/page changes invalidate the prior finalized-state snapshot.
    const tracker = readGeneration;
    // oxlint-disable-next-line react/react-compiler
    setVerified(false);
    setDetail(null);
    void refresh();
    return () => {
      ++tracker.current;
    };
  }, [refresh]);
  const recordChanged = useCallback((record: PendingRecord | null) => {
    setPendingRecord(record);
    if (!record || !settled(record.status)) return;
    // A finalized status is not a result. Report nothing until the consensus
    // round outcome is known, then report exactly what the round decided.
    const outcome = record.outcome;
    if (!outcome) {
      setNotice(
        'Consensus finished. Confirming whether the round was accepted before reporting a result.',
      );
      return;
    }
    if (outcome.applied) {
      setError('');
      setNotice(
        'Consensus accepted the round and applied the write. Refresh finalized state to inspect the result.',
      );
      return;
    }
    setNotice('');
    setError(
      `${describeOutcome(outcome)} Status ${outcome.statusName || 'unknown'}, round outcome ${outcome.outcome || 'unknown'}, leader execution ${outcome.executionResultName || 'unknown'}. Inspect the explorer before retrying.`,
    );
  }, []);
  function prepareWrite(label: string, method: string, args: string[]) {
    const p = providerRef.current;
    if (!ready || !p || !isAddress(address)) return;
    setError('');
    setNotice('Review the Studio Next fee quote before signing.');
    setPendingTx({
      label,
      kit: protectTransactions(
        (guardedProvider) =>
          createTransactionKit({
            chain: STUDIO_NEXT_CHAIN,
            provider: guardedProvider,
            account: account as `0x${string}`,
          }),
        p,
        { label, address, account, chainId: STUDIO_NEXT_CHAIN_ID },
        localStorage,
        recordChanged,
        () => !disconnected.current && providerRef.current === p,
        consensusOutcome,
      ),
      tx: {
        kind: 'write',
        address: address as `0x${string}`,
        method,
        args,
      },
    });
  }
  async function checkPending() {
    if (!pendingRecord?.genlayerTxId || checking) return;
    setChecking(true);
    try {
      const outcome = await consensusOutcome(pendingRecord.genlayerTxId);
      const canceled = outcome.statusName === 'CANCELED';
      const status: TrackedStatus = {
        phase: canceled ? 'decided' : outcome.settled ? 'finalized' : 'pending',
        statusName: outcome.statusName,
        genlayerTxId: pendingRecord.genlayerTxId,
        executionResultName: outcome.executionResultName,
        // `successful` here means the round was accepted and applied, not merely
        // that the leader returned a value.
        ...(outcome.settled ? { successful: outcome.applied } : {}),
      };
      const next: PendingRecord = {
        ...pendingRecord,
        stage: settled(status) ? 'finalized' : 'submitted',
        status,
        ...(outcome.settled ? { outcome } : {}),
      };
      localStorage.setItem(PENDING_KEY, JSON.stringify(next));
      recordChanged(next);
      if (outcome.settled) await refresh();
    } catch (e) {
      setError(
        `Could not confirm the transaction: ${errorText(e)} Do not resubmit blindly.`,
      );
    } finally {
      setChecking(false);
    }
  }
  function clearRecovery() {
    // An unresolved round outcome is not the same as a confirmed discarded
    // write, so dropping a record we could not check needs acknowledgement too.
    if (
      (!settled(pendingRecord?.status) || !outcomeResolved(pendingRecord)) &&
      !window.confirm(
        'Only clear this record after checking your wallet activity, explorer and finalized contract state. A pending transaction can still execute, and a finalized one can still have been discarded by consensus. Have you checked?',
      )
    )
      return;
    localStorage.removeItem(PENDING_KEY);
    setPendingRecord(null);
    setPendingTx(null);
    setRecoveryError('');
  }
  function applyAddress() {
    if (!isAddress(addressInput.trim())) {
      setError('Enter a valid deployed contract address.');
      return;
    }
    localStorage.setItem('modelseal.contract.studio-next', addressInput.trim());
    setProfiles([]);
    setReceipts([]);
    setDetail(null);
    setCounts({ profiles: 0, receipts: 0 });
    setAddress(addressInput.trim());
    setProfileOffset(0);
    setReceiptOffset(0);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Fingerprint size={19} />
          </span>
          <span>MODELSEAL</span>
        </div>
        <nav aria-label="Primary navigation">
          {tabs.map((t) => (
            <button
              key={t}
              className={`nav-item ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div>
            {account
              ? parseInt(chain, 16) === STUDIO_NEXT_CHAIN_ID
                ? 'Studio Next connected'
                : 'Wrong network'
              : 'Wallet disconnected'}
          </div>
          {account ? (
            <>
              <div className="wallet connected" title={account}>
                <Wallet size={14} />
                {account.slice(0, 6)}…{account.slice(-4)}
              </div>
              {parseInt(chain, 16) !== STUDIO_NEXT_CHAIN_ID && (
                <button
                  className="wallet"
                  onClick={() =>
                    void switchNetwork().catch((e) => setError(errorText(e)))
                  }
                >
                  Switch to Studio Next
                </button>
              )}
              <button
                className="disconnect"
                disabled={walletBusy}
                onClick={() => void disconnect()}
              >
                <LogOut size={14} />
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="wallet"
              disabled={walletBusy}
              onClick={() => void connect()}
            >
              <Wallet size={14} />
              {walletBusy ? 'Please wait…' : 'Connect wallet'}
            </button>
          )}
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Endpoint assurance · v2</p>
            <h1>{tab}</h1>
          </div>
          <button
            className="secondary"
            onClick={() => {
              setRegister(!register);
              setTab('Endpoints');
            }}
          >
            <Plus size={16} />
            {register ? 'Close registration' : 'Register endpoint'}
          </button>
        </header>
        <section className="panel configuration">
          <label htmlFor="contract">Studio Next ModelSeal contract</label>
          <div className="inline-form">
            <input
              id="contract"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder="0x… deployed contract address"
              disabled={busy || !!pendingTx}
            />
            <button
              className="secondary"
              onClick={applyAddress}
              disabled={busy || !!pendingTx}
            >
              Load contract
            </button>
            <button
              className="secondary"
              disabled={!address || busy}
              onClick={() => void refresh()}
              aria-label="Refresh finalized state"
            >
              <RefreshCw size={16} />
            </button>
          </div>
          <p className="subtle">
            {verified
              ? 'Reading finalized state on Studio Next.'
              : address
                ? 'Waiting for a verified v2 deployment.'
                : 'Contract deployment required. No audit results or activity are fabricated.'}{' '}
            {address && (
              <a
                href={`${EXPLORER}/address/${address}`}
                target="_blank"
                rel="noreferrer"
              >
                Explorer ↗
              </a>
            )}
          </p>
        </section>
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
        {notice && <output className="message">{notice}</output>}
        {(pendingRecord || recoveryError) && (
          <section
            className="panel configuration"
            aria-label="Transaction recovery"
          >
            <h2>Transaction recovery</h2>
            <p>
              {recoveryError ||
                `${pendingRecord!.label} · ${pendingRecord!.status?.statusName ?? pendingRecord!.stage}`}
            </p>
            {pendingRecord?.outcome && (
              <p>
                {describeOutcome(pendingRecord.outcome)} Round outcome:{' '}
                <code>{pendingRecord.outcome.outcome || 'unknown'}</code> · leader
                execution:{' '}
                <code>
                  {pendingRecord.outcome.executionResultName || 'unknown'}
                </code>
              </p>
            )}
            {pendingRecord &&
              settled(pendingRecord.status) &&
              !pendingRecord.outcome && (
                <p className="subtle">
                  The consensus round outcome is not resolved yet. Use “Check
                  recorded transaction”: a finalized status alone does not prove
                  the write was applied.
                </p>
              )}
            {pendingRecord && (
              <>
                <p className="subtle">
                  Wallet: {pendingRecord.account}
                  <br />
                  Contract: {pendingRecord.address}
                </p>
                <p>
                  {pendingRecord.genlayerTxId ? (
                    <a
                      href={`${EXPLORER}/tx/${pendingRecord.genlayerTxId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open recorded transaction ↗
                    </a>
                  ) : (
                    'Submission outcome is not confirmed. Check your wallet activity and contract explorer before retrying.'
                  )}
                </p>
                {pendingRecord.evmTxHash && (
                  <p className="subtle">
                    Chain transaction: {pendingRecord.evmTxHash}
                  </p>
                )}
              </>
            )}
            <p>
              Reloading never resubmits a transaction. Other writes stay
              disabled until you resolve this record.
            </p>
            <div className="inline-form">
              <button
                className="secondary"
                disabled={
                  !pendingRecord?.genlayerTxId ||
                  checking ||
                  (!!pendingTx &&
                    pendingRecord?.stage !== 'unknown' &&
                    !settled(pendingRecord?.status))
                }
                onClick={() => void checkPending()}
              >
                {checking ? 'Checking…' : 'Check recorded transaction'}
              </button>
              <button
                className="secondary"
                disabled={
                  checking ||
                  (!settled(pendingRecord?.status) &&
                    (!!pendingRecord?.genlayerTxId ||
                      (!!pendingTx && pendingRecord?.stage !== 'unknown')))
                }
                onClick={clearRecovery}
              >
                {!settled(pendingRecord?.status)
                  ? 'Clear after manual verification'
                  : !outcomeResolved(pendingRecord)
                    ? 'Clear unconfirmed outcome'
                    : executed(pendingRecord)
                      ? 'Dismiss applied transaction'
                      : 'Dismiss unapplied transaction'}
              </button>
            </div>
          </section>
        )}
        {pendingTx && (
          <section className="panel configuration">
            <div className="transaction-heading">
              <div>
                <p className="eyebrow">Studio Next transaction</p>
                <h2>{pendingTx.label}</h2>
              </div>
              <button
                className="secondary"
                disabled={pendingRecord?.stage === 'signing'}
                onClick={() => setPendingTx(null)}
              >
                {pendingRecord ? 'Hide fee panel' : 'Close unsigned review'}
              </button>
            </div>
            <GenLayerTransactionPanel
              kit={pendingTx.kit}
              tx={pendingTx.tx}
              network="GenLayer Studio Next"
              theme="dark"
              trackUntil="finalized"
            />
            <p className="subtle">
              The fee panel reports the transaction status and the leader’s
              execution result. Neither proves that validators accepted the round:
              a rejected round still finalizes and still discards every state
              change. ModelSeal resolves the round outcome itself and reports it
              above, so treat this panel’s wording as progress, not as a result.
            </p>
          </section>
        )}
        <div className="metric-grid">
          <article>
            <span>Finalized endpoints</span>
            <strong>{verified ? counts.profiles : '—'}</strong>
            <small>Contract state</small>
          </article>
          <article>
            <span>Finalized receipts</span>
            <strong>{verified ? counts.receipts : '—'}</strong>
            <small>Includes inconclusive audits</small>
          </article>
          <article>
            <span>Loaded receipt page</span>
            <strong>{receipts.length}</strong>
            <small>Up to 20 records per page</small>
          </article>
          <article>
            <span>Wallet</span>
            <strong style={{ fontSize: 18 }}>
              {account ? 'Connected' : 'Disconnected'}
            </strong>
            <small>Transactions require your approval</small>
          </article>
        </div>
        {register && (
          <section className="panel configuration">
            <h2>Register an endpoint</h2>
            <p>
              Use a public endpoint implementing the ModelSeal challenge
              protocol. The baseline is the operator’s declared reference, not
              proof of model identity.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                prepareWrite(
                  'Register endpoint',
                  'register_endpoint',
                  [
                    'name',
                    'endpoint',
                    'claimed_model',
                    'probe_suite_url',
                    'baseline_url',
                    'baseline_digest',
                  ].map((k) => {
                    const value = f.get(k);
                    return typeof value === 'string' ? value : '';
                  }),
                );
              }}
            >
              <div className="form-grid">
                {[
                  ['name', 'Endpoint name'],
                  ['claimed_model', 'Claimed model'],
                  ['endpoint', 'Public HTTPS challenge endpoint'],
                  ['probe_suite_url', 'GitHub probe suite · full commit SHA'],
                  ['baseline_url', 'GitHub baseline · full commit SHA'],
                  ['baseline_digest', 'Baseline SHA-256 · exact file bytes'],
                ].map(([name, label]) => (
                  <label key={name}>
                    {label}
                    <input
                      name={name}
                      required
                      maxLength={name === 'baseline_digest' ? 64 : 500}
                      pattern={
                        name === 'baseline_digest' ? '[a-f0-9]{64}' : undefined
                      }
                    />
                  </label>
                ))}
              </div>
              <button className="run-button" disabled={!ready} type="submit">
                {busy ? 'Waiting…' : 'Register with wallet'}
              </button>
            </form>
            <p className="subtle">
              Connect your wallet, load the contract and switch to Studio Next
              to enable registration.
            </p>
          </section>
        )}
        {tab === 'Audit console' && (
          <section className="panel configuration">
            <h2>Run a live audit</h2>
            <p>
              Validators fetch the immutable probe suite and baseline, then POST
              each challenge directly to the endpoint. Responses must echo the
              nonce and probe ID.
            </p>
            <label htmlFor="profile">Finalized endpoint</label>
            <select
              id="profile"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Select endpoint</option>
              {profiles
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · #{p.id}
                  </option>
                ))}
            </select>
            {selectedProfile && (
              <p>
                {selectedProfile.claimed_model}
                <br />
                <a
                  href={selectedProfile.endpoint}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selectedProfile.endpoint}
                </a>
              </p>
            )}
            <button
              className="run-button"
              disabled={!ready || !selectedProfile?.active}
              onClick={() => {
                const bytes = crypto.getRandomValues(new Uint8Array(24));
                prepareWrite('Run live endpoint audit', 'audit_endpoint', [
                  selected,
                  [...bytes]
                    .map((b) => b.toString(16).padStart(2, '0'))
                    .join(''),
                ]);
              }}
            >
              <Play size={16} />
              {busy ? 'Waiting for wallet…' : 'Submit live audit'}
            </button>
            <p className="subtle">
              No simulated confidence, validator counts or timing. Read the
              resulting receipt after finalization.
            </p>
          </section>
        )}
        {tab === 'Endpoints' && (
          <section className="panel configuration">
            <h2>Registered endpoints</h2>
            {profiles.length === 0 ? (
              <p>
                No endpoints loaded. Register one after deploying the Studio
                Next contract.
              </p>
            ) : (
              profiles.map((p) => (
                <article className="record" key={p.id}>
                  <h3>
                    {p.name} · #{p.id} · {p.active ? 'Active' : 'Inactive'}
                  </h3>
                  <p>
                    {p.claimed_model}
                    <br />
                    {p.endpoint}
                  </p>
                  <small>Owner: {p.owner}</small>
                  <div className="inline-form">
                    <button
                      className="secondary"
                      onClick={() => {
                        setSelected(p.id);
                        setTab('Audit console');
                      }}
                    >
                      Select for audit
                    </button>
                    {p.active &&
                      account.toLowerCase() === p.owner.toLowerCase() && (
                        <button
                          className="secondary"
                          disabled={!ready}
                          onClick={() =>
                            prepareWrite(
                              'Deactivate endpoint',
                              'deactivate_endpoint',
                              [p.id],
                            )
                          }
                        >
                          Deactivate with wallet
                        </button>
                      )}
                  </div>
                </article>
              ))
            )}
            <div className="inline-form">
              <button
                disabled={profileOffset === 0 || busy}
                onClick={() =>
                  setProfileOffset(Math.max(0, profileOffset - 20))
                }
              >
                Previous
              </button>
              <button
                disabled={profileOffset + 20 >= counts.profiles || busy}
                onClick={() => setProfileOffset(profileOffset + 20)}
              >
                Next
              </button>
            </div>
          </section>
        )}
        {tab === 'Probe suites' && (
          <section className="panel configuration">
            <h2>Immutable suites and baselines</h2>
            <p>
              Each suite contains 1–4 executable prompts and comparison rubrics.
              The baseline binds the exact suite bytes with SHA-256.
            </p>
            <a
              href="https://github.com/jasonmirza1/genlayer-modelseal/tree/main/probe-suites"
              target="_blank"
              rel="noreferrer"
            >
              Protocol and example suites ↗
            </a>
            {profiles.map((p) => (
              <article className="record" key={p.id}>
                <h3>{p.name}</h3>
                <p>
                  <a href={p.probe_suite_url} target="_blank" rel="noreferrer">
                    Locked suite ↗
                  </a>{' '}
                  ·{' '}
                  <a href={p.baseline_url} target="_blank" rel="noreferrer">
                    Locked baseline ↗
                  </a>
                </p>
                <code>{p.baseline_digest}</code>
              </article>
            ))}
          </section>
        )}
        {(tab === 'History' || tab === 'Audit console') && (
          <section className="panel configuration">
            <h2>Finalized audit receipts</h2>
            {receipts.length === 0 ? (
              <p>No finalized receipts loaded.</p>
            ) : (
              receipts.map((r) => (
                <button
                  className="receipt-row"
                  key={r.id}
                  onClick={() => setDetail(r)}
                >
                  <span>
                    #{r.id} · endpoint #{r.profile_id}
                  </span>
                  <span>{r.status}</span>
                </button>
              ))
            )}
            <div className="inline-form">
              <button
                disabled={receiptOffset === 0 || busy}
                onClick={() =>
                  setReceiptOffset(Math.max(0, receiptOffset - 20))
                }
              >
                Previous
              </button>
              <button
                disabled={receiptOffset + 20 >= counts.receipts || busy}
                onClick={() => setReceiptOffset(receiptOffset + 20)}
              >
                Next
              </button>
            </div>
            {detail && (
              <article className="record">
                <h3>
                  Receipt #{detail.id} · {detail.status}
                </h3>
                <p>{detail.summary}</p>
                <p>
                  Nonce: <code>{detail.nonce}</code>
                </p>
                {detail.probes.map((p) => (
                  <p key={p.id}>
                    <strong>
                      {p.id} · {p.verdict}
                    </strong>
                    <br />
                    {p.reason}
                  </p>
                ))}
                <button
                  className="secondary"
                  onClick={() =>
                    download(detail, `modelseal-receipt-${detail.id}.json`)
                  }
                >
                  <Download size={16} />
                  Download actual evidence
                </button>
              </article>
            )}
          </section>
        )}
        <footer className="subtle">
          ModelSeal compares observable behavior against a declared baseline.
          Public probes cannot prove hidden weights, exclude proxying, or
          prevent an endpoint recognizing a probe.{' '}
          <a
            href="https://github.com/jasonmirza1/genlayer-modelseal"
            target="_blank"
            rel="noreferrer"
          >
            Source & protocol ↗
          </a>
        </footer>
      </section>
    </main>
  );
}
