import { createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';

export const EXPLORER = 'https://explorer-studio-dev.genlayer.com';
export const STUDIO_NEXT_RPC =
  process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ??
  'https://studio-next.genlayer.com/api';
// Consensus addresses in studioDevnet belong to this network, not an arbitrary
// chain ID supplied via an environment variable.
export const STUDIO_NEXT_CHAIN_ID = 61997;
export const STUDIO_NEXT_CHAIN = {
  ...studioDevnet,
  id: STUDIO_NEXT_CHAIN_ID,
  name: 'GenLayer Studio Next',
  rpcUrls: { default: { http: [STUDIO_NEXT_RPC] } },
  blockExplorers: {
    default: { name: 'GenLayer Studio Dev Explorer', url: EXPLORER },
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
