import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  protectTransactions,
  loadPending,
  finalizedSuccess,
  settled,
  PENDING_KEY,
} from '../lib/transaction-safety.ts';

const account = '0x' + '1'.repeat(40);
const address = '0x' + '2'.repeat(40);
const hash = '0x' + 'a'.repeat(64);
const evmHash = '0x' + 'b'.repeat(64);
const scope = { account, address, chainId: 61997, label: 'Audit endpoint' };
const tx = {
  kind: 'write',
  address,
  method: 'audit_endpoint',
  args: ['1', 'c'.repeat(48)],
};
function setup() {
  const data = new Map();
  const storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
  const state = {
    account,
    chain: '0xf22d',
    active: true,
    submits: 0,
    stage: 'ok',
    current: null,
    send: false,
  };
  const provider = {
    async request({ method }) {
      if (method === 'eth_accounts') return [state.account];
      if (method === 'eth_chainId') return state.chain;
      if (method === 'eth_sendTransaction') return evmHash;
      throw new Error('Unexpected wallet call: ' + method);
    },
  };
  const make = () =>
    protectTransactions(
      (p) => ({
        async submit() {
          state.submits++;
          assert.equal(loadPending(storage).stage, 'signing');
          if (state.send) await p.request({ method: 'eth_sendTransaction' });
          if (state.stage === 'reject')
            throw Object.assign(new Error('User rejected'), { code: 4001 });
          if (state.stage === 'unknown')
            throw new Error('RPC timeout after submission');
          return { genlayerTxId: hash, evmTxHash: evmHash };
        },
        async track(id, update) {
          update({
            phase: 'decided',
            statusName: 'ACCEPTED',
            successful: true,
            genlayerTxId: id,
          });
          if (state.stage === 'timeout') throw new Error('Tracking timeout');
          const result = {
            phase: 'finalized',
            statusName: 'FINALIZED',
            successful: true,
            genlayerTxId: id,
          };
          update(result);
          return result;
        },
        async cancel() {
          return { transaction_hash: hash, status: 'CANCELED' };
        },
        async topUp() {
          return evmHash;
        },
      }),
      provider,
      scope,
      storage,
      (r) => {
        state.current = r;
      },
      () => state.active,
    );
  return { state, storage, kit: make(), make };
}

test('ACCEPTED and unknown execution are never successful finalization', () => {
  assert.equal(finalizedSuccess({ phase: 'decided', successful: true }), false);
  assert.equal(finalizedSuccess({ phase: 'finalized' }), false);
  assert.equal(
    finalizedSuccess({ phase: 'finalized', successful: false }),
    false,
  );
  assert.equal(
    finalizedSuccess({ phase: 'finalized', successful: true }),
    true,
  );
  assert.equal(settled({ phase: 'decided', statusName: 'ACCEPTED' }), false);
});
test('records submission before signing and persists the final status', async () => {
  const { kit, state, storage } = setup();
  await kit.submit({}, tx);
  assert.equal(loadPending(storage).genlayerTxId, hash);
  await kit.track(hash, () => {});
  assert.equal(loadPending(storage).stage, 'finalized');
  assert.equal(finalizedSuccess(state.current.status), true);
});
test('same panel and a reloaded/new panel cannot submit twice', async () => {
  const { kit, make, state } = setup();
  await kit.submit({}, tx);
  await assert.rejects(kit.submit({}, tx), /already recorded/);
  await assert.rejects(make().submit({}, tx), /already recorded/);
  assert.equal(state.submits, 1);
});
for (const change of ['account', 'chain', 'disconnect'])
  test(`${change} change blocks signing`, async () => {
    const { kit, state, storage } = setup();
    if (change === 'account') state.account = address;
    if (change === 'chain') state.chain = '0x1';
    if (change === 'disconnect') state.active = false;
    await assert.rejects(kit.submit({}, tx), /changed|disconnected/);
    assert.equal(state.submits, 0);
    assert.equal(loadPending(storage), null);
  });
test('RPC ambiguity retains a blocking record across reload', async () => {
  const { kit, state, storage, make } = setup();
  state.stage = 'unknown';
  state.send = true;
  await assert.rejects(kit.submit({}, tx), /timeout/);
  assert.equal(loadPending(storage).stage, 'unknown');
  assert.equal(loadPending(storage).evmTxHash, evmHash);
  await assert.rejects(make().submit({}, tx), /already recorded/);
});
test('explicit wallet rejection releases the record without claiming success', async () => {
  const { kit, state, storage } = setup();
  state.stage = 'reject';
  await assert.rejects(kit.submit({}, tx), /rejected/);
  assert.equal(loadPending(storage), null);
  state.stage = 'ok';
  await kit.submit({}, tx);
  assert.equal(state.submits, 2);
});
test('tracking failure preserves the known hash and ACCEPTED is not finalized', async () => {
  const { kit, state, storage } = setup();
  await kit.submit({}, tx);
  state.stage = 'timeout';
  await assert.rejects(
    kit.track(hash, () => {}),
    /timeout/,
  );
  const record = loadPending(storage);
  assert.equal(record.genlayerTxId, hash);
  assert.equal(record.stage, 'unknown');
  assert.equal(finalizedSuccess(record.status), false);
});
test('corrupt recovery data fails closed and cannot authorize a write', async () => {
  const { kit, state, storage } = setup();
  storage.setItem(PENDING_KEY, '{}');
  await assert.rejects(kit.submit({}, tx), /invalid/);
  assert.equal(state.submits, 0);
});
test('transaction cannot target another contract', async () => {
  const { kit, state } = setup();
  await assert.rejects(
    kit.submit({}, { ...tx, address: account }),
    /target changed/,
  );
  assert.equal(state.submits, 0);
});
test('cancel and top-up re-check the wallet too', async () => {
  const { kit, state } = setup();
  await kit.submit({}, tx);
  state.account = address;
  await assert.rejects(kit.cancel({ hash }), /changed/);
  await assert.rejects(kit.topUp({ txId: hash }), /changed/);
});
