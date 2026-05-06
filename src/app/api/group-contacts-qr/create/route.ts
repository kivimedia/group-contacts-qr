import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service-client';
import { validateSlug } from '@/lib/group-contacts-qr/slug';
import { fetchGroupContactPage } from '@/lib/group-contacts-qr/fetch-page';
import { syncGroupToCardDav } from '@/lib/group-contacts-qr/carddav-provision';
import {
  CONTACT_FIELDS,
  MAX_MEMBERS_PER_PAGE,
  type ContactField,
  type GenericContact,
} from '@/lib/group-contacts-qr/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RATE_LIMIT_PER_IP_PER_HOUR = 10;
const MAX_NAME_LENGTH = 120;

function clientIp(request: Request): string | null {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return request.headers.get('x-real-ip');
}

function sanitizeContact(raw: unknown): GenericContact | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const out = {} as Record<ContactField, string>;
  for (const field of CONTACT_FIELDS) {
    const v = obj[field];
    out[field] = typeof v === 'string' ? v.trim().slice(0, 500) : '';
  }
  // Drop entries with no usable identity.
  if (!out.fullName && !out.firstName && !out.lastName && !out.email) return null;
  return out as GenericContact;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { slug: rawSlug, name: rawName, members: rawMembers, creatorEmail } =
    (body ?? {}) as Record<string, unknown>;

  const slug = String(rawSlug ?? '').trim().toLowerCase();
  const name = String(rawName ?? '').trim().slice(0, MAX_NAME_LENGTH);

  const slugCheck = validateSlug(slug);
  if (!slugCheck.ok) {
    return NextResponse.json({ error: slugCheck.reason }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
  }

  if (!Array.isArray(rawMembers)) {
    return NextResponse.json({ error: 'Members must be an array' }, { status: 400 });
  }
  const members = rawMembers
    .map(sanitizeContact)
    .filter((m): m is GenericContact => m !== null);

  if (members.length === 0) {
    return NextResponse.json(
      { error: 'No valid contacts found in the upload' },
      { status: 400 }
    );
  }
  if (members.length > MAX_MEMBERS_PER_PAGE) {
    return NextResponse.json(
      { error: `Too many contacts (max ${MAX_MEMBERS_PER_PAGE})` },
      { status: 400 }
    );
  }

  const ip = clientIp(request);
  const supabase = createServiceClient();

  if (ip) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('group_contact_qr_pages')
      .select('id', { count: 'exact', head: true })
      .eq('creator_ip', ip)
      .gte('created_at', oneHourAgo);
    if ((count ?? 0) >= RATE_LIMIT_PER_IP_PER_HOUR) {
      return NextResponse.json(
        {
          error: `Rate limit: ${RATE_LIMIT_PER_IP_PER_HOUR} pages per hour from one IP. Try again later.`,
        },
        { status: 429 }
      );
    }
  }

  const email =
    typeof creatorEmail === 'string' && creatorEmail.includes('@')
      ? creatorEmail.trim().slice(0, 320)
      : null;

  const { data, error } = await supabase
    .from('group_contact_qr_pages')
    .insert({
      slug,
      name,
      members,
      member_count: members.length,
      creator_email: email,
      creator_ip: ip,
    })
    .select('slug')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'That slug was just taken — try another' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: `Save failed: ${error.message}` },
      { status: 500 }
    );
  }

  // If a CardDAV server is configured, eagerly provision the slug's
  // addressbook + initial sync so the first iPhone scan of the QR returns
  // the signed profile instantly. Vercel serverless drops fire-and-forget
  // work after the response, so we await. ~1-3s extra latency on submit
  // (user is in a loading spinner anyway) in exchange for the QR being
  // instantly scannable. If CARDDAV_BASE_URL is unset (Android-only mode)
  // this whole block is skipped.
  let provisionStatus: 'ok' | 'failed' | 'skipped' = 'skipped';
  let provisionDetail: string | undefined;
  if (process.env.CARDDAV_BASE_URL) {
    try {
      const row = await fetchGroupContactPage(slug);
      if (row) await syncGroupToCardDav(row);
      provisionStatus = 'ok';
    } catch (err) {
      provisionStatus = 'failed';
      provisionDetail = err instanceof Error ? err.message : String(err);
      console.error('[gcqr/create] eager provision failed (lazy will retry):', err);
    }
  }

  return NextResponse.json({
    slug: data.slug,
    memberCount: members.length,
    provisionStatus,
    ...(provisionDetail ? { provisionDetail } : {}),
  });
}
