import { read } from '@/lib/chain';
import { assuranceResponse } from '@/lib/assurance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// No credentials, wallet, request-supplied RPC, endpoint fetch or write method.
export async function GET(request: Request) {
  // A policy BLOCK is a valid result. Unavailable/unstable reads are HTTP 503,
  // but still carry a BLOCK report; clients must not treat 2xx alone as ALLOW.
  return assuranceResponse(request, read);
}
