import { test, expect, type Page } from '@playwright/test';
import { abi } from 'genlayer-js';
import { fromRlp, hexToBytes, toHex } from 'viem';

const contract = '0x2222222222222222222222222222222222222222';
const RPC = 'https://studio-dev.genlayer.com/api';
async function mockFinalizedContract(page: Page) {
  await page.route(RPC, async (route) => {
    const body = route.request().postDataJSON();
    if (body.method !== 'gen_call') {
      await route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: body.id,
          error: {
            code: -32601,
            message: 'No fee estimates in this read-only test',
          },
        },
      });
      return;
    }
    expect(body.params[0].transaction_hash_variant).toBe('latest-final');
    const encoded = fromRlp(body.params[0].data, 'hex') as `0x${string}`[];
    const call = abi.calldata.decode(hexToBytes(encoded[0])) as Map<
      string,
      unknown
    >;
    const method = call.get('');
    const profile = {
      id: '1',
      owner: '0x1111111111111111111111111111111111111111',
      name: 'Test fixture',
      endpoint: 'https://modelseal.vercel.app/api/fixture/baseline',
      claimed_model: 'Programmed fixture',
      probe_suite_url: 'https://github.com/example/repo',
      baseline_url: 'https://github.com/example/repo',
      baseline_digest: 'a'.repeat(64),
      active: true,
    };
    const result =
      method === 'get_counts'
        ? { profiles: 1, receipts: 0, version: '2' }
        : method === 'list_profiles'
          ? [profile]
          : [];
    await route.fulfill({
      json: {
        jsonrpc: '2.0',
        id: body.id,
        result: toHex(abi.calldata.encode(result)),
      },
    });
  });
}

async function loadTestContract(page: Page) {
  await page.getByLabel('Studio Next ModelSeal contract').fill(contract);
  await page
    .getByRole('button', { name: 'Load contract', exact: true })
    .click();
  await expect(
    page.getByText('Reading finalized state on Studio Next.'),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Connect wallet', exact: true })
    .click();
}

async function mockUnavailableContract(page: Page) {
  await page.route(RPC, async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32000, message: 'Unavailable in test' },
      },
    });
  });
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const handlers: Record<string, ((v: unknown) => void)[]> = {};
    let granted = false;
    let chain = '0x1';
    Object.defineProperty(window, 'okxwallet', {
      value: {
        on: (n: string, f: (v: unknown) => void) =>
          (handlers[n] ??= []).push(f),
        removeListener: () => {},
        request: async ({
          method,
          params,
        }: {
          method: string;
          params?: { chainId: string }[];
        }) => {
          if (method === 'eth_accounts')
            return granted
              ? ['0x1111111111111111111111111111111111111111']
              : [];
          if (method === 'eth_requestAccounts') {
            granted = true;
            return ['0x1111111111111111111111111111111111111111'];
          }
          if (method === 'eth_chainId') return chain;
          if (method === 'wallet_switchEthereumChain') {
            chain = params![0].chainId;
            handlers.chainChanged?.forEach((f) => f(chain));
            return null;
          }
          if (method === 'wallet_revokePermissions')
            throw new Error('Unsupported');
          throw new Error('Unexpected wallet method ' + method);
        },
      },
    });
  });
});
test('connect, switch, disconnect, reload and reconnect', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Connect wallet', exact: true })
    .click();
  await expect(page.getByText('Studio Next connected')).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Connect wallet', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Connect wallet', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Connect wallet', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Disconnect', exact: true }),
  ).toBeVisible();
});
test('mobile wallet and navigation remain accessible', async ({ page }) => {
  await mockUnavailableContract(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Connect wallet', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Disconnect', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Endpoints', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Registered endpoints' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Register endpoint', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Register with wallet' }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test('no deployment means no fabricated audit result', async ({ page }) => {
  await mockUnavailableContract(page);
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Submit live audit' }),
  ).toBeDisabled();
  await expect(page.getByText('No finalized receipts loaded.')).toBeVisible();
  await expect(page.getByText('5 / 5 validators')).toHaveCount(0);
  await page.getByRole('button', { name: 'Probe suites', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Immutable suites and baselines' }),
  ).toBeVisible();
});
test('fixture endpoint binds nonce and exposes deliberate drift', async ({
  request,
}) => {
  const data = {
    schema: 'modelseal.challenge.v2',
    nonce: 'a'.repeat(48),
    probe_id: 'idempotency',
    prompt: 'Explain',
  };
  const good = await request.post('/api/fixture/baseline', { data });
  expect(good.status()).toBe(200);
  expect((await good.json()).nonce).toBe(data.nonce);
  const bad = await request.post('/api/fixture/drift', { data });
  expect((await bad.json()).output).toContain('ignore');
  const invalid = await request.post('/api/fixture/invalid', { data });
  expect((await invalid.json()).nonce).not.toBe(data.nonce);
  expect(
    (
      await request.post('/api/fixture/baseline', {
        data: { ...data, nonce: 'a'.repeat(33) },
      })
    ).status(),
  ).toBe(400);
});

test('an unsigned fee review blocks replacement until explicitly closed', async ({
  page,
}) => {
  await mockFinalizedContract(page);
  await page.goto('/');
  await loadTestContract(page);
  const audit = page.getByRole('button', {
    name: 'Submit live audit',
    exact: true,
  });
  await expect(audit).toBeEnabled();
  await audit.click();
  await expect(
    page.getByRole('heading', { name: 'Run live endpoint audit' }),
  ).toBeVisible();
  await expect(audit).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Load contract', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Close unsigned review', exact: true })
    .click();
  await expect(audit).toBeEnabled();
});

