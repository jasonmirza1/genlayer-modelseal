import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  protectTransactions,
  loadPending,
  executed,
  verified,
  settled,
  PENDING_KEY,
} from '../lib/transaction-safety.ts';

const accepted = {
  statusName: 'FINALIZED',
  outcome: 'accepted',
  executionResultName: 'FINISHED_WITH_RETURN',
  applied: true,
  settled: true,
};
const rejected = {
  statusName: 'FINALIZED',
  outcome: 'undetermined',
  executionResultName: 'FINISHED_WITH_RETURN',
  applied: false,
  settled: true,
};

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
    // What the chain says the consensus round decided, which is the only thing
    // that proves the write landed.
    outcome: accepted,
    verifyCalls: 0,
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
      async () => {
        state.verifyCalls++;
        if (state.outcome === null) throw new Error('RPC unavailable');
        return state.outcome;
      },
    );
  return { state, storage, kit: make(), make };
}

test('a tracked status alone never counts as an executed write', () => {
  // The tracker reports FINALIZED/FINISHED_WITH_RETURN for rounds validators
  // rejected, so a record is only executed once the round outcome is resolved.
  assert.equal(executed({ status: { phase: 'finalized', successful: true } }), false);
  assert.equal(verified({ status: { phase: 'finalized', successful: true } }), false);
  assert.equal(executed({ outcome: rejected }), false);
  assert.equal(verified({ outcome: rejected }), true);
  assert.equal(executed({ outcome: accepted }), true);
  assert.equal(settled({ phase: 'decided', statusName: 'ACCEPTED' }), false);
});
test('records submission before signing and confirms the accepted round', async () => {
  const { kit, state, storage } = setup();
  await kit.submit({}, tx);
  assert.equal(loadPending(storage).genlayerTxId, hash);
  await kit.track(hash, () => {});
  assert.equal(loadPending(storage).stage, 'finalized');
  assert.equal(state.verifyCalls, 1);
  assert.equal(executed(loadPending(storage)), true);
  assert.equal(executed(state.current), true);
});
test('a finalized round that consensus rejected is not an executed write', async () => {
  const { kit, state, storage } = setup();
  state.outcome = rejected;
  await kit.submit({}, tx);
  const status = await kit.track(hash, () => {});
  // The tracker still claims success; the persisted record must not.
  assert.equal(status.successful, true);
  assert.equal(verified(loadPending(storage)), true);
  assert.equal(executed(loadPending(storage)), false);
  assert.equal(loadPending(storage).outcome.outcome, 'undetermined');
});
test('an unresolved round outcome stays unknown instead of successful', async () => {
  const { kit, state, storage } = setup();
  state.outcome = null;
  await kit.submit({}, tx);
  await kit.track(hash, () => {});
  const record = loadPending(storage);
  assert.equal(record.stage, 'unknown');
  assert.equal(verified(record), false);
  assert.equal(executed(record), false);
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
  assert.equal(executed(record), false);
});
test('a later status update cannot keep claiming an earlier applied outcome', async () => {
  // An outcome is derived from one specific status. Once the status is replaced
  // the outcome no longer describes it, so it must not survive and keep the
  // record reading as an applied write.
  const { kit, storage } = setup();
  await kit.submit({}, tx);
  await kit.track(hash, () => {});
  assert.equal(executed(loadPending(storage)), true);
  await kit.cancel({ hash });
  const record = loadPending(storage);
  assert.equal(record.status.statusName, 'CANCELED');
  assert.equal(verified(record), false);
  assert.equal(executed(record), false);
});
test('a record written by the previous build still blocks a second write', async () => {
  // Version 1 predates consensus-outcome verification and carries no `outcome`.
  // It is still an unresolved write, so it must keep loading and keep blocking:
  // a record that stops being visible is an unguarded repeat spend.
  const { make, storage, state } = setup();
  storage.setItem(
    PENDING_KEY,
    JSON.stringify({
      version: 1,
      account,
      address,
      chainId: 61997,
      label: 'Run live endpoint audit',
      startedAt: '2026-09-14T00:00:00Z',
      stage: 'submitted',
      genlayerTxId: hash,
    }),
  );
  assert.equal(loadPending(storage).version, 1);
  assert.equal(verified(loadPending(storage)), false);
  assert.equal(executed(loadPending(storage)), false);
  await assert.rejects(make().submit({}, tx), /already recorded/);
  assert.equal(state.submits, 0);
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
