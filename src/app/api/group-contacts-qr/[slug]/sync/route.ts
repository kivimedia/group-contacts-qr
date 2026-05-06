import { NextResponse } from 'next/server';
import { fetchGroupContactPage } from '@/lib/group-contacts-qr/fetch-page';
import { syncGroupToCardDav } from '@/lib/group-contacts-qr/carddav-provision';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function authorize(req: Request): boolean {
  const expected = process.env.CARDDAV_SYNC_SECRET;
  if (!expected) return false;
  const auth = req.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7) === expected;
  }
  const url = new URL(req.url);
  return url.searchParams.get('secret') === expected;
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { slug } = await ctx.params;
  const row = await fetchGroupContactPage(slug);
  if (!row) {
    return NextResponse.json({ error: 'group not found' }, { status: 404 });
  }
  try {
    const result = await syncGroupToCardDav(row);
    return NextResponse.json({ ok: true, slug, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return POST(req, ctx);
}
