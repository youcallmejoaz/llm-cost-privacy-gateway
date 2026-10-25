import type { NextRequest } from 'next/server';

// Server side proxy: the browser never sees the admin token.
const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:8787';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? (process.env.DEMO_MODE === '0' ? '' : 'demo-admin');

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = `${GATEWAY_URL}/${path.join('/')}${req.nextUrl.search}`;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (path[0] === 'admin') headers.authorization = `Bearer ${ADMIN_TOKEN}`;
  else {
    const auth = req.headers.get('authorization');
    if (auth) headers.authorization = auth;
    const cache = req.headers.get('x-gateway-cache');
    if (cache) headers['x-gateway-cache'] = cache;
  }
  const res = await fetch(target, { method: req.method, headers, body: req.method === 'GET' ? undefined : await req.text(), cache: 'no-store' });
  const out = new Headers({ 'content-type': res.headers.get('content-type') ?? 'application/json' });
  res.headers.forEach((v, k) => k.startsWith('x-gateway') && out.set(k, v));
  return new Response(await res.text(), { status: res.status, headers: out });
}

export const GET = forward;
export const POST = forward;
export const dynamic = 'force-dynamic';
