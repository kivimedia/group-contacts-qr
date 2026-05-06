import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { fetchGroupContactPage } from '@/lib/group-contacts-qr/fetch-page';
import {
  ensureProvisioned,
  syncGroupToCardDav,
} from '@/lib/group-contacts-qr/carddav-provision';
import { signProfile } from '@/lib/carddav/sign-profile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const CARDDAV_BASE_URL = (process.env.CARDDAV_BASE_URL ?? '').replace(/\/$/, '');
const PROFILE_ORG = process.env.PROFILE_ORGANIZATION ?? 'Group Contacts QR';
const PROFILE_IDENTIFIER_PREFIX =
  process.env.PROFILE_IDENTIFIER_PREFIX ?? 'org.example.gcqr';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function uuidFromSeed(seed: string): string {
  // Deterministic UUIDv4-shaped string from a seed so re-installing the
  // profile updates the same payload row in iOS Settings instead of
  // stacking duplicates. Not cryptographic - just stable formatting.
  const h = createHash('sha256').update(seed).digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    '8' + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!CARDDAV_BASE_URL) {
    return NextResponse.json(
      { error: 'CARDDAV_BASE_URL env var is not set - see README.md "Self-hosting" section' },
      { status: 500 }
    );
  }
  const row = await fetchGroupContactPage(slug);
  if (!row) {
    return NextResponse.json({ error: 'group not found' }, { status: 404 });
  }
  // Lazy-provision + lazy-first-sync so older rows created before the
  // CardDAV migration get bootstrapped on first .mobileconfig request.
  let prov;
  try {
    if (!row.carddav_provisioned_at) {
      await syncGroupToCardDav(row);
      const refreshed = await fetchGroupContactPage(slug);
      if (!refreshed) {
        return NextResponse.json({ error: 'group disappeared after provisioning' }, { status: 500 });
      }
      prov = await ensureProvisioned(refreshed);
    } else {
      prov = await ensureProvisioned(row);
    }
  } catch (err) {
    return NextResponse.json(
      { error: 'provisioning failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  const baseUrl = new URL(CARDDAV_BASE_URL);
  const host = baseUrl.host;
  const useSSL = baseUrl.protocol === 'https:';
  const port = baseUrl.port ? Number(baseUrl.port) : useSSL ? 443 : 80;
  const principalPath = `${baseUrl.pathname.replace(/\/$/, '')}/dav.php/principals/${prov.carddav_username}/`;

  const profileUuid = uuidFromSeed(`${PROFILE_IDENTIFIER_PREFIX}.${slug}.profile.v1`);
  const carddavUuid = uuidFromSeed(`${PROFILE_IDENTIFIER_PREFIX}.${slug}.carddav.v1`);
  const displayName = row.name || `Group: ${slug}`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key>
      <string>com.apple.carddav.account</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>PayloadIdentifier</key>
      <string>${escapeXml(PROFILE_IDENTIFIER_PREFIX)}.${escapeXml(slug)}.carddav</string>
      <key>PayloadUUID</key>
      <string>${carddavUuid}</string>
      <key>PayloadDisplayName</key>
      <string>${escapeXml(displayName)} Contacts</string>
      <key>PayloadDescription</key>
      <string>CardDAV account that syncs the ${escapeXml(displayName)} member roster into your Contacts app.</string>
      <key>CardDAVAccountDescription</key>
      <string>${escapeXml(displayName)}</string>
      <key>CardDAVHostName</key>
      <string>${escapeXml(host)}</string>
      <key>CardDAVPort</key>
      <integer>${port}</integer>
      <key>CardDAVUsername</key>
      <string>${escapeXml(prov.carddav_username)}</string>
      <key>CardDAVPassword</key>
      <string>${escapeXml(prov.carddav_password)}</string>
      <key>CardDAVUseSSL</key>
      <${useSSL ? 'true' : 'false'}/>
      <key>CardDAVPrincipalURL</key>
      <string>${escapeXml(principalPath)}</string>
    </dict>
  </array>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
  <key>PayloadIdentifier</key>
  <string>${escapeXml(PROFILE_IDENTIFIER_PREFIX)}.${escapeXml(slug)}</string>
  <key>PayloadUUID</key>
  <string>${profileUuid}</string>
  <key>PayloadDisplayName</key>
  <string>${escapeXml(displayName)} Contacts</string>
  <key>PayloadDescription</key>
  <string>Subscribes your iPhone to the ${escapeXml(displayName)} member directory. Contacts auto-update as the roster changes; remove this profile in Settings -&gt; General -&gt; VPN &amp; Device Management to stop syncing.</string>
  <key>PayloadOrganization</key>
  <string>${escapeXml(PROFILE_ORG)}</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
</dict>
</plist>
`;
  let signed;
  try {
    signed = await signProfile(xml);
  } catch (err) {
    return NextResponse.json(
      { error: 'profile signing failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
  return new NextResponse(Buffer.from(signed.bytes), {
    status: 200,
    headers: {
      'Content-Type': signed.contentType,
      'Content-Disposition': `attachment; filename="${slug}-contacts.mobileconfig"`,
      'Cache-Control': 'no-store',
      'X-Profile-Slug': slug,
      'X-Profile-Signed': signed.signed ? 'true' : 'false',
    },
  });
}
