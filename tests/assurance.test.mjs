import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  evaluateAssurance,
  parseAssuranceQuery,
  validAssurancePolicy,
  canonicalEndpoint,
  assuranceQuery,
  MAX_HISTORY_ROWS,
  matchesAssuranceReport,
  assuranceResponse,
} from '../lib/assurance.ts';

const contract = '0x' + '2'.repeat(40);
const owner = '0x' + '1'.repeat(40);
const blob =
  'https://github.com/example/modelseal/blob/' + 'a'.repeat(40) + '/';
function profile(id = '1') {
  return {
    id,
    owner,
    name: 'Test fixture',
    claimed_model: 'Programmed fixture',
    endpoint: 'https://modelseal.vercel.app/api/fixture/baseline',
    probe_suite_url: blob + 'suite.json',
    baseline_url: blob + 'baseline.json',
    baseline_digest: 'b'.repeat(64),
    active: true,
  };
}
function policy(min = 1) {
  const p = profile();
  return {
    contract,
    profileId: p.id,
    expectedEndpoint: p.endpoint,
    expectedBaselineDigest: p.baseline_digest,
    minConsistentReceipts: min,
  };
}
function receipt(id = 1, status = 'CONSISTENT', profileId = '1') {
  const p = profile(profileId);
  const verdict = {
    CONSISTENT: 'MATCH',
    DRIFT_DETECTED: 'DRIFT',
    INCONCLUSIVE: 'INCONCLUSIVE',
  }[status];
  return {
    id: String(id),
    profile_id: p.id,
    requester: owner,
    nonce: id.toString(16).padStart(48, '0'),
    endpoint: p.endpoint,
    probe_suite_url: p.probe_suite_url,
    baseline_url: p.baseline_url,
    baseline_digest: p.baseline_digest,
    suite_sha256: 'c'.repeat(64),
    baseline_verified: true,
    status,
    summary: 'A consensus-reviewed fixture result.',
    probes: ['idempotency', 'uncertainty', 'untrusted'].map((id) => ({
      id,
      verdict,
      reason: 'Observed comparison.',
    })),
    observations: ['idempotency', 'uncertainty', 'untrusted'].map(
      (probe_id) => ({
        probe_id,
        output: 'An observed answer.',
        response_sha256: 'd'.repeat(64),
      }),
    ),
  };
}
function largeReceiptFixture(controlCharacters = 700) {
  const endpointPrefix = 'https://api.acme.com/';
  const p = {
    ...profile(),
    endpoint: endpointPrefix + 'p'.repeat(300 - endpointPrefix.length),
    probe_suite_url: blob + 's'.repeat(500 - blob.length),
    baseline_url: blob + 'b'.repeat(500 - blob.length),
  };
  const r = {
    ...receipt(),
    endpoint: p.endpoint,
    probe_suite_url: p.probe_suite_url,
    baseline_url: p.baseline_url,
    summary: 'All match.',
    probes: Array.from({ length: 4 }, (_, i) => ({
      id: 'p' + i,
      verdict: 'MATCH',
      reason: 'Matches.',
    })),
    observations: Array.from({ length: 4 }, (_, i) => ({
      probe_id: 'p' + i,
      output:
        '\u0001'.repeat(controlCharacters) +
        'x'.repeat(2000 - controlCharacters),
      response_sha256: 'd'.repeat(64),
    })),
  };
  const pin = { ...policy(), expectedEndpoint: p.endpoint };
  return { p, r, pin };
}
function state(rows = [receipt()], p = profile(), hooks = {}) {
  const calls = [];
  const counts = {
    profiles: p
      ? Math.max(1, Number(p.id), ...rows.map((r) => Number(r.profile_id)))
      : 0,
    receipts: rows.length,
    version: '2',
  };
  const reader = async (method, args) => {
    calls.push({ method, args: [...args] });
    assert.ok(
      ['get_counts', 'get_profile', 'list_receipts'].includes(method),
      'read-only whitelist',
    );
    if (hooks[method])
      return await hooks[method]({ args, calls, counts, rows, profile: p });
    if (method === 'get_counts') return structuredClone(counts);
    if (method === 'get_profile') return structuredClone(p ?? {});
    return structuredClone(rows.slice(args[0], args[0] + args[1]));
  };
  return { reader, calls, counts };
}

