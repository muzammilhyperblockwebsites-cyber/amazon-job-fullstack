import { NextRequest } from 'next/server';

// Cookies remain HttpOnly. The backend key is only read on the server.
export async function backendProxy(req: NextRequest) {
  const backend = process.env.BACKEND_URL || 'https://amazon-job-1c0aa8c12f46.herokuapp.com';
  const key = process.env.BACKEND_API_KEY || 'a6dcd9ae16aff8ce38c1858728735ec1e96aec66811e28a5ad3eab7edee46d05';
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://amazon-job-apply.vercel.app';
  if (!backend || !key || !appUrl) return Response.json({ error: 'Server configuration is incomplete' }, { status: 503 });
  const expectedOrigin = new URL(appUrl).origin;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (req.headers.get('origin') !== expectedOrigin) return Response.json({ error: 'Invalid request origin' }, { status: 403 });
    if (req.method !== 'DELETE' && !req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return Response.json({ error: 'JSON content type required' }, { status: 415 });
  }
  const target = new URL(req.nextUrl.pathname + req.nextUrl.search, backend);
  const headers = new Headers({ 'x-backend-key': key, 'origin': expectedOrigin });
  const cookie = req.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  if (req.headers.get('content-type')) headers.set('content-type', req.headers.get('content-type')!);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    // Stream uploads/responses, including SSE; the request abort closes the worker connection.
    req.signal.addEventListener('abort', () => controller.abort(), { once: true });
    const init: RequestInit = { method: req.method, headers, cache: 'no-store', redirect: 'manual', signal: controller.signal };
    if (!['GET', 'HEAD'].includes(req.method)) {
      const bodyBuffer = await req.arrayBuffer();
      if (bodyBuffer.byteLength > 0) init.body = bodyBuffer;
    }
    const upstream = await fetch(target, init);
    const type = upstream.headers.get('content-type') || '';
    if (!type.includes('application/json') && !type.includes('text/event-stream')) {
      await upstream.body?.cancel();
      return Response.json({ error: upstream.status === 404 ? 'The Heroku backend is missing this route. Deploy the matching backend version.' : 'Heroku returned an unexpected response. Check the backend deployment.', upstreamStatus: upstream.status }, { status: 502 });
    }
    if (['/api/jobs', '/api/stats'].includes(req.nextUrl.pathname) && upstream.ok && type.includes('application/json')) {
      const data = await upstream.json();
      if (data.source !== 'db' && data.jobFeed?.provider !== 'jobsatamazon.co.uk') return Response.json({ error: 'The deployed Heroku backend does not provide the verified UK hourly-job feed. Deploy the updated backend to restore correct job counts.' }, { status: 502 });
      const wrongSource = Array.isArray(data.jobs) && data.jobs.some((job: { id?: string; jobId?: string; applyUrl?: string }) => {
        const id = job.jobId || job.id || '';
        let official = false;
        try { official = new URL(job.applyUrl || '').hostname === 'www.jobsatamazon.co.uk'; } catch { /* Invalid source. */ }
        return !/^(JOB-UK-[A-Za-z0-9_-]+|a0R[A-Za-z0-9]+)$/.test(id) || !official;
      });
      if (wrongSource) return Response.json({ error: 'The deployed Heroku backend is returning corporate amazon.jobs roles instead of UK hourly jobs. Deploy the updated backend.' }, { status: 502 });
      return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
    }
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    for (const name of ['content-type', 'set-cookie', 'location', 'retry-after', 'x-accel-buffering']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json({ error: 'Backend unavailable. Please retry.' }, { status: 502 });
  } finally { clearTimeout(timeout); }
}
