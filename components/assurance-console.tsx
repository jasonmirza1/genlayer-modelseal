'use client';

import { useEffect, useRef, useState } from 'react';
import {
  assuranceQuery,
  validAssurancePolicy,
  matchesAssuranceReport,
  type AssurancePolicy,
  type AssuranceReport,
} from '@/lib/assurance';

type ProfileOption = {
  id: string;
  name: string;
  endpoint: string;
  baseline_digest: string;
};
const REQUEST_TIMEOUT_MS = 15_000;
export function AssuranceConsole({
  address,
  profiles,
}: {
  address: string;
  profiles: ProfileOption[];
}) {
  const [profileId, setProfileId] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [baseline, setBaseline] = useState('');
  const [suite, setSuite] = useState('');
  const [minimum, setMinimum] = useState(1);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<AssuranceReport | null>(null);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const request = useRef<AbortController | null>(null);
  const revision = useRef(0);
  useEffect(() => () => request.current?.abort(), []);

  const policy: AssurancePolicy = {
    contract: address,
    profileId,
    expectedEndpoint: endpoint,
    expectedBaselineDigest: baseline,
    minConsistentReceipts: minimum,
    ...(suite ? { expectedSuiteSha256: suite } : {}),
  };
  const valid = validAssurancePolicy(policy);
  const path = valid ? '/api/assurance?' + assuranceQuery(policy) : '';
  function invalidate() {
    revision.current++;
    request.current?.abort();
    setBusy(false);
    setReport(null);
    setError('');
    setCopyStatus('');
  }
  async function check() {
    if (!valid) return;
    const token = ++revision.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setReport(null);
    setError('');
    setCopyStatus('');
    const timer = window.setTimeout(() => {
      if (token !== revision.current || controller.signal.aborted) return;
      controller.abort();
      // Release the UI even if a transport or body reader ignores abort.
      setError(
        'Policy check timed out. Access stays blocked; try checking again.',
      );
      setBusy(false);
    }, REQUEST_TIMEOUT_MS);
    const clearDeadline = () => window.clearTimeout(timer);
    controller.signal.addEventListener('abort', clearDeadline, { once: true });
    try {
      const response = await fetch(path, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const value: unknown = await response.json();
      if (token !== revision.current || controller.signal.aborted) return;
      if (
        !matchesAssuranceReport(value, policy) ||
        (!response.ok && value.decision === 'ALLOW')
      )
        throw new Error(
          'The API did not return a valid report for these pins. Access stays blocked.',
        );
      setReport(value);
    } catch {
      if (token === revision.current && !controller.signal.aborted)
        setError(
          'No verified policy result is available. Access stays blocked; check again when reads recover.',
        );
    } finally {
      clearDeadline();
      controller.signal.removeEventListener('abort', clearDeadline);
      if (token === revision.current) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  async function copyApiUrl() {
    try {
      await navigator.clipboard.writeText(new URL(path, location.origin).href);
      setCopyStatus('API URL copied.');
    } catch {
      setCopyStatus(
        'Copy is unavailable. Open the JSON API link and copy its address.',
      );
    }
  }
  function downloadReport() {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'modelseal-assurance-profile-' + profileId + '.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      className="panel configuration assurance"
      aria-label="Read-only assurance gate"
    >
      <h2>Audit Gate · consumer policy</h2>
      <p>
        Check whether an endpoint’s newest consecutive finalized audits match
        your pinned baseline. Read-only: no wallet approval, new audit or
        transaction fee.
      </p>
      <p>
        ALLOW means historical consistency, not model identity or safety. v2 has
        no audit timestamps, so this check cannot prove freshness or current
        availability.
      </p>
      {profiles.length > 0 && (
        <label>
          Use pins from a loaded profile · review before trusting
          <select
            value=""
            onChange={(e) => {
              const selected = profiles.find((p) => p.id === e.target.value);
              if (!selected) return;
              invalidate();
              setProfileId(selected.id);
              setEndpoint(selected.endpoint);
              setBaseline(selected.baseline_digest);
              setSuite('');
            }}
          >
            <option value="">Choose profile to populate pins</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · #{p.id}
              </option>
            ))}
          </select>
        </label>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void check();
        }}
      >
        <div className="form-grid">
          <label>
            Profile ID
            <input
              required
              value={profileId}
              inputMode="numeric"
              maxLength={5}
              onChange={(e) => {
                invalidate();
                setProfileId(e.target.value);
              }}
            />
          </label>
          <label>
            Minimum consecutive passing audits
            <select
              value={minimum}
              onChange={(e) => {
                invalidate();
                setMinimum(Number(e.target.value));
              }}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Expected HTTPS endpoint · exact canonical URL
            <input
              required
              type="url"
              value={endpoint}
              maxLength={300}
              onChange={(e) => {
                invalidate();
                setEndpoint(e.target.value);
              }}
            />
          </label>
          <label>
            Expected baseline SHA-256
            <input
              required
              value={baseline}
              maxLength={64}
              pattern="[a-f0-9]{64}"
              onChange={(e) => {
                invalidate();
                setBaseline(e.target.value);
              }}
            />
          </label>
          <label>
            Expected suite SHA-256 · optional
            <input
              value={suite}
              maxLength={64}
              pattern="[a-f0-9]{64}"
              onChange={(e) => {
                invalidate();
                setSuite(e.target.value);
              }}
            />
          </label>
        </div>
        <button className="run-button" disabled={!valid || busy} type="submit">
          {busy
            ? 'Reading newest finalized receipts…'
            : 'Check policy · no transaction'}
        </button>
      </form>
      {!valid && (
        <p className="subtle">
          Enter your trusted profile, endpoint and baseline pins to enable a
          check.
        </p>
      )}
      <p className="subtle">
        Maximum 100 global receipts scanned, newest first. A newer drift or
        inconclusive receipt blocks the required sequence. Missing, malformed or
        changing state also blocks.
      </p>
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      {!report && !busy && !error && (
        <p>No policy check has been completed. Do not treat this as ALLOW.</p>
      )}
      {report && (
        <article
          className="record"
          aria-label="Assurance policy result"
          aria-live="polite"
        >
          <h3>Policy result: {report.decision}</h3>
          <p>
            <code>{report.code}</code> · {report.reason}
          </p>
          <p>
            Profile #{report.policy.profileId} · minimum{' '}
            {report.policy.minConsistentReceipts} · verified passing sequence:{' '}
            {report.history.consecutiveConsistentReceipts}
          </p>
          <p>
            Newest profile receipt:{' '}
            {report.history.newestProfileReceiptId
              ? '#' + report.history.newestProfileReceiptId
              : 'Not established'}{' '}
            · global rows inspected: {report.history.scannedRows} /{' '}
            {report.policy.maxHistoryRows}
          </p>
          <p className="subtle">
            Read time: {report.checkedAt} · audit time: unavailable · snapshot
            check: {report.snapshotCheck}
          </p>
          {report.receipts.map((receipt) => (
            <details className="record" key={receipt.id}>
              <summary>
                Receipt #{receipt.id} · {receipt.status}
              </summary>
              <p>{receipt.summary}</p>
              <p>
                Nonce: <code>{receipt.nonce}</code>
              </p>
              <p>
                Suite SHA-256:{' '}
                <code>{receipt.suite_sha256 || 'Unverified'}</code>
              </p>
              {receipt.probes.map((probe) => (
                <p key={probe.id}>
                  {probe.id} · {probe.verdict}
                  <br />
                  {probe.reason}
                </p>
              ))}
            </details>
          ))}
          <button className="secondary" onClick={downloadReport}>
            Download policy report
          </button>
        </article>
      )}
      {valid && (
        <div className="inline-form">
          <a href={path} target="_blank" rel="noreferrer">
            Open read-only JSON API ↗
          </a>
          <button className="secondary" onClick={() => void copyApiUrl()}>
            Copy API URL
          </button>
          {copyStatus && <output>{copyStatus}</output>}
        </div>
      )}
      <details className="record">
        <summary>Trust boundaries and integration</summary>
        <p>
          Choose the contract, endpoint and baseline pins yourself; populating a
          registered profile does not make its owner or declared baseline
          trustworthy. Consumers must check the report schema, scope and
          decision, not just an HTTP 200.
        </p>
        <p>
          The gate trusts the selected RPC and deployed v2 contract. Separate
          finalized reads are not an atomic snapshot; counts and profile are
          rechecked before ALLOW. Keep ordinary endpoint authorization and
          independent security checks.
        </p>
        <a
          href="https://github.com/jasonmirza1/genlayer-modelseal"
          target="_blank"
          rel="noreferrer"
        >
          Repository · integration documentation ↗
        </a>
      </details>
    </section>
  );
}
