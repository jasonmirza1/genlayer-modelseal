import {
  parseAssuranceQuery,
  matchesAssuranceReport,
} from '../lib/assurance.ts';

// Run with Node >=22.13: node --experimental-strip-types
// scripts/check-assurance.mjs "<URL copied from Audit Gate>"
// Exit 0 only for a scoped ALLOW; every unknown/failure/BLOCK exits 1.
try {
  if (process.argv.length !== 3)
    throw new Error('Provide exactly one Audit Gate API URL.');
  const url = new URL(process.argv[2]);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== '/api/assurance'
  )
    throw new Error(
      'Use a trusted HTTPS /api/assurance URL (localhost HTTP is allowed for development).',
    );
  const parsed = parseAssuranceQuery(url.searchParams);
  if (parsed.error) throw new Error(parsed.error);
  const response = await fetch(url, {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const report = await response.json();
  if (!response.ok || !matchesAssuranceReport(report, parsed.policy))
    throw new Error('Unavailable or invalid scoped policy report.');
  console.log(
    JSON.stringify(
      {
        decision: report.decision,
        code: report.code,
        contract: report.policy.contract,
        profile: report.policy.profileId,
        receiptIds: report.receipts.map((r) => r.id),
        checkedAt: report.checkedAt,
        auditTime: report.auditTime,
      },
      null,
      2,
    ),
  );
  process.exitCode = report.decision === 'ALLOW' ? 0 : 1;
} catch {
  console.error(
    'BLOCK: No verified policy authorization. Check the API URL, trusted pins and finalized-state availability.',
  );
  process.exitCode = 1;
}
