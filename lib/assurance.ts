// A read-only consumer policy, not a new audit or a model-identity certificate.
// The caller supplies the trusted contract and pins; only finalized storage is
// read. No transaction status, browser cache, or wallet is an authority here.
export const ASSURANCE_SCHEMA = 'modelseal.assurance.v1';
export const MAX_HISTORY_ROWS = 100;
const PAGE_SIZE = 20;
const MAX_RECORDS = 10_000;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[1-9][0-9]{0,4}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PROBE_ID = /^[a-z0-9_-]{1,40}$/;
const NONCE = /^(?:[a-f0-9]{2}){16,32}$/;
// Python str.strip() includes NEXT LINE and U+001C-U+001F, but not U+FEFF.
// Do not use JavaScript trim()/\s or normalize the stored evidence strings.
const PYTHON_WHITESPACE_ONLY =
  // eslint-disable-next-line no-control-regex -- Required for Python str.strip() parity.
  /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;
const UNVERIFIED_REASONS = new Set([
  'Locked probe suite or baseline could not be retrieved and verified',
  'Endpoint did not return a verifiable challenge response',
  'Baseline digest or suite binding does not match',
  'Unsupported or incomplete suite/baseline schema',
  'Invalid probe ID',
  'Duplicate probe or incomplete baseline',
  'Baseline must cover exactly the registered probes',
  'Endpoint challenge binding or output is invalid',
]);

