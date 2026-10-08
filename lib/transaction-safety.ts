import type { TransactionKit, TrackedStatus } from '@genlayer/transaction-kit';
import type { ConsensusOutcome } from './chain';

// One key for the lifetime of the app. Renaming it would orphan a record written
// by an older build, and an invisible record is an unguarded second write: the
// duplicate-write lock is the only thing standing between a reload and a repeat
// spend. Schema changes are additive and carried by `version` instead.
export const PENDING_KEY = 'modelseal.pending.studio-next.v1';
export type WalletProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};
export type TransactionScope = {
  account: string;
  address: string;
  chainId: number;
  label: string;
};
export type PendingRecord = TransactionScope & {
  // 1 predates consensus-outcome verification and simply has no `outcome`; it is
  // still a blocking record and must keep loading.
  version: 1 | 2;
  startedAt: string;
  stage: 'signing' | 'submitted' | 'unknown' | 'finalized';
  genlayerTxId?: `0x${string}`;
  evmTxHash?: `0x${string}`;
  status?: TrackedStatus;
  outcome?: ConsensusOutcome;
};
export function settled(status?: TrackedStatus) {
  return status?.phase === 'finalized' || status?.statusName === 'CANCELED';
}
// The tracker's own `successful` flag is derived from the transaction status and
// the leader's execution result only. Both are FINALIZED/FINISHED_WITH_RETURN on
// a round that validators rejected, so the flag cannot be used to claim a write
// landed. Only a resolved consensus outcome can.
export function verified(record?: PendingRecord | null) {
  return !!record?.outcome;
}
export function executed(record?: PendingRecord | null) {
  return record?.outcome?.applied === true;
}
export function loadPending(
  storage: Pick<Storage, 'getItem'>,
): PendingRecord | null {
  const raw = storage.getItem(PENDING_KEY);
  if (!raw) return null;
  const record = JSON.parse(raw) as PendingRecord;
  if (
    !record ||
    (record.version !== 1 && record.version !== 2) ||
    record.chainId !== 61997 ||
    !/^0x[0-9a-f]{40}$/i.test(record.account) ||
    !/^0x[0-9a-f]{40}$/i.test(record.address) ||
    typeof record.label !== 'string' ||
    typeof record.startedAt !== 'string' ||
    !['signing', 'submitted', 'unknown', 'finalized'].includes(record.stage) ||
    (record.genlayerTxId !== undefined &&
      !/^0x[0-9a-f]{64}$/i.test(record.genlayerTxId)) ||
    (record.outcome !== undefined &&
      typeof record.outcome?.applied !== 'boolean')
  ) {
    throw new Error(
      'Stored transaction data is invalid. Inspect your wallet and explorer before clearing it.',
    );
  }
  return record;
}
export async function requireWallet(
  provider: WalletProvider,
  scope: TransactionScope,
) {
  const [accounts, chain] = await Promise.all([
    provider.request({ method: 'eth_accounts' }),
    provider.request({ method: 'eth_chainId' }),
  ]);
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== 'string' ||
    accounts[0].toLowerCase() !== scope.account.toLowerCase() ||
    Number(chain) !== scope.chainId
  ) {
    throw new Error(
      'Wallet or network changed. Restore the original wallet on Studio Next or close this unsigned review.',
    );
  }
}

