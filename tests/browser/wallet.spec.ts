import { test, expect } from '@playwright/test';
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
});