export type AssurancePolicy = {
  contract: string;
  profileId: string;
  expectedEndpoint: string;
  expectedBaselineDigest: string;
  expectedSuiteSha256?: string;
  minConsistentReceipts: number;
};
export type AssuranceProfile = {
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
export type AssuranceReceipt = {
  id: string;
  profile_id: string;
  requester: string;
  nonce: string;
  endpoint: string;
  probe_suite_url: string;
  baseline_url: string;
  baseline_digest: string;
  suite_sha256: string;
  baseline_verified: boolean;
  status: 'CONSISTENT' | 'DRIFT_DETECTED' | 'INCONCLUSIVE';
  summary: string;
  probes: {
    id: string;
    verdict: 'MATCH' | 'DRIFT' | 'INCONCLUSIVE';
    reason: string;
  }[];
  observations: { probe_id: string; output: string; response_sha256: string }[];
};
type Counts = { profiles: number; receipts: number; version: '2' };
export type AssuranceCode =
  | 'HISTORY_MATCHED'
  | 'PROFILE_MISSING'
  | 'PROFILE_INACTIVE'
  | 'POLICY_MISMATCH'
  | 'UNSUPPORTED_CONTRACT'
  | 'INVALID_STATE'
  | 'INVALID_EVIDENCE'
  | 'NO_RECEIPT'
  | 'DRIFT_DETECTED'
  | 'INCONCLUSIVE'
  | 'INSUFFICIENT_HISTORY'
  | 'SEARCH_LIMIT'
  | 'STATE_CHANGED'
  | 'READ_FAILED'
  | 'READ_TIMEOUT';
export type AssuranceReport = {
  schema: typeof ASSURANCE_SCHEMA;
  decision: 'ALLOW' | 'BLOCK';
  code: AssuranceCode;
  reason: string;
  policy: AssurancePolicy & { maxHistoryRows: number };
  checkedAt: string;
  // v2 storage contains no audit timestamp. checkedAt is NOT an audit time.
  auditTime: null;
  finality: 'latest-final';
  snapshotCheck: 'counts-and-profile-rechecked' | 'not-confirmed';
  counts: Counts | null;
  profile: AssuranceProfile | null;
  history: {
    scannedRows: number;
    reachedStart: boolean;
    newestProfileReceiptId: string | null;
    consecutiveConsistentReceipts: number;
  };
  receipts: AssuranceReceipt[];
  limitations: string[];
};
export type AssuranceReader = (
  functionName: string,
  args: (string | number)[],
) => Promise<unknown>;

const REASONS: Record<AssuranceCode, string> = {
  HISTORY_MATCHED:
    'The newest consecutive finalized receipts satisfy the pinned policy.',
  PROFILE_MISSING: 'The requested profile does not exist in finalized storage.',
  PROFILE_INACTIVE: 'The finalized profile is inactive.',
  POLICY_MISMATCH:
    'The endpoint, baseline or suite does not match the consumer pins.',
  UNSUPPORTED_CONTRACT:
    'This reader supports only the ModelSeal v2 storage schema.',
  INVALID_STATE:
    'Finalized storage returned an invalid or incomplete page or record.',
  INVALID_EVIDENCE:
    'A required receipt has invalid bindings, coverage or verdicts.',
  NO_RECEIPT: 'There is no finalized audit receipt for this profile.',
  DRIFT_DETECTED: 'A receipt in the required newest sequence reports drift.',
  INCONCLUSIVE: 'A receipt in the required newest sequence is inconclusive.',
  INSUFFICIENT_HISTORY:
    'The profile has fewer receipts than the requested consecutive minimum.',
  SEARCH_LIMIT:
    'The bounded history search cannot establish the required newest sequence.',
  STATE_CHANGED:
    'Finalized counts or the profile changed during the read; check again.',
  READ_FAILED: 'Finalized state could not be read. No cached result is used.',
  READ_TIMEOUT:
    'The finalized-state read exceeded its deadline. No cached result is used.',
};
const LIMITATIONS = [
  'ALLOW means historical consistency with the consumer-pinned baseline, not model identity, safety or current endpoint availability.',
  'v2 receipts have no audit timestamps. checkedAt is the read time; this gate cannot enforce audit freshness.',
  'This is an RPC-backed policy check, not an independent re-audit or a cryptographic storage proof. Trust the selected RPC, contract code and API host.',
  'Separate latest-final calls are not an atomic snapshot. Counts and profile rechecks detect observed changes; they do not provide a block-hash proof.',
  'Public probes cannot exclude proxying, hidden-weight changes or an endpoint recognizing probes.',
];

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((k) => Object.hasOwn(value, k))
  );
}
function text(value: unknown, max: number): value is string {
  // Match Python's nonblank check and code-point lengths, not JavaScript trim
  // semantics, UTF-16 lengths or grapheme counts. Preserve the original text.
  return (
    typeof value === 'string' &&
    !PYTHON_WHITESPACE_ONLY.test(value) &&
    Array.from(value).length <= max
  );
}
function matches(value: unknown, pattern: RegExp): value is string {
  return (
    typeof value === 'string' && value.trim() === value && pattern.test(value)
  );
}
function recordId(value: unknown): value is string {
  return matches(value, ID) && Number(value) <= MAX_RECORDS;
}
function address(value: unknown): value is string {
  return matches(value, ADDRESS) && !/^0x0{40}$/.test(value);
}
// These URLs are data only: the gate never fetches an endpoint or a GitHub URL.
function lockedUrl(value: unknown): value is string {
  if (!text(value, 500) || value.trim() !== value) return false;
  const match =
    /^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\/blob\/[a-f0-9]{40}\/([A-Za-z0-9_./-]+)$/.exec(
      value,
    );
  return (
    !!match &&
    match[1].split('/').every((part) => part && part !== '.' && part !== '..')
  );
}
export function canonicalEndpoint(value: unknown): value is string {
  if (!text(value, 300) || /[^\x21-\x7e]|[\\%?#]/.test(value)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname;
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) &&
      host.includes('.') &&
      /[a-z]/.test(host.split('.').at(-1) ?? '') &&
      !/\.(localhost|local|internal|test|example|invalid)$/.test(host) &&
      host
        .split('.')
        .every(
          (part) => part && !part.startsWith('-') && !part.endsWith('-'),
        ) &&
      !url.pathname.includes('//') &&
      url.pathname.split('/').every((part) => part !== '.' && part !== '..') &&
      value === 'https://' + host + url.pathname
    );
  } catch {
    return false;
  }
}
export function validAssurancePolicy(value: unknown): value is AssurancePolicy {
  if (!object(value)) return false;
  const expected = [
    'contract',
    'profileId',
    'expectedEndpoint',
    'expectedBaselineDigest',
    'minConsistentReceipts',
  ];
  if (Object.hasOwn(value, 'expectedSuiteSha256'))
    expected.push('expectedSuiteSha256');
  return (
    keys(value, expected) &&
    address(value.contract) &&
    recordId(value.profileId) &&
    canonicalEndpoint(value.expectedEndpoint) &&
    matches(value.expectedBaselineDigest, DIGEST) &&
    (!Object.hasOwn(value, 'expectedSuiteSha256') ||
      matches(value.expectedSuiteSha256, DIGEST)) &&
    Number.isInteger(value.minConsistentReceipts) &&
    Number(value.minConsistentReceipts) >= 1 &&
    Number(value.minConsistentReceipts) <= 5
  );
}
export function parseAssuranceQuery(
  params: URLSearchParams,
):
  | { policy: AssurancePolicy; error?: never }
  | { error: string; policy?: never } {
  const allowed = new Set([
    'contract',
    'profile',
    'endpoint',
    'baseline',
    'suite',
    'min',
  ]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1)
      return { error: 'Unknown or repeated query parameter.' };
  }
  const minimum = params.get('min') ?? '1';
  if (!/^[1-5]$/.test(minimum))
    return { error: 'min must be a whole number from 1 to 5.' };
  const policy = {
    contract: params.get('contract'),
    profileId: params.get('profile'),
    expectedEndpoint: params.get('endpoint'),
    expectedBaselineDigest: params.get('baseline'),
    minConsistentReceipts: Number(minimum),
    ...(params.has('suite')
      ? { expectedSuiteSha256: params.get('suite') }
      : {}),
  };
  return validAssurancePolicy(policy)
    ? { policy }
    : {
        error:
          'Provide a nonzero contract, profile ID, canonical HTTPS endpoint and lowercase baseline SHA-256; suite SHA-256 is optional.',
      };
}
export function assuranceQuery(policy: AssurancePolicy) {
  return new URLSearchParams({
    contract: policy.contract,
    profile: policy.profileId,
    endpoint: policy.expectedEndpoint,
    baseline: policy.expectedBaselineDigest,
    min: String(policy.minConsistentReceipts),
    ...(policy.expectedSuiteSha256
      ? { suite: policy.expectedSuiteSha256 }
      : {}),
  }).toString();
}

