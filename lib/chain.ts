import { createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import {
  TransactionHashVariant,
  transactionLifecycleFromStoredStatus,
  type Hash,
} from 'genlayer-js/types';

export const EXPLORER = 'https://explorer-studio-dev.genlayer.com';
// studio-dev is the canonical SDK/RPC target for the Consensus v0.6 preview;
// studio-next.genlayer.com is a browser alias for the same deployment and answers
// identically, but the documented endpoint is the one pinned here.
export const STUDIO_NEXT_RPC =
  process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ??
  'https://studio-dev.genlayer.com/api';
// Consensus addresses in studioDevnet belong to this network, not an arbitrary
// chain ID supplied via an environment variable.
export const STUDIO_NEXT_CHAIN_ID = 61997;
export const STUDIO_NEXT_CHAIN = {
  ...studioDevnet,
  id: STUDIO_NEXT_CHAIN_ID,
  name: 'GenLayer Studio Next',
  rpcUrls: { default: { http: [STUDIO_NEXT_RPC] } },
  blockExplorers: {
    // Studio Next transactions are browsable at the studio-dev explorer host.
    default: { name: 'GenLayer Studio Next Explorer', url: EXPLORER },
  },
};
export const NETWORK = {
  chainId: `0x${STUDIO_NEXT_CHAIN_ID.toString(16)}`,
  chainName: 'GenLayer Studio Next',
  nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
  rpcUrls: [STUDIO_NEXT_RPC],
  blockExplorerUrls: [EXPLORER],
};
export type Provider = NonNullable<
  Parameters<typeof createClient>[0]
>['provider'];
export function plain(value: unknown): unknown {
  if (value instanceof Map)
    return Object.fromEntries(
      [...value.entries()].map(([k, v]) => [String(k), plain(v)]),
    );
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'bigint') return Number(value);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, plain(v)]),
    );
  return value;
}
export function client(account?: string, provider?: Provider) {
  return createClient({
    chain: STUDIO_NEXT_CHAIN,
    ...(account ? { account: account as `0x${string}`, provider } : {}),
  });
}
export async function read(
  address: string,
  functionName: string,
  args: (string | number)[] = [],
) {
  return plain(
    await client().readContract({
      address: address as `0x${string}`,
      functionName,
      args,
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    }),
  );
}
export function isAddress(value: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value);
}

export type ConsensusOutcome = {
  statusName: string;
  // 'accepted' | 'undetermined' | 'leader-timeout' | 'validators-timeout' | ''
  outcome: string;
  executionResultName: string;
  // The round was accepted, so the leader's storage writes were applied.
  applied: boolean;
  // No further round can change the outcome.
  settled: boolean;
};

// FINALIZED only means a transaction can no longer be appealed; it does not mean
// its round was accepted. A MAJORITY_DISAGREE round finalizes with
// txExecutionResult FINISHED_WITH_RETURN and still discards every storage write
// the leader made. genlayer-js isSuccessful() and the transaction-kit
// `successful` flag both ignore the round result, so neither is used to claim a
// write happened. The round result is the only authority, and the SDK exposes it
// through the transaction lifecycle.
export function outcomeOf(tx: {
  status?: string | number;
  statusName?: string;
  result?: string | number;
  lifecycle?: { state: string; outcome?: string };
  txExecutionResultName?: string;
}): ConsensusOutcome {
  const lifecycle =
    tx.lifecycle ??
    (transactionLifecycleFromStoredStatus(
      (tx.statusName ?? tx.status) as never,
      tx.result as never,
    ) as { state: string; outcome?: string });
  const executionResultName = tx.txExecutionResultName ?? '';
  const outcome = lifecycle.outcome ?? '';
  return {
    statusName: tx.statusName ?? String(tx.status ?? ''),
    outcome,
    executionResultName,
    applied:
      outcome === 'accepted' && executionResultName === 'FINISHED_WITH_RETURN',
    settled: lifecycle.state === 'finalized' || lifecycle.state === 'canceled',
  };
}

export async function consensusOutcome(hash: string) {
  return outcomeOf(
    (await client().getTransaction({
      hash: hash as unknown as Hash,
    })) as Parameters<typeof outcomeOf>[0],
  );
}

export function describeOutcome(outcome: ConsensusOutcome) {
  if (outcome.applied) return 'Consensus accepted the round and applied the write.';
  // Only claim acceptance when the round was accepted: a rejected round can also
  // carry a reverting leader execution result.
  if (
    outcome.outcome === 'accepted' &&
    outcome.executionResultName === 'FINISHED_WITH_ERROR'
  )
    return 'Consensus accepted the round but the contract reverted, so nothing was written.';
  if (outcome.outcome === 'undetermined')
    return 'Validators did not reach a majority on the leader result, so every state change was discarded. Nothing was written.';
  if (outcome.outcome === 'leader-timeout' || outcome.outcome === 'validators-timeout')
    return 'The round timed out before a result was agreed. Nothing was written.';
  if (outcome.statusName === 'CANCELED')
    return 'The transaction was canceled before execution. Nothing was written.';
  return 'The round did not produce an applied result. Nothing was written.';
}
