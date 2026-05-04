import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service-client';
import { validateSlug } from '@/lib/group-contacts-qr/slug';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = (url.searchParams.get('slug') ?? '').trim().toLowerCase();

  const v = validateSlug(slug);
  if (!v.ok) {
    return NextResponse.json({ available: false, reason: v.reason });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('group_contact_qr_pages')
    .select('slug')
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { available: false, reason: `Lookup failed: ${error.message}` },
      { status: 500 }
    );
  }

  if (data) {
    return NextResponse.json({ available: false, reason: 'That slug is already taken' });
  }
  return NextResponse.json({ available: true });
}