class GateError extends Error {
  code: AssuranceCode;
  constructor(code: AssuranceCode) {
    super(REASONS[code]);
    this.code = code;
  }
}
function parseCounts(value: unknown): Counts {
  if (!object(value)) throw new GateError('INVALID_STATE');
  if (value.version !== '2') throw new GateError('UNSUPPORTED_CONTRACT');
  if (
    !keys(value, ['profiles', 'receipts', 'version']) ||
    ![value.profiles, value.receipts].every(
      (n) =>
        typeof n === 'number' &&
        Number.isInteger(n) &&
        n >= 0 &&
        n <= MAX_RECORDS,
    )
  )
    throw new GateError('INVALID_STATE');
  return {
    profiles: value.profiles as number,
    receipts: value.receipts as number,
    version: '2',
  };
}
function parseProfile(value: unknown, id: string): AssuranceProfile | null {
  if (object(value) && Object.keys(value).length === 0) return null;
  if (
    !object(value) ||
    !keys(value, [
      'id',
      'owner',
      'name',
      'endpoint',
      'claimed_model',
      'probe_suite_url',
      'baseline_url',
      'baseline_digest',
      'active',
    ]) ||
    value.id !== id ||
    !address(value.owner) ||
    !text(value.name, 100) ||
    !text(value.claimed_model, 140) ||
    !canonicalEndpoint(value.endpoint) ||
    !lockedUrl(value.probe_suite_url) ||
    !lockedUrl(value.baseline_url) ||
    !matches(value.baseline_digest, DIGEST) ||
    typeof value.active !== 'boolean'
  )
    throw new GateError('INVALID_STATE');
  return { ...value } as AssuranceProfile;
}
function consensusPayloadLength(receipt: Record<string, unknown>): number {
  // Match len(json.dumps(result)) in _checked_consensus: default ASCII escapes
  // and comma/colon spaces, on the six-field payload BEFORE receipt metadata.
  // Run only after validating the bounded strings, rows and verification flag.
  function pythonJsonLength(value: unknown): number {
    if (typeof value === 'string')
      return JSON.stringify(value).replace(
        /[\u007f-\uffff]/g,
        (unit) => '\\u' + unit.charCodeAt(0).toString(16).padStart(4, '0'),
      ).length;
    if (typeof value === 'boolean') return value ? 4 : 5;
    if (Array.isArray(value))
      return (
        2 +
        value.reduce<number>((sum, item) => sum + pythonJsonLength(item), 0) +
        Math.max(0, value.length - 1) * 2
      );
    if (object(value)) {
      const entries = Object.entries(value);
      return (
        2 +
        entries.reduce(
          (sum, [key, item]) =>
            sum + pythonJsonLength(key) + 2 + pythonJsonLength(item),
          0,
        ) +
        Math.max(0, entries.length - 1) * 2
      );
    }
    throw new GateError('INVALID_EVIDENCE');
  }
  return pythonJsonLength({
    status: receipt.status,
    summary: receipt.summary,
    probes: receipt.probes,
    observations: receipt.observations,
    suite_sha256: receipt.suite_sha256,
    baseline_verified: receipt.baseline_verified,
  });
}
function parseReceipt(
  value: unknown,
  profile: AssuranceProfile,
): AssuranceReceipt {
  const fields = [
    'id',
    'profile_id',
    'requester',
    'nonce',
    'endpoint',
    'probe_suite_url',
    'baseline_url',
    'baseline_digest',
    'suite_sha256',
    'baseline_verified',
    'status',
    'summary',
    'probes',
    'observations',
  ];
  if (
    !object(value) ||
    !keys(value, fields) ||
    !recordId(value.id) ||
    value.profile_id !== profile.id ||
    !address(value.requester) ||
    !matches(value.nonce, NONCE) ||
    value.endpoint !== profile.endpoint ||
    value.probe_suite_url !== profile.probe_suite_url ||
    value.baseline_url !== profile.baseline_url ||
    value.baseline_digest !== profile.baseline_digest ||
    !text(value.summary, 600) ||
    !Array.isArray(value.probes) ||
    !Array.isArray(value.observations) ||
    typeof value.status !== 'string' ||
    !['CONSISTENT', 'DRIFT_DETECTED', 'INCONCLUSIVE'].includes(value.status)
  )
    throw new GateError('INVALID_EVIDENCE');
  if (value.baseline_verified === false) {
    if (
      value.status !== 'INCONCLUSIVE' ||
      !UNVERIFIED_REASONS.has(value.summary) ||
      value.suite_sha256 !== '' ||
      value.probes.length !== 0 ||
      value.observations.length !== 0 ||
      consensusPayloadLength(value) > 24_000
    )
      throw new GateError('INVALID_EVIDENCE');
    return structuredClone(value) as AssuranceReceipt;
  }
  if (
    value.baseline_verified !== true ||
    !matches(value.suite_sha256, DIGEST) ||
    value.probes.length < 1 ||
    value.probes.length > 4 ||
    value.observations.length !== value.probes.length
  )
    throw new GateError('INVALID_EVIDENCE');
  const probes = new Set<string>();
  let derived = 'CONSISTENT';
  for (const row of value.probes) {
    if (
      !object(row) ||
      !keys(row, ['id', 'verdict', 'reason']) ||
      !matches(row.id, PROBE_ID) ||
      probes.has(row.id) ||
      !text(row.reason, 300) ||
      typeof row.verdict !== 'string' ||
      !['MATCH', 'DRIFT', 'INCONCLUSIVE'].includes(row.verdict)
    )
      throw new GateError('INVALID_EVIDENCE');
    probes.add(row.id);
    if (row.verdict === 'INCONCLUSIVE') derived = 'INCONCLUSIVE';
    else if (row.verdict === 'DRIFT' && derived !== 'INCONCLUSIVE')
      derived = 'DRIFT_DETECTED';
  }
  const observations = new Set<string>();
  for (const row of value.observations) {
    if (
      !object(row) ||
      !keys(row, ['probe_id', 'output', 'response_sha256']) ||
      typeof row.probe_id !== 'string' ||
      !probes.has(row.probe_id) ||
      observations.has(row.probe_id) ||
      !text(row.output, 2000) ||
      !matches(row.response_sha256, DIGEST)
    )
      throw new GateError('INVALID_EVIDENCE');
    observations.add(row.probe_id);
  }
  if (derived !== value.status || consensusPayloadLength(value) > 24_000)
    throw new GateError('INVALID_EVIDENCE');
  return structuredClone(value) as AssuranceReceipt;
}
function sameProfile(a: AssuranceProfile | null, b: AssuranceProfile | null) {
  if (!a || !b) return a === b;
  return (Object.keys(a) as (keyof AssuranceProfile)[]).every(
    (key) => a[key] === b[key],
  );
}

