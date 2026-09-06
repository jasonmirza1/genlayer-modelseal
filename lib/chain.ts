import { createClient } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';

export const EXPLORER = 'https://explorer-bradbury.genlayer.com';
export const NETWORK = {
  chainId: '0x107d',
  chainName: 'GenLayer Bradbury',
  nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
  rpcUrls: ['https://rpc-bradbury.genlayer.com'],
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
    chain: testnetBradbury,
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