test('only strict, explicit consumer pins can reach the reader', () => {
  const base = policy();
  assert.equal(validAssurancePolicy(base), true);
  assert.deepEqual(
    parseAssuranceQuery(new URLSearchParams(assuranceQuery(base))),
    { policy: base },
  );
  for (const patch of [
    { contract: '0x' + '0'.repeat(40) },
    { contract: contract + '\n' },
    { profileId: '01' },
    { profileId: 1 },
    { profileId: '10001' },
    { expectedBaselineDigest: 'B'.repeat(64) },
    { expectedBaselineDigest: '' },
    { minConsistentReceipts: 0 },
    { minConsistentReceipts: 6 },
    { minConsistentReceipts: '1' },
    { minConsistentReceipts: 1.5 },
    { expectedSuiteSha256: '' },
    { rpc: 'https://evil.invalid/' },
  ])
    assert.equal(
      validAssurancePolicy({ ...base, ...patch }),
      false,
      JSON.stringify(patch),
    );
});
test('query parser rejects missing pins, duplicate/unknown parameters and permissive integers', () => {
  const query = assuranceQuery(policy());
  for (const suffix of [
    '&profile=1',
    '&rpc=http://localhost',
    '&min=2',
    '&suite=bad',
  ]) {
    assert.ok(parseAssuranceQuery(new URLSearchParams(query + suffix)).error);
  }
  for (const name of ['contract', 'profile', 'endpoint', 'baseline']) {
    const params = new URLSearchParams(query);
    params.delete(name);
    assert.ok(parseAssuranceQuery(params).error, name);
  }
  for (const min of ['01', '1.0', '1x', '-1', '', '6']) {
    const params = new URLSearchParams(query);
    params.set('min', min);
    assert.ok(parseAssuranceQuery(params).error, min);
  }
  const noMin = new URLSearchParams(query);
  noMin.delete('min');
  assert.equal(parseAssuranceQuery(noMin).policy.minConsistentReceipts, 1);
});
test('endpoint pins must be canonical public HTTPS data, never executable URLs', () => {
  assert.equal(canonicalEndpoint(profile().endpoint), true);
  assert.equal(canonicalEndpoint('https://example.org/'), true);
  for (const url of [
    'javascript:alert(1)',
    'http://example.org/',
    'https://example.org',
    'https://EXAMPLE.org/',
    'https://example.org:443/',
    'https://user@example.org/',
    'https://127.0.0.1/',
    'https://localhost/',
    'https://demo.local/',
    'https://demo.invalid/',
    'https://example.org/a/../b',
    'https://example.org//a',
    'https://example.org/%61',
    'https://example.org/a?q=1',
    'https://example.org/a#b',
    'https://example.org/\n',
    'https://example.org/é',
    'https://-demo.org/',
  ])
    assert.equal(canonicalEndpoint(url), false, url);
});
test('invalid policy rejects before any RPC call', async () => {
  const { reader, calls } = state();
  await assert.rejects(
    evaluateAssurance(reader, { ...policy(), expectedBaselineDigest: '' }),
    TypeError,
  );
  assert.equal(calls.length, 0);
});
test('a verified newest receipt allows without a wallet or transaction lookup', async () => {
  const { reader, calls } = state();
  const report = await evaluateAssurance(reader, policy());
  assert.equal(report.decision, 'ALLOW');
  assert.equal(report.code, 'HISTORY_MATCHED');
  assert.equal(report.finality, 'latest-final');
  assert.equal(report.snapshotCheck, 'counts-and-profile-rechecked');
  assert.equal(report.history.newestProfileReceiptId, '1');
  assert.equal(report.history.consecutiveConsistentReceipts, 1);
  assert.equal(report.auditTime, null);
  assert.match(report.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(
    report.limitations.some((line) => line.includes('no audit timestamps')),
  );
  assert.ok(
    report.limitations.some((line) =>
      line.includes('not an independent re-audit'),
    ),
  );
  assert.deepEqual(
    calls.map((c) => c.method),
    ['get_counts', 'get_profile', 'list_receipts', 'get_counts', 'get_profile'],
  );
});
test('receipt metadata is not charged against the consensus payload limit', async () => {
  const { p, r, pin } = largeReceiptFixture();
  // The six-field payload is 22,898 characters under Python json.dumps;
  // metadata is attached only after the contract validates that payload.
  assert.ok(Buffer.byteLength(JSON.stringify(r)) > 24_000);
  const report = await evaluateAssurance(state([r], p).reader, pin);
  assert.equal(report.decision, 'ALLOW');
  assert.equal(report.code, 'HISTORY_MATCHED');
  assert.deepEqual(report.receipts, [r]);
  assert.equal(matchesAssuranceReport(report, pin), true);
});
test('the exact 24,000-character Python consensus boundary is inclusive', async () => {
  const { p, r, pin } = largeReceiptFixture(750);
  // Python's default ASCII escapes and separators give exactly 24,000.
  r.summary = 's'.repeat(112);
  const report = await evaluateAssurance(state([r], p).reader, pin);
  assert.equal(report.decision, 'ALLOW');
  assert.equal(matchesAssuranceReport(report, pin), true);
});
test('one character beyond the Python consensus boundary fails closed', async () => {
  const { p, r, pin } = largeReceiptFixture(750);
  r.summary = 's'.repeat(112);
  const before = await evaluateAssurance(state([r], p).reader, pin);
  assert.equal(before.decision, 'ALLOW');
  before.receipts[0].summary = 's'.repeat(113);
  assert.equal(matchesAssuranceReport(before, pin), false);
  r.summary = 's'.repeat(113);
  const report = await evaluateAssurance(state([r], p).reader, pin);
  assert.equal(report.decision, 'BLOCK');
  assert.equal(report.code, 'INVALID_EVIDENCE');
});
for (const [name, character] of [
  ['non-ASCII', 'é'],
  ['DEL', '\u007f'],
]) {
  test(
    'Python ASCII escaping enforces the payload limit for ' + name,
    async () => {
      const { p, r, pin } = largeReceiptFixture();
      const before = await evaluateAssurance(state([r], p).reader, pin);
      assert.equal(before.decision, 'ALLOW');
      for (const observation of r.observations)
        observation.output = character.repeat(2000);
      before.receipts = [r];
      assert.equal(matchesAssuranceReport(before, pin), false);
      // Compact UTF-8 alone fits, but Python escapes each character to six bytes.
      assert.ok(Buffer.byteLength(JSON.stringify(r)) < 24_000);
      const report = await evaluateAssurance(state([r], p).reader, pin);
      assert.equal(report.decision, 'BLOCK');
      assert.equal(report.code, 'INVALID_EVIDENCE');
    },
  );
}
test('valid Unicode payloads below the contract limit still allow', async () => {
  const { p, r, pin } = largeReceiptFixture();
  for (const observation of r.observations)
    observation.output = 'é'.repeat(900);
  const report = await evaluateAssurance(state([r], p).reader, pin);
  assert.equal(report.decision, 'ALLOW');
  assert.equal(matchesAssuranceReport(report, pin), true);
});
// All 29 code points recognized by Python str.isspace()/str.strip().
// NEXT LINE and U+001C-U+001F differ from JavaScript trim(); U+FEFF is not here.
const pythonWhitespace = Array.from(
  '\u0009\u000a\u000b\u000c\u000d\u001c\u001d\u001e\u001f\u0020' +
    '\u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006' +
    '\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000',
);
const receiptTextFields = [
  [
    'summary',
    (r, value) => {
      r.summary = value;
    },
  ],
  [
    'reason',
    (r, value) => {
      r.probes[0].reason = value;
    },
  ],
  [
    'output',
    (r, value) => {
      r.observations[0].output = value;
    },
  ],
];

test('Python whitespace-only profile text fails closed', async () => {
  assert.equal(pythonWhitespace.length, 29);
  for (const field of ['name', 'claimed_model']) {
    for (const character of pythonWhitespace) {
      const p = { ...profile(), [field]: ' \t' + character.repeat(3) + '\n' };
      const report = await evaluateAssurance(
        state([receipt()], p).reader,
        policy(),
      );
      const context = field + ': ' + JSON.stringify(character);
      assert.equal(report.decision, 'BLOCK', context);
      assert.equal(report.code, 'INVALID_STATE', context);
    }
  }
});

test('Python whitespace-only receipt text cannot fall back to an older pass', async () => {
  for (const [field, assign] of receiptTextFields) {
    for (const character of pythonWhitespace) {
      const newest = receipt(2);
      assign(newest, ' \t' + character.repeat(3) + '\n');
      const report = await evaluateAssurance(
        state([receipt(1), newest]).reader,
        policy(),
      );
      const context = field + ': ' + JSON.stringify(character);
      assert.equal(report.decision, 'BLOCK', context);
      assert.equal(report.code, 'INVALID_EVIDENCE', context);
      assert.equal(report.history.newestProfileReceiptId, '2', context);
      assert.deepEqual(report.receipts, [], context);
    }
  }
});

test('Python whitespace-only text invalidates a tampered positive report', async () => {
  const good = await evaluateAssurance(state().reader, policy());
  for (const character of pythonWhitespace) {
    for (const field of ['name', 'claimed_model']) {
      const changed = structuredClone(good);
      changed.profile[field] = character.repeat(3);
      assert.equal(matchesAssuranceReport(changed, policy()), false, field);
    }
    for (const [field, assign] of receiptTextFields) {
      const changed = structuredClone(good);
      assign(changed.receipts[0], character.repeat(3));
      assert.equal(matchesAssuranceReport(changed, policy()), false, field);
    }
  }
});

test('Python-nonblank BOM-only text is valid and stays unchanged', async () => {
  for (const value of ['\ufeff', '\u0085\ufeff\u001f']) {
    const p = { ...profile(), name: '\ufeff', claimed_model: '\ufeff' };
    const r = receipt();
    for (const [, assign] of receiptTextFields) assign(r, value);
    const report = await evaluateAssurance(state([r], p).reader, policy());
    assert.equal(report.decision, 'ALLOW');
    assert.deepEqual(report.profile, p);
    assert.deepEqual(report.receipts, [r]);
    assert.equal(matchesAssuranceReport(report, policy()), true);
  }
});

test('Python whitespace around nonblank evidence is preserved, not normalized', async () => {
  const whitespace = pythonWhitespace.join('');
  const r = receipt();
  for (const [, assign] of receiptTextFields)
    assign(r, whitespace + 'Exact evidence.' + whitespace);
  const report = await evaluateAssurance(state([r]).reader, policy());
  assert.equal(report.decision, 'ALLOW');
  assert.deepEqual(report.receipts, [r]);
  assert.equal(matchesAssuranceReport(report, policy()), true);
});

test('Unicode code-point field limits still match Python at the boundary', async () => {
  for (const [field, limit, assign] of [
    [
      'name',
      100,
      (p, _r, value) => {
        p.name = value;
      },
    ],
    [
      'claimed_model',
      140,
      (p, _r, value) => {
        p.claimed_model = value;
      },
    ],
    [
      'summary',
      600,
      (_p, r, value) => {
        r.summary = value;
      },
    ],
    [
      'reason',
      300,
      (_p, r, value) => {
        r.probes[0].reason = value;
      },
    ],
    [
      'output',
      2000,
      (_p, r, value) => {
        r.observations[0].output = value;
      },
    ],
  ]) {
    const p = profile();
    const r = receipt();
    // Keep the six-field escaped JSON payload below 24,000 characters too.
    const value =
      field === 'output'
        ? '\u{1f600}'.repeat(1000) + 'x'.repeat(1000)
        : '\u{1f600}'.repeat(limit);
    assign(p, r, value);
    const valid = await evaluateAssurance(state([r], p).reader, policy());
    assert.equal(valid.decision, 'ALLOW', field);
    assert.equal(matchesAssuranceReport(valid, policy()), true, field);
    assign(p, r, value + 'x');
    const invalid = await evaluateAssurance(state([r], p).reader, policy());
    assert.equal(invalid.decision, 'BLOCK', field);
    assert.equal(
      invalid.code,
      ['name', 'claimed_model'].includes(field)
        ? 'INVALID_STATE'
        : 'INVALID_EVIDENCE',
      field,
    );
  }
});

test('optional suite pin is enforced', async () => {
  const { reader } = state();
  assert.equal(
    (
      await evaluateAssurance(reader, {
        ...policy(),
        expectedSuiteSha256: 'c'.repeat(64),
      })
    ).decision,
    'ALLOW',
  );
  const wrong = await evaluateAssurance(reader, {
    ...policy(),
    expectedSuiteSha256: 'f'.repeat(64),
  });
  assert.equal(wrong.decision, 'BLOCK');
  assert.equal(wrong.code, 'POLICY_MISMATCH');
});
for (const status of ['DRIFT_DETECTED', 'INCONCLUSIVE']) {
  test(
    'newest ' + status + ' cannot fall back to an older passing receipt',
    async () => {
      const { reader } = state([receipt(1), receipt(2, status)]);
      const report = await evaluateAssurance(reader, policy());
      assert.equal(report.decision, 'BLOCK');
      assert.equal(report.code, status);
      assert.equal(report.history.newestProfileReceiptId, '2');
      assert.deepEqual(
        report.receipts.map((r) => r.id),
        ['2'],
      );
    },
  );
}
test('an unverified canonical inconclusive receipt blocks, not invalid-success fallback', async () => {
  const r = {
    ...receipt(),
    baseline_verified: false,
    status: 'INCONCLUSIVE',
    summary: 'Endpoint did not return a verifiable challenge response',
    probes: [],
    observations: [],
    suite_sha256: '',
  };
  const { reader } = state([r]);
  const report = await evaluateAssurance(reader, policy());
  assert.equal(report.code, 'INCONCLUSIVE');
  assert.equal(report.decision, 'BLOCK');
});
test('the minimum applies to consecutive newest receipts, never a cherry-picked total', async () => {
  const rows = [receipt(1), receipt(2, 'DRIFT_DETECTED'), receipt(3)];
  const { reader } = state(rows);
  const one = await evaluateAssurance(reader, policy(1));
  assert.equal(one.decision, 'ALLOW');
  const two = await evaluateAssurance(reader, policy(2));
  assert.equal(two.code, 'DRIFT_DETECTED');
  assert.equal(two.decision, 'BLOCK');
  assert.deepEqual(
    two.receipts.map((r) => r.id),
    ['3', '2'],
  );
});
test('multiple passing receipts preserve newest-first evidence and distinct nonces', async () => {
  const { reader } = state([receipt(1), receipt(2), receipt(3)]);
  const report = await evaluateAssurance(reader, policy(3));
  assert.equal(report.decision, 'ALLOW');
  assert.deepEqual(
    report.receipts.map((r) => r.id),
    ['3', '2', '1'],
  );
  assert.equal(report.history.consecutiveConsistentReceipts, 3);
});
test('global pagination searches backward across other profiles', async () => {
  const rows = Array.from({ length: 47 }, (_, i) =>
    receipt(i + 1, 'CONSISTENT', '2'),
  );
  rows[5] = receipt(6);
  rows[26] = receipt(27);
  const { reader, calls } = state(rows);
  const report = await evaluateAssurance(reader, policy(2));
  assert.equal(report.decision, 'ALLOW');
  assert.deepEqual(
    report.receipts.map((r) => r.id),
    ['27', '6'],
  );
  assert.deepEqual(
    calls.filter((c) => c.method === 'list_receipts').map((c) => c.args),
    [
      [27, 20],
      [7, 20],
      [0, 7],
    ],
  );
  assert.equal(report.history.scannedRows, 42);
});
test('the global 100-row ceiling blocks rather than pretending a target has no audits', async () => {
  const rows = Array.from({ length: 121 }, (_, i) =>
    receipt(i + 1, 'CONSISTENT', '2'),
  );
  rows[0] = receipt(1);
  const { reader, calls } = state(rows);
  const report = await evaluateAssurance(reader, policy());
  assert.equal(report.code, 'SEARCH_LIMIT');
  assert.equal(report.decision, 'BLOCK');
  assert.equal(report.history.scannedRows, MAX_HISTORY_ROWS);
  assert.equal(report.history.reachedStart, false);
  assert.equal(calls.filter((c) => c.method === 'list_receipts').length, 5);
});
test('search limit also blocks a partially satisfied consecutive minimum', async () => {
  const rows = Array.from({ length: 101 }, (_, i) =>
    receipt(i + 1, 'CONSISTENT', '2'),
  );
  rows[0] = receipt(1);
  rows[100] = receipt(101);
  const { reader } = state(rows);
  const report = await evaluateAssurance(reader, policy(2));
  assert.equal(report.code, 'SEARCH_LIMIT');
  assert.equal(report.history.consecutiveConsistentReceipts, 1);
});
test('history exhaustion distinguishes no receipts from too few passing receipts', async () => {
  for (const rows of [[], [receipt(1, 'CONSISTENT', '2')]]) {
    const report = await evaluateAssurance(state(rows).reader, policy());
    assert.equal(report.code, 'NO_RECEIPT');
    assert.equal(report.history.reachedStart, true);
  }
  const short = await evaluateAssurance(state([receipt()]).reader, policy(2));
  assert.equal(short.code, 'INSUFFICIENT_HISTORY');
  assert.equal(short.decision, 'BLOCK');
});
test('inactive profiles block without reading history', async () => {
  const { reader, calls } = state([receipt()], { ...profile(), active: false });
  const report = await evaluateAssurance(reader, policy());
  assert.equal(report.code, 'PROFILE_INACTIVE');
  assert.equal(
    calls.some((c) => c.method === 'list_receipts'),
    false,
  );
});
test('missing profile and inconsistent profile count fail closed', async () => {
  const missing = await evaluateAssurance(state([], null).reader, policy());
  assert.equal(missing.code, 'PROFILE_MISSING');
  const inconsistent = state([], null, {
    get_counts: () => ({ profiles: 1, receipts: 0, version: '2' }),
  });
  assert.equal(
    (await evaluateAssurance(inconsistent.reader, policy())).code,
    'STATE_CHANGED',
  );
});
test('consumer endpoint and baseline pins cannot silently follow on-chain values', async () => {
  for (const patch of [
    { expectedEndpoint: 'https://different.org/' },
    { expectedBaselineDigest: 'f'.repeat(64) },
  ]) {
    const report = await evaluateAssurance(state().reader, {
      ...policy(),
      ...patch,
    });
    assert.equal(report.code, 'POLICY_MISMATCH');
    assert.equal(report.decision, 'BLOCK');
  }
});
for (const [name, mutate] of [
  [
    'unverified success',
    (r) => {
      r.baseline_verified = false;
    },
  ],
  [
    'string verification flag',
    (r) => {
      r.baseline_verified = 'true';
    },
  ],
  [
    'unsupported status',
    (r) => {
      r.status = 'PASS';
    },
  ],
  [
    'contradictory probe',
    (r) => {
      r.probes[0].verdict = 'DRIFT';
    },
  ],
  [
    'array-coerced verdict',
    (r) => {
      r.probes[0].verdict = ['MATCH'];
    },
  ],
  [
    'duplicate probes',
    (r) => {
      r.probes[1].id = r.probes[0].id;
    },
  ],
  [
    'missing observation',
    (r) => {
      r.observations.pop();
    },
  ],
  [
    'duplicate observations',
    (r) => {
      r.observations[1].probe_id = r.observations[0].probe_id;
    },
  ],
  [
    'extra observation',
    (r) => {
      r.observations.push({ ...r.observations[0] });
    },
  ],
  [
    'unrelated observation',
    (r) => {
      r.observations[0].probe_id = 'unexpected';
    },
  ],
  [
    'bad response hash',
    (r) => {
      r.observations[0].response_sha256 = 'd'.repeat(63);
    },
  ],
  [
    'bad suite hash',
    (r) => {
      r.suite_sha256 = 'C'.repeat(64);
    },
  ],
  [
    'odd nonce',
    (r) => {
      r.nonce = 'a'.repeat(33);
    },
  ],
  [
    'bad requester',
    (r) => {
      r.requester = '';
    },
  ],
  [
    'wrong endpoint',
    (r) => {
      r.endpoint = 'https://different.org/';
    },
  ],
  [
    'wrong baseline',
    (r) => {
      r.baseline_digest = 'f'.repeat(64);
    },
  ],
  [
    'wrong baseline URL',
    (r) => {
      r.baseline_url = blob + 'other.json';
    },
  ],
  [
    'wrong suite URL',
    (r) => {
      r.probe_suite_url = blob + 'other.json';
    },
  ],
  [
    'empty output',
    (r) => {
      r.observations[0].output = ' \t ';
    },
  ],
  [
    'oversized output',
    (r) => {
      r.observations[0].output = 'x'.repeat(2001);
    },
  ],
  [
    'empty reason',
    (r) => {
      r.probes[0].reason = ' ';
    },
  ],
  [
    'oversized reason',
    (r) => {
      r.probes[0].reason = 'x'.repeat(301);
    },
  ],
  [
    'empty summary',
    (r) => {
      r.summary = '';
    },
  ],
  [
    'extra receipt fields',
    (r) => {
      r.fake_certificate = true;
    },
  ],
  [
    'extra observation fields',
    (r) => {
      r.observations[0].trusted = true;
    },
  ],
  [
    'incomplete probe row',
    (r) => {
      delete r.probes[0].reason;
    },
  ],
]) {
  test('malformed newest evidence blocks: ' + name, async () => {
    const bad = receipt(2);
    mutate(bad);
    const report = await evaluateAssurance(
      state([receipt(1), bad]).reader,
      policy(),
    );
    assert.equal(report.decision, 'BLOCK');
    assert.equal(report.code, 'INVALID_EVIDENCE');
    assert.equal(report.history.newestProfileReceiptId, '2');
    assert.equal(report.receipts.length, 0);
  });
}
test('noncanonical unverified reasons cannot masquerade as a valid receipt', async () => {
  const r = {
    ...receipt(),
    baseline_verified: false,
    status: 'INCONCLUSIVE',
    summary: 'Custom provider said it is safe',
    probes: [],
    observations: [],
    suite_sha256: '',
  };
  assert.equal(
    (await evaluateAssurance(state([r]).reader, policy())).code,
    'INVALID_EVIDENCE',
  );
});
test('repeated nonce or inconsistent suites/coverage across a required sequence block', async () => {
  for (const mutate of [
    (r) => {
      r.nonce = receipt(2).nonce;
    },
    (r) => {
      r.suite_sha256 = 'f'.repeat(64);
    },
    (r) => {
      r.probes.pop();
      r.observations.pop();
    },
  ]) {
    const older = receipt(1);
    mutate(older);
    const report = await evaluateAssurance(
      state([older, receipt(2)]).reader,
      policy(2),
    );
    assert.equal(report.code, 'INVALID_EVIDENCE');
    assert.equal(report.decision, 'BLOCK');
  }
});
test('canonical status aggregation gives inconclusive priority over drift', async () => {
  const r = receipt(1, 'DRIFT_DETECTED');
  r.status = 'INCONCLUSIVE';
  r.probes[1].verdict = 'INCONCLUSIVE';
  const report = await evaluateAssurance(state([r]).reader, policy());
  assert.equal(report.code, 'INCONCLUSIVE');
});
for (const [name, page] of [
  ['short page', [receipt(1)]],
  ['reversed page', [receipt(2), receipt(1)]],
  ['duplicate IDs', [receipt(1), receipt(1)]],
  ['wrong IDs', [receipt(3), receipt(4)]],
  ['invalid profile ID', [receipt(1), { ...receipt(2), profile_id: '0' }]],
  [
    'unregistered profile ID',
    [receipt(1), { ...receipt(2), profile_id: '10000' }],
  ],
  ['non-array', {}],
]) {
  test('invalid history coverage blocks: ' + JSON.stringify(name), async () => {
    const { reader } = state([receipt(1), receipt(2)], profile(), {
      list_receipts: () => page,
    });
    const report = await evaluateAssurance(reader, policy());
    assert.equal(report.code, 'INVALID_STATE');
    assert.equal(report.decision, 'BLOCK');
  });
}
test('unsupported version and invalid counts cannot produce a positive gate', async () => {
  for (const patch of [
    { version: '3' },
    { profiles: '1' },
    { receipts: -1 },
    { receipts: 10_001 },
    { receipts: 1.5 },
    { invented: true },
  ]) {
    const { reader } = state(undefined, undefined, {
      get_counts: () => ({ profiles: 1, receipts: 1, version: '2', ...patch }),
    });
    const report = await evaluateAssurance(reader, policy());
    assert.equal(report.decision, 'BLOCK');
    assert.equal(
      report.code,
      patch.version ? 'UNSUPPORTED_CONTRACT' : 'INVALID_STATE',
    );
  }
});
test('invalid profile schema cannot be treated as active and trustworthy', async () => {
  for (const patch of [
    { id: '2' },
    { owner: 'not-address' },
    { active: 'true' },
    {
      probe_suite_url:
        'https://github.com/example/modelseal/blob/main/suite.json',
    },
    { baseline_url: blob + '../baseline.json' },
    { extra: true },
  ]) {
    const report = await evaluateAssurance(
      state([receipt()], { ...profile(), ...patch }).reader,
      policy(),
    );
    assert.equal(report.code, 'INVALID_STATE');
    assert.equal(report.decision, 'BLOCK');
  }
});
test('a finalized count changing before completion invalidates a passing result', async () => {
  let reads = 0;
  const { reader } = state(undefined, undefined, {
    get_counts: () => ({
      profiles: 1,
      receipts: ++reads === 1 ? 1 : 2,
      version: '2',
    }),
  });
  const report = await evaluateAssurance(reader, policy());
  assert.equal(report.code, 'STATE_CHANGED');
  assert.equal(report.decision, 'BLOCK');
  assert.equal(report.snapshotCheck, 'not-confirmed');
});
test('profile deactivation during the read invalidates a passing result', async () => {
  let reads = 0;
  const { reader } = state(undefined, undefined, {
    get_profile: () => ({ ...profile(), active: ++reads === 1 }),
  });
  const report = await evaluateAssurance(reader, policy());
  assert.equal(report.code, 'STATE_CHANGED');
  assert.equal(report.decision, 'BLOCK');
});
test('read errors never leak messages or reuse a previous ALLOW', async () => {
  const good = await evaluateAssurance(state().reader, policy());
  assert.equal(good.decision, 'ALLOW');
  const secret = 'PRIVATE_TOKEN_SHOULD_NOT_LEAK';
  for (const method of ['get_counts', 'get_profile', 'list_receipts']) {
    const bad = state(undefined, undefined, {
      [method]: () => {
        throw new Error(secret);
      },
    });
    const report = await evaluateAssurance(bad.reader, policy());
    assert.equal(report.code, 'READ_FAILED');
    assert.equal(report.decision, 'BLOCK');
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
});
test('a failed final recheck cannot authorize an earlier passing sequence', async () => {
  let reads = 0;
  const { reader } = state(undefined, undefined, {
    get_profile: () => {
      if (++reads === 2) throw new Error('RPC outage');
      return profile();
    },
  });
  const report = await evaluateAssurance(reader, policy());
  assert.equal(report.code, 'READ_FAILED');
  assert.equal(report.decision, 'BLOCK');
});
test('hung RPC reads meet the deadline and fail closed', async () => {
  const report = await evaluateAssurance(
    () => new Promise(() => {}),
    policy(),
    { timeoutMs: 20 },
  );
  assert.equal(report.code, 'READ_TIMEOUT');
  assert.equal(report.decision, 'BLOCK');
});
test('bad deadlines do not start a read', async () => {
  const { reader, calls } = state();
  for (const timeoutMs of [0, -1, 30_001, NaN, Infinity])
    await assert.rejects(
      evaluateAssurance(reader, policy(), { timeoutMs }),
      TypeError,
    );
  assert.equal(calls.length, 0);
});
test('policy mutation after starting cannot redirect the scope', async () => {
  const pin = policy();
  const { reader } = state();
  const pending = evaluateAssurance(reader, pin);
  pin.expectedEndpoint = 'https://changed.org/';
  const report = await pending;
  assert.equal(report.decision, 'ALLOW');
  assert.equal(report.policy.expectedEndpoint, profile().endpoint);
});
test('HTTP handler returns scoped JSON and prohibits caching even on ALLOW', async () => {
  const { reader, calls } = state();
  const pin = policy();
  const response = await assuranceResponse(
    new Request('http://localhost/api/assurance?' + assuranceQuery(pin)),
    async (address, method, args) => {
      assert.equal(address, contract);
      return reader(method, args);
    },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(matchesAssuranceReport(await response.json(), pin), true);
  assert.ok(calls.length > 0);
});
test('a policy BLOCK is HTTP 200, not an HTTP-only authorization', async () => {
  const { reader } = state([receipt(1, 'DRIFT_DETECTED')]);
  const response = await assuranceResponse(
    new Request('http://localhost/api/assurance?' + assuranceQuery(policy())),
    (_address, method, args) => reader(method, args),
  );
  const report = await response.json();
  assert.equal(response.status, 200);
  assert.equal(report.decision, 'BLOCK');
  assert.equal(matchesAssuranceReport(report, policy()), true);
});
test('HTTP rejects unknown/missing/oversized input without reaching the network', async () => {
  let reads = 0;
  for (const query of [
    '',
    assuranceQuery(policy()) + '&rpc=https://evil.org/',
    'x=' + 'a'.repeat(2001),
  ]) {
    const response = await assuranceResponse(
      new Request('http://localhost/api/assurance?' + query),
      async () => {
        reads++;
        throw new Error('must not read');
      },
    );
    assert.equal(response.status, 400);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  assert.equal(reads, 0);
});
test('HTTP unavailable/timeout results stay BLOCK with no cache fallback', async () => {
  for (const [read, options, code] of [
    [
      async () => {
        throw new Error('secret');
      },
      {},
      'READ_FAILED',
    ],
    [() => new Promise(() => {}), { timeoutMs: 20 }, 'READ_TIMEOUT'],
  ]) {
    const response = await assuranceResponse(
      new Request('http://localhost/api/assurance?' + assuranceQuery(policy())),
      read,
      options,
    );
    assert.equal(response.status, 503);
    const report = await response.json();
    assert.equal(report.code, code);
    assert.equal(report.decision, 'BLOCK');
    assert.equal(matchesAssuranceReport(report, policy()), true);
  }
});
test('report validation rejects mismatched scope, loose ALLOW and tampered positive evidence', async () => {
  const good = await evaluateAssurance(state().reader, policy());
  assert.equal(matchesAssuranceReport(good, policy()), true);
  for (const mutate of [
    (r) => {
      r.schema = 'other';
    },
    (r) => {
      r.policy.profileId = '2';
    },
    (r) => {
      r.policy.expectedBaselineDigest = 'f'.repeat(64);
    },
    (r) => {
      r.policy.contract = owner;
    },
    (r) => {
      r.finality = 'latest';
    },
    (r) => {
      r.snapshotCheck = 'not-confirmed';
    },
    (r) => {
      r.code = 'READ_FAILED';
    },
    (r) => {
      r.auditTime = r.checkedAt;
    },
    (r) => {
      r.receipts = [];
    },
    (r) => {
      r.receipts[0].status = 'INCONCLUSIVE';
    },
    (r) => {
      r.receipts[0].observations = [];
    },
    (r) => {
      r.receipts[0].nonce = 'a';
    },
    (r) => {
      r.profile.active = false;
    },
    (r) => {
      r.history.newestProfileReceiptId = '2';
    },
    (r) => {
      r.history.scannedRows = 0;
    },
    (r) => {
      r.history.consecutiveConsistentReceipts = 0;
    },
    (r) => {
      r.counts.receipts = 0;
    },
    (r) => {
      r.limitations = [];
    },
    (r) => {
      r.checkedAt = 'fresh';
    },
  ]) {
    const changed = structuredClone(good);
    mutate(changed);
    assert.equal(matchesAssuranceReport(changed, policy()), false);
  }
  assert.equal(matchesAssuranceReport({ decision: 'ALLOW' }, policy()), false);
  assert.equal(matchesAssuranceReport(null, policy()), false);
});
test('report validation requires distinct, ordered positive receipts and coherent policy metadata', async () => {
  const pin = policy(2);
  const good = await evaluateAssurance(
    state([receipt(1), receipt(2)]).reader,
    pin,
  );
  for (const mutate of [
    (r) => {
      r.receipts.reverse();
    },
    (r) => {
      r.receipts[1].id = r.receipts[0].id;
    },
    (r) => {
      r.receipts[1].nonce = r.receipts[0].nonce;
    },
    (r) => {
      r.receipts[1].suite_sha256 = 'f'.repeat(64);
    },
    (r) => {
      r.policy.maxHistoryRows = 999;
    },
    (r) => {
      r.policy.minConsistentReceipts = 1;
    },
  ]) {
    const changed = structuredClone(good);
    mutate(changed);
    assert.equal(matchesAssuranceReport(changed, pin), false);
  }
});

test('CLI integration exits zero only for an OK, scoped and verified ALLOW report', async () => {
  const pin = policy();
  const good = await evaluateAssurance(state().reader, pin);
  const blocked = await evaluateAssurance(
    state([receipt(1, 'DRIFT_DETECTED')]).reader,
    pin,
  );
  let payload = good;
  let status = 200;
  let redirect = false;
  const server = createServer((_request, response) => {
    response.writeHead(redirect ? 302 : status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(redirect ? { Location: '/api/assurance' } : {}),
    });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const url =
      'http://127.0.0.1:' + port + '/api/assurance?' + assuranceQuery(pin);
    async function run(address = url) {
      return await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            '--experimental-strip-types',
            fileURLToPath(
              new URL('../scripts/check-assurance.mjs', import.meta.url),
            ),
            address,
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let output = '';
        child.stdout.on('data', (data) => {
          output += data;
        });
        child.stderr.on('data', (data) => {
          output += data;
        });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, output }));
      });
    }
    assert.equal((await run()).code, 0);
    payload = blocked;
    const block = await run();
    assert.equal(block.code, 1);
    assert.match(block.output, /DRIFT_DETECTED/);
    payload = { decision: 'ALLOW' };
    assert.equal((await run()).code, 1);
    payload = structuredClone(good);
    payload.policy.contract = owner;
    assert.equal((await run()).code, 1);
    payload = good;
    status = 503;
    assert.equal((await run()).code, 1);
    status = 200;
    redirect = true;
    assert.equal((await run()).code, 1);
    redirect = false;
    assert.equal(
      (await run(url.replace('/api/assurance?', '/other?'))).code,
      1,
    );
    assert.equal((await run('http://remote.invalid/api/assurance')).code, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