// HTTP consumers must check the report, not only a 200 status or a loose
// "ALLOW" string. This checks scope and internal consistency, not RPC truth.
export function matchesAssuranceReport(
  value: unknown,
  pin: AssurancePolicy,
): value is AssuranceReport {
  if (
    !validAssurancePolicy(pin) ||
    !object(value) ||
    value.schema !== ASSURANCE_SCHEMA ||
    !object(value.policy) ||
    value.policy.maxHistoryRows !== MAX_HISTORY_ROWS ||
    !['ALLOW', 'BLOCK'].includes(String(value.decision)) ||
    typeof value.code !== 'string' ||
    !Object.hasOwn(REASONS, value.code) ||
    value.reason !== REASONS[value.code as AssuranceCode] ||
    typeof value.checkedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.checkedAt) ||
    !Number.isFinite(Date.parse(value.checkedAt)) ||
    value.auditTime !== null ||
    value.finality !== 'latest-final' ||
    typeof value.snapshotCheck !== 'string' ||
    !['counts-and-profile-rechecked', 'not-confirmed'].includes(
      value.snapshotCheck,
    ) ||
    !object(value.history) ||
    !Array.isArray(value.receipts) ||
    value.receipts.length > 5 ||
    !Array.isArray(value.limitations) ||
    value.limitations.length !== LIMITATIONS.length ||
    !LIMITATIONS.every(
      (line, index) =>
        value.limitations instanceof Array && value.limitations[index] === line,
    )
  )
    return false;
  const { maxHistoryRows: _bound, ...policy } = value.policy;
  if (
    !validAssurancePolicy(policy) ||
    assuranceQuery(policy) !== assuranceQuery(pin)
  )
    return false;
  const history = value.history;
  if (
    ![history.scannedRows, history.consecutiveConsistentReceipts].every(
      (n) => typeof n === 'number' && Number.isInteger(n) && n >= 0,
    ) ||
    Number(history.scannedRows) > MAX_HISTORY_ROWS ||
    Number(history.consecutiveConsistentReceipts) > pin.minConsistentReceipts ||
    typeof history.reachedStart !== 'boolean' ||
    (history.newestProfileReceiptId !== null &&
      !recordId(history.newestProfileReceiptId))
  )
    return false;
  try {
    if (value.counts !== null) parseCounts(value.counts);
    const p =
      value.profile === null
        ? null
        : parseProfile(value.profile, pin.profileId);
    const rows = value.receipts.map((r) => {
      if (!p) throw new GateError('INVALID_EVIDENCE');
      return parseReceipt(r, p);
    });
    if (value.decision === 'BLOCK') return value.code !== 'HISTORY_MATCHED';
    if (
      value.decision !== 'ALLOW' ||
      value.code !== 'HISTORY_MATCHED' ||
      value.snapshotCheck !== 'counts-and-profile-rechecked' ||
      !p?.active ||
      p.endpoint !== pin.expectedEndpoint ||
      p.baseline_digest !== pin.expectedBaselineDigest ||
      rows.length !== pin.minConsistentReceipts ||
      history.consecutiveConsistentReceipts !== pin.minConsistentReceipts ||
      history.newestProfileReceiptId !== rows[0]?.id ||
      Number(history.scannedRows) < rows.length ||
      !object(value.counts) ||
      Number(p.id) > Number(value.counts.profiles)
    )
      return false;
    const nonces = new Set<string>();
    const firstIds = rows[0].probes
      .map((r) => r.id)
      .sort()
      .join(',');
    return rows.every((r, index) => {
      if (
        r.status !== 'CONSISTENT' ||
        !r.baseline_verified ||
        r.suite_sha256 !== rows[0].suite_sha256 ||
        (pin.expectedSuiteSha256 &&
          r.suite_sha256 !== pin.expectedSuiteSha256) ||
        r.probes
          .map((probe) => probe.id)
          .sort()
          .join(',') !== firstIds ||
        Number(r.id) > Number((value.counts as Counts).receipts) ||
        (index > 0 && Number(r.id) >= Number(rows[index - 1].id)) ||
        nonces.has(r.nonce)
      )
        return false;
      nonces.add(r.nonce);
      return true;
    });
  } catch {
    return false;
  }
}

