import { test, expect, type Page } from '@playwright/test';
import { abi } from 'genlayer-js';
import { fromRlp, toHex } from 'viem';
import {
  evaluateAssurance,
  assuranceQuery,
  type AssurancePolicy,
} from '../../lib/assurance';

const CONTRACT = '0x2222222222222222222222222222222222222222';
const RPC = 'https://studio-dev.genlayer.com/api';
const endpoint = 'https://modelseal.vercel.app/api/fixture/baseline';
const blob = 'https://github.com/example/repo/blob/' + 'a'.repeat(40) + '/';
const profile = {
  id: '1',
  owner: '0x1111111111111111111111111111111111111111',
  name: 'Programmed fixture',
  claimed_model: 'Programmed fixture',
  endpoint,
  baseline_digest: 'b'.repeat(64),
  active: true,
  probe_suite_url: blob + 'suite.json',
  baseline_url: blob + 'baseline.json',
};
const receipt = {
  id: '1',
  profile_id: '1',
  requester: profile.owner,
  nonce: 'd'.repeat(48),
  endpoint,
  probe_suite_url: profile.probe_suite_url,
  baseline_url: profile.baseline_url,
  baseline_digest: profile.baseline_digest,
  suite_sha256: 'c'.repeat(64),
  baseline_verified: true,
  status: 'CONSISTENT',
  summary: 'Programmed fixture matched.',
  probes: [
    { id: 'idempotency', verdict: 'MATCH', reason: 'Same retry behavior.' },
  ],
  observations: [
    {
      probe_id: 'idempotency',
      output: 'No duplicate effect.',
      response_sha256: 'e'.repeat(64),
    },
  ],
};
function pin(minimum = 1): AssurancePolicy {
  return {
    contract: CONTRACT,
    profileId: '1',
    expectedEndpoint: endpoint,
    expectedBaselineDigest: profile.baseline_digest,
    minConsistentReceipts: minimum,
  };
}
async function result(policy = pin(), status = 'CONSISTENT') {
  const row = {
    ...receipt,
    status,
    probes: [
      {
        ...receipt.probes[0],
        verdict:
          status === 'CONSISTENT'
            ? 'MATCH'
            : status === 'DRIFT_DETECTED'
              ? 'DRIFT'
              : 'INCONCLUSIVE',
      },
    ],
  };
  return evaluateAssurance(async (method, args) => {
    if (method === 'get_counts')
      return { profiles: 1, receipts: 1, version: '2' };
    if (method === 'get_profile') return profile;
    return args[0] === 0 ? [row] : [];
  }, policy);
}
async function setup(page: Page) {
  // Dashboard RPC and gate API are explicitly mocked. These tests do not
  // claim live consensus and do not perform wallet writes.
  await page.route(RPC, async (route) => {
    const body = route.request().postDataJSON();
    if (body.method !== 'gen_call') {
      await route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32601, message: 'Read-only test' },
        },
      });
      return;
    }
    expect(body.params[0].transaction_hash_variant).toBe('latest-final');
    const encoded = fromRlp(body.params[0].data, 'bytes') as Uint8Array[];
    const call = abi.calldata.decode(encoded[0]) as Map<string, unknown>;
    const method = call.get('');
    const value =
      method === 'get_counts'
        ? { profiles: 1, receipts: 1, version: '2' }
        : method === 'list_profiles'
          ? [profile]
          : [receipt];
    await route.fulfill({
      json: {
        jsonrpc: '2.0',
        id: body.id,
        result: toHex(abi.calldata.encode(value)),
      },
    });
  });
  await page.goto('/');
  await page.getByLabel('Studio Next ModelSeal contract').fill(CONTRACT);
  await page
    .getByRole('button', { name: 'Load contract', exact: true })
    .click();
  await expect(
    page.getByText('Reading finalized state on Studio Next.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Audit Gate', exact: true }).click();
}
async function populate(page: Page) {
  await page
    .getByLabel('Use pins from a loaded profile', { exact: false })
    .selectOption('1');
  await expect(page.getByLabel('Profile ID', { exact: true })).toHaveValue('1');
  await expect(
    page.getByLabel('Expected baseline SHA-256', { exact: true }),
  ).toHaveValue(profile.baseline_digest);
}
test('disconnected wallet can check a pinned policy and download actual report', async ({
  page,
}, testInfo) => {
  const report = await result();
  await page.route('**/api/assurance?*', async (route) => {
    expect(new URL(route.request().url()).searchParams.toString()).toBe(
      assuranceQuery(pin()),
    );
    expect(route.request().method()).toBe('GET');
    await route.fulfill({ json: report });
  });
  await setup(page);
  const check = page.getByRole('button', {
    name: 'Check policy · no transaction',
  });
  await expect(check).toBeDisabled();
  await expect(page.getByText('Policy result: ALLOW')).toHaveCount(0);
  await populate(page);
  await expect(
    page.getByRole('button', { name: 'Connect wallet', exact: true }),
  ).toBeVisible();
  await check.click();
  await expect(
    page.getByRole('heading', { name: 'Policy result: ALLOW' }),
  ).toBeVisible();
  await expect(
    page.getByText('audit time: unavailable', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('region', { name: 'Read-only assurance gate' })
    .screenshot({
      path: testInfo.outputPath('audit-gate-desktop.png'),
    });
  await expect(
    page.getByRole('heading', { name: 'Run live endpoint audit' }),
  ).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download policy report' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    'modelseal-assurance-profile-1.json',
  );
  await expect(
    page.getByRole('link', { name: 'Open read-only JSON API' }),
  ).toHaveAttribute('href', '/api/assurance?' + assuranceQuery(pin()));
});
test('HTTP 200 drift is BLOCK, not a successful authorization', async ({
  page,
}) => {
  await page.route('**/api/assurance?*', async (route) =>
    route.fulfill({ json: await result(pin(), 'DRIFT_DETECTED') }),
  );
  await setup(page);
  await populate(page);
  await page
    .getByRole('button', { name: 'Check policy · no transaction' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Policy result: BLOCK' }),
  ).toBeVisible();
  await expect(page.getByText('DRIFT_DETECTED', { exact: true })).toBeVisible();
  await expect(page.getByText('Policy result: ALLOW')).toHaveCount(0);
});
test('changing pins clears a previously passing result immediately', async ({
  page,
}) => {
  await page.route('**/api/assurance?*', async (route) =>
    route.fulfill({ json: await result() }),
  );
  await setup(page);
  await populate(page);
  await page
    .getByRole('button', { name: 'Check policy · no transaction' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Policy result: ALLOW' }),
  ).toBeVisible();
  await page
    .getByLabel('Expected baseline SHA-256', { exact: true })
    .fill('f'.repeat(64));
  await expect(page.getByText('Policy result: ALLOW')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Download policy report' }),
  ).toHaveCount(0);
});
test('a late ALLOW cannot cross a policy edit or contract switch', async ({
  page,
}) => {
  let requested = false;
  let finish: (() => void) | undefined;
  const released = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/api/assurance?*', async (route) => {
    requested = true;
    await released;
    await route.fulfill({ json: await result() }).catch(() => {});
  });
  await setup(page);
  await populate(page);
  await page
    .getByRole('button', { name: 'Check policy · no transaction' })
    .click();
  await expect.poll(() => requested).toBe(true);
  await page.getByLabel('Profile ID', { exact: true }).fill('2');
  finish!();
  await expect(page.getByText('Policy result: ALLOW')).toHaveCount(0);
  await expect(
    page.getByText('No policy check has been completed.', { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel('Studio Next ModelSeal contract')
    .fill('0x' + '3'.repeat(40));
  await page
    .getByRole('button', { name: 'Load contract', exact: true })
    .click();
  await expect(page.getByLabel('Profile ID', { exact: true })).toHaveValue('');
});
test('RPC outage after an ALLOW never falls back to that result', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/api/assurance?*', async (route) => {
    if (++requests === 1) await route.fulfill({ json: await result() });
    else await route.abort();
  });
  await setup(page);
  await populate(page);
  const check = page.getByRole('button', {
    name: 'Check policy · no transaction',
  });
  await check.click();
  await expect(
    page.getByRole('heading', { name: 'Policy result: ALLOW' }),
  ).toBeVisible();
  await check.click();
  await expect(
    page.getByText('No verified policy result is available.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('Policy result: ALLOW')).toHaveCount(0);
});
test('a stalled request times out, ignores a late ALLOW and permits a retry', async ({
  page,
}) => {
  let requests = 0;
  let stalled = false;
  let finish!: () => void;
  const released = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const report = await result();
  await page.route('**/api/assurance?*', async (route) => {
    if (++requests === 2) {
      stalled = true;
      await released;
    }
    await route.fulfill({ json: report }).catch(() => {});
  });
  try {
    await setup(page);
    await populate(page);
    await page.clock.install();
    const check = page.getByRole('button', {
      name: 'Check policy · no transaction',
    });
    await check.click();
    await expect(page.getByText('Policy result: ALLOW')).toBeVisible();
    await check.click();
    await expect.poll(() => stalled).toBe(true);
    await page.clock.fastForward(15_001);
    await expect(
      page.getByText('Policy check timed out.', { exact: false }),
    ).toBeVisible();
    await expect(check).toBeEnabled();
    await expect(page.getByText('Policy result: ALLOW')).toHaveCount(0);
    finish();
    await expect(
      page.getByText('Policy check timed out.', { exact: false }),
    ).toBeVisible();
    await check.click();
    await expect(page.getByText('Policy result: ALLOW')).toBeVisible();
    await expect.poll(() => requests).toBe(3);
  } finally {
    finish();
  }
});
test('a stalled response body cannot keep the policy check busy indefinitely', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const input = args[0];
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith('/api/assurance?')) {
        // A body stream that never ends also models a transport ignoring abort.
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{'));
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }
      return original(...args);
    };
  });
  await setup(page);
  await populate(page);
  await page.clock.install();
  await page
    .getByRole('button', { name: 'Check policy · no transaction' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Reading newest finalized receipts…' }),
  ).toBeDisabled();
  await page.clock.fastForward(15_001);
  await expect(
    page.getByText('Policy check timed out.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Check policy · no transaction' }),
  ).toBeEnabled();
  await expect(page.getByText('Policy result: ALLOW')).toHaveCount(0);
});
test('a cancelled request deadline cannot overwrite a newer policy result', async ({
  page,
}) => {
  let stalled = false;
  let finish!: () => void;
  const released = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/api/assurance?*', async (route) => {
    const minimum = new URL(route.request().url()).searchParams.get('min');
    if (minimum === '1') {
      stalled = true;
      await released;
    }
    await route
      .fulfill({ json: await result(pin(Number(minimum))) })
      .catch(() => {});
  });
  try {
    await setup(page);
    await populate(page);
    await page.clock.install();
    const check = page.getByRole('button', {
      name: 'Check policy · no transaction',
    });
    await check.click();
    await expect.poll(() => stalled).toBe(true);
    await page
      .getByLabel('Minimum consecutive passing audits')
      .selectOption('2');
    await check.click();
    await expect(page.getByText('Policy result: BLOCK')).toBeVisible();
    await page.clock.fastForward(15_001);
    finish();
    await expect(
      page.getByText('INSUFFICIENT_HISTORY', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Policy check timed out.', { exact: false }),
    ).toHaveCount(0);
    await expect(page.getByText('Policy result: ALLOW')).toHaveCount(0);
  } finally {
    finish();
  }
});
test('wrong-scope API response and thin ALLOW payloads fail closed', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/api/assurance?*', async (route) => {
    const report = await result();
    report.policy.profileId = '2';
    await route.fulfill({
      json: ++requests === 1 ? report : { decision: 'ALLOW' },
    });
  });
  await setup(page);
  await populate(page);
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole('button', { name: 'Check policy · no transaction' })
      .click();
    await expect(
      page.getByText('No verified policy result is available.', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByText('Policy result: ALLOW')).toHaveCount(0);
  }
});
test('raising the minimum requires new evidence and mobile layout stays usable', async ({
  page,
}, testInfo) => {
  await page.route('**/api/assurance?*', async (route) =>
    route.fulfill({ json: await result(pin(2)) }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await populate(page);
  await page.getByLabel('Minimum consecutive passing audits').selectOption('2');
  await page
    .getByRole('button', { name: 'Check policy · no transaction' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Policy result: BLOCK' }),
  ).toBeVisible();
  await expect(
    page.getByText('INSUFFICIENT_HISTORY', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('region', { name: 'Read-only assurance gate' })
    .screenshot({
      path: testInfo.outputPath('audit-gate-mobile.png'),
    });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test('actual route rejects invalid input with no-store, before RPC access', async ({
  request,
}) => {
  for (const path of [
    '/api/assurance',
    '/api/assurance?rpc=https://evil.invalid/',
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(400);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect((await response.json()).error).toBeTruthy();
  }
});