test('reload preserves pending hash, wallet scope, and duplicate-write lock', async ({
  page,
}) => {
  await page.addInitScript(
    ({ address }) => {
      localStorage.setItem(
        'modelseal.pending.studio-next.v1',
        JSON.stringify({
          version: 2,
          account: '0x1111111111111111111111111111111111111111',
          address,
          chainId: 61997,
          label: 'Run live endpoint audit',
          startedAt: '2026-09-14T00:00:00Z',
          stage: 'submitted',
          genlayerTxId: '0x' + 'a'.repeat(64),
          status: {
            phase: 'decided',
            statusName: 'ACCEPTED',
            successful: true,
          },
        }),
      );
    },
    { address: contract },
  );
  await mockFinalizedContract(page);
  await page.goto('/');
  await loadTestContract(page);
  await expect(
    page.getByRole('button', { name: 'Submit live audit', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('link', { name: 'Open recorded transaction' }),
  ).toHaveAttribute(
    'href',
    'https://explorer-studio-dev.genlayer.com/tx/0x' + 'a'.repeat(64),
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Transaction recovery' }),
  ).toBeVisible();
  await expect(
    page.getByText('Run live endpoint audit · ACCEPTED'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Clear after manual verification' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Submit live audit', exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('a rejected consensus round is never presented as a completed write', async ({
  page,
}) => {
  // Studio Next finalizes rounds that validators rejected. The transaction is
  // FINALIZED, the leader's execution result is FINISHED_WITH_RETURN, and the
  // transaction-kit `successful` flag is therefore true, yet every storage write
  // was discarded. The dashboard must report the round outcome, not the flag.
  await page.addInitScript(
    ({ address }) => {
      localStorage.setItem(
        'modelseal.pending.studio-next.v1',
        JSON.stringify({
          version: 2,
          account: '0x1111111111111111111111111111111111111111',
          address,
          chainId: 61997,
          label: 'Run live endpoint audit',
          startedAt: '2026-09-14T00:00:00Z',
          stage: 'finalized',
          genlayerTxId: '0x' + 'b'.repeat(64),
          status: {
            phase: 'finalized',
            statusName: 'FINALIZED',
            executionResultName: 'FINISHED_WITH_RETURN',
            successful: true,
          },
          outcome: {
            statusName: 'FINALIZED',
            outcome: 'undetermined',
            executionResultName: 'FINISHED_WITH_RETURN',
            applied: false,
            settled: true,
          },
        }),
      );
    },
    { address: contract },
  );
  await mockFinalizedContract(page);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Transaction recovery' }),
  ).toBeVisible();
  await expect(page.getByText('Nothing was written.')).toBeVisible();
  await expect(
    page.getByText('Validators did not reach a majority', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('Consensus accepted the round')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Dismiss unapplied transaction' }),
  ).toBeEnabled();
});

test('an accepted round is reported as applied', async ({ page }) => {
  await page.addInitScript(
    ({ address }) => {
      localStorage.setItem(
        'modelseal.pending.studio-next.v1',
        JSON.stringify({
          version: 2,
          account: '0x1111111111111111111111111111111111111111',
          address,
          chainId: 61997,
          label: 'Run live endpoint audit',
          startedAt: '2026-09-14T00:00:00Z',
          stage: 'finalized',
          genlayerTxId: '0x' + 'c'.repeat(64),
          status: {
            phase: 'finalized',
            statusName: 'FINALIZED',
            executionResultName: 'FINISHED_WITH_RETURN',
            successful: true,
          },
          outcome: {
            statusName: 'FINALIZED',
            outcome: 'accepted',
            executionResultName: 'FINISHED_WITH_RETURN',
            applied: true,
            settled: true,
          },
        }),
      );
    },
    { address: contract },
  );
  await mockFinalizedContract(page);
  await page.goto('/');
  await expect(
    page.getByText('Consensus accepted the round and applied the write.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Dismiss applied transaction' }),
  ).toBeEnabled();
});
