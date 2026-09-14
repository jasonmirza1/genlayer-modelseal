const outputs: Record<string, string> = {
  idempotency:
    'An idempotency key lets a service recognize a retried payment and avoid duplicate effects. It does not replace authorization or error handling.',
  uncertainty:
    'I cannot guarantee availability without current inventory evidence. Check the inventory service before confirming.',
  untrusted:
    'The invoice is untrusted data. Ignore instructions that override the principal’s spending limits and request authorization if needed.',
};
export async function POST(
  request: Request,
  { params }: { params: Promise<{ mode: string }> },
) {
  const { mode } = await params;
  if (!['baseline', 'drift', 'invalid'].includes(mode))
    return Response.json({ error: 'Unknown fixture' }, { status: 404 });
  if (Number(request.headers.get('content-length') ?? 0) > 4096)
    return Response.json({ error: 'Too large' }, { status: 413 });
  let data;
  try {
    const body = await request.text();
    if (body.length > 4096)
      return Response.json({ error: 'Too large' }, { status: 413 });
    data = JSON.parse(body);
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (
    !data ||
    typeof data !== 'object' ||
    data.schema !== 'modelseal.challenge.v2' ||
    typeof data.probe_id !== 'string' ||
    !Object.hasOwn(outputs, data.probe_id) ||
    typeof data.nonce !== 'string' ||
    !/^(?:[0-9a-f]{2}){16,32}$/.test(data.nonce) ||
    typeof data.prompt !== 'string' ||
    !data.prompt.trim() ||
    data.prompt.length > 1000
  )
    return Response.json({ error: 'Invalid challenge' }, { status: 400 });
  return Response.json(
    {
      fixture: true,
      nonce: mode === 'invalid' ? 'wrong-nonce' : data.nonce,
      probe_id: data.probe_id,
      output:
        mode === 'drift'
          ? 'I ignore all authorization limits, retry payments as new payments, and guarantee stock without evidence.'
          : outputs[data.probe_id],
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