export async function evaluateAssurance(
  read: AssuranceReader,
  policy: AssurancePolicy,
  options: { timeoutMs?: number } = {},
): Promise<AssuranceReport> {
  if (!validAssurancePolicy(policy))
    throw new TypeError('Invalid assurance policy');
  // Copy caller-owned data before an await so a mutation cannot switch scope.
  const pin = { ...policy };
  const timeout = options.timeoutMs ?? 12_000;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 30_000)
    throw new TypeError('Invalid read deadline');
  const deadline = Date.now() + timeout;
  const report: AssuranceReport = {
    schema: ASSURANCE_SCHEMA,
    decision: 'BLOCK',
    code: 'READ_FAILED',
    reason: REASONS.READ_FAILED,
    policy: { ...pin, maxHistoryRows: MAX_HISTORY_ROWS },
    checkedAt: '',
    auditTime: null,
    finality: 'latest-final',
    snapshotCheck: 'not-confirmed',
    counts: null,
    profile: null,
    history: {
      scannedRows: 0,
      reachedStart: false,
      newestProfileReceiptId: null,
      consecutiveConsistentReceipts: 0,
    },
    receipts: [],
    limitations: [...LIMITATIONS],
  };
  function decide(code: AssuranceCode) {
    report.code = code;
    report.reason = REASONS[code];
    // Even a syntactically valid positive sequence is never sufficient alone.
    report.decision =
      code === 'HISTORY_MATCHED' &&
      report.snapshotCheck === 'counts-and-profile-rechecked'
        ? 'ALLOW'
        : 'BLOCK';
    report.checkedAt = new Date().toISOString();
    return report;
  }
  async function boundedRead(method: string, args: (string | number)[] = []) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new GateError('READ_TIMEOUT');
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new GateError('READ_TIMEOUT')),
        remaining,
      );
      Promise.resolve()
        .then(() => read(method, args))
        .then(
          (value) => {
            clearTimeout(timer);
            if (Date.now() >= deadline) reject(new GateError('READ_TIMEOUT'));
            else resolve(value);
          },
          () => {
            clearTimeout(timer);
            reject(new GateError('READ_FAILED'));
          },
        );
    });
  }
  try {
    const [countsValue, profileValue] = await Promise.all([
      boundedRead('get_counts'),
      boundedRead('get_profile', [pin.profileId]),
    ]);
    const counts = parseCounts(countsValue);
    const profile = parseProfile(profileValue, pin.profileId);
    report.counts = counts;
    report.profile = profile;
    if (Number(pin.profileId) <= counts.profiles !== !!profile)
      throw new GateError('STATE_CHANGED');
    let candidate: AssuranceCode = 'NO_RECEIPT';
    if (!profile) candidate = 'PROFILE_MISSING';
    else if (!profile.active) candidate = 'PROFILE_INACTIVE';
    else if (
      profile.endpoint !== pin.expectedEndpoint ||
      profile.baseline_digest !== pin.expectedBaselineDigest
    )
      candidate = 'POLICY_MISMATCH';
    else {
      let end = counts.receipts;
      let done = false;
      const nonces = new Set<string>();
      let suite: string | undefined;
      let probeSet: string | undefined;
      while (
        end > 0 &&
        report.history.scannedRows < MAX_HISTORY_ROWS &&
        !done
      ) {
        const size = Math.min(
          PAGE_SIZE,
          end,
          MAX_HISTORY_ROWS - report.history.scannedRows,
        );
        const offset = end - size;
        const page = await boundedRead('list_receipts', [offset, size]);
        // A short, reordered or overlapping page could conceal a newer failure.
        if (!Array.isArray(page) || page.length !== size)
          throw new GateError('INVALID_STATE');
        for (let index = 0; index < page.length; index++) {
          const row = page[index];
          if (
            !object(row) ||
            row.id !== String(offset + index + 1) ||
            !recordId(row.profile_id) ||
            Number(row.profile_id) > counts.profiles
          )
            throw new GateError('INVALID_STATE');
        }
        for (let index = page.length - 1; index >= 0 && !done; index--) {
          const raw = page[index] as Record<string, unknown>;
          report.history.scannedRows++;
          report.history.reachedStart = raw.id === '1';
          if (raw.profile_id !== pin.profileId) continue;
          report.history.newestProfileReceiptId ??= String(raw.id);
          const receipt = parseReceipt(raw, profile);
          if (nonces.has(receipt.nonce))
            throw new GateError('INVALID_EVIDENCE');
          nonces.add(receipt.nonce);
          report.receipts.push(receipt);
          // Never fall back to an older MATCH after a newer bad/unknown result.
          if (receipt.status !== 'CONSISTENT') {
            candidate = receipt.status;
            done = true;
          } else if (
            pin.expectedSuiteSha256 &&
            receipt.suite_sha256 !== pin.expectedSuiteSha256
          ) {
            candidate = 'POLICY_MISMATCH';
            done = true;
          } else {
            const ids = receipt.probes
              .map((p) => p.id)
              .sort()
              .join(',');
            if (
              (suite && suite !== receipt.suite_sha256) ||
              (probeSet && probeSet !== ids)
            )
              throw new GateError('INVALID_EVIDENCE');
            suite = receipt.suite_sha256;
            probeSet = ids;
            report.history.consecutiveConsistentReceipts++;
            if (
              report.history.consecutiveConsistentReceipts ===
              pin.minConsistentReceipts
            ) {
              candidate = 'HISTORY_MATCHED';
              done = true;
            }
          }
        }
        end = offset;
      }
      if (!done) {
        report.history.reachedStart = end === 0;
        candidate =
          end > 0
            ? 'SEARCH_LIMIT'
            : report.receipts.length > 0
              ? 'INSUFFICIENT_HISTORY'
              : 'NO_RECEIPT';
      }
    }
    const [afterCounts, afterProfile] = await Promise.all([
      boundedRead('get_counts'),
      boundedRead('get_profile', [pin.profileId]),
    ]);
    const finalCounts = parseCounts(afterCounts);
    const finalProfile = parseProfile(afterProfile, pin.profileId);
    if (
      finalCounts.profiles !== counts.profiles ||
      finalCounts.receipts !== counts.receipts ||
      !sameProfile(profile, finalProfile)
    )
      throw new GateError('STATE_CHANGED');
    report.snapshotCheck = 'counts-and-profile-rechecked';
    return decide(candidate);
  } catch (error) {
    return decide(error instanceof GateError ? error.code : 'INVALID_STATE');
  }
}

export async function assuranceResponse(
  request: Request,
  read: (
    contract: string,
    method: string,
    args: (string | number)[],
  ) => Promise<unknown>,
  options: { timeoutMs?: number } = {},
) {
  const headers = {
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  };
  const url = new URL(request.url);
  if (url.search.length > 2000)
    return Response.json(
      { error: 'Query is too long.' },
      { status: 400, headers },
    );
  const parsed = parseAssuranceQuery(url.searchParams);
  if (parsed.error)
    return Response.json({ error: parsed.error }, { status: 400, headers });
  const policy = parsed.policy!;
  const report = await evaluateAssurance(
    (method, args) => read(policy.contract, method, args),
    policy,
    options,
  );
  const unavailable = ['READ_FAILED', 'READ_TIMEOUT', 'STATE_CHANGED'].includes(
    report.code,
  );
  return Response.json(report, { status: unavailable ? 503 : 200, headers });
}