// Keep the record outside the fee panel: panel errors, navigation and reloads
// must not silently authorize a second write. Unknown submission != rejection.
export function protectTransactions(
  makeKit: (provider: WalletProvider) => TransactionKit,
  provider: WalletProvider,
  scope: TransactionScope,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  changed: (record: PendingRecord | null) => void,
  isActive: () => boolean = () => true,
  verify?: (hash: string) => Promise<ConsensusOutcome>,
): TransactionKit {
  let record: PendingRecord | null = null;
  let attempted = false;
  function save(next: PendingRecord | null) {
    record = next;
    changed(next);
    if (next) storage.setItem(PENDING_KEY, JSON.stringify(next));
    else storage.removeItem(PENDING_KEY);
  }
  async function guard() {
    if (!isActive())
      throw new Error('Wallet disconnected. Reconnect before signing.');
    await requireWallet(provider, scope);
    if (!isActive())
      throw new Error('Wallet disconnected. Reconnect before signing.');
  }
  const guardedProvider: WalletProvider = {
    async request(args) {
      if (/^(eth_send|eth_sign|personal_sign|wallet_send)/.test(args.method))
        await guard();
      const result = await provider.request(args);
      if (
        args.method === 'eth_sendTransaction' &&
        typeof result === 'string' &&
        /^0x[0-9a-f]{64}$/i.test(result) &&
        record
      )
        save({
          ...record,
          stage: 'submitted',
          evmTxHash: result as `0x${string}`,
        });
      return result;
    },
  };
  const base = makeKit(guardedProvider);
  function update(status: TrackedStatus) {
    if (!record) return;
    // A resolved outcome describes one particular status, so replacing the status
    // invalidates it. Carrying it forward would let an earlier "applied" survive
    // a later cancellation or re-track and keep claiming a write that no longer
    // corresponds to anything. track() re-resolves it straight after.
    const { outcome, ...carried } = record;
    void outcome;
    save({
      ...carried,
      stage: settled(status) ? 'finalized' : 'submitted',
      genlayerTxId: status.genlayerTxId ?? record.genlayerTxId,
      status,
    });
  }
  return {
    ...base,
    async submit(quote, tx) {
      if (attempted || loadPending(storage))
        throw new Error(
          'A transaction is already recorded. Check its outcome before starting another.',
        );
      if (
        tx.kind !== 'write' ||
        tx.address.toLowerCase() !== scope.address.toLowerCase()
      )
        throw new Error('Transaction target changed. Start a fresh review.');
      // Persist synchronously before any wallet call; also blocks another tab.
      save({
        ...scope,
        version: 2,
        startedAt: new Date().toISOString(),
        stage: 'signing',
      });
      try {
        await guard();
      } catch (error) {
        save(null);
        throw error;
      }
      attempted = true;
      try {
        const result = await base.submit(quote, tx);
        save({ ...record!, ...result, stage: 'submitted' });
        return result;
      } catch (error) {
        const rejected =
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 4001;
        if (rejected && !record?.evmTxHash) {
          save(null);
          attempted = false;
        } else if (record) save({ ...record, stage: 'unknown' });
        throw error;
      }
    },
    async track(hash, onUpdate, options) {
      try {
        const status = await base.track(
          hash,
          (value) => {
            update(value);
            onUpdate(value);
          },
          options,
        );
        update(status);
        // Tracking stops at FINALIZED, which is reached by rejected rounds too.
        // Resolve the consensus outcome here so nothing downstream can report a
        // write that consensus discarded. An unresolved outcome stays 'unknown'
        // rather than being assumed successful.
        if (verify && settled(status) && record) {
          try {
            // Resolve before spreading: an object literal spreads the current
            // record and only then suspends on the await, so building it inline
            // would overwrite anything saved while the lookup was in flight.
            const outcome = await verify(status.genlayerTxId ?? hash);
            if (record) save({ ...record, outcome });
          } catch {
            if (record) save({ ...record, stage: 'unknown' });
          }
        }
        return status;
      } catch (error) {
        if (record) save({ ...record, stage: 'unknown' });
        throw error;
      }
    },
    async cancel(args) {
      await guard();
      const result = await base.cancel(args);
      // A submitted cancellation is not final until the network confirms it.
      if (result.status === 'CANCELED')
        update({
          phase: 'decided',
          statusName: 'CANCELED',
          successful: false,
          genlayerTxId: args.hash,
        });
      return result;
    },
    async topUp(args) {
      await guard();
      return base.topUp(args);
    },
  };
}
