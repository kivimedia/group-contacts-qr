import { createServiceClient } from '@/lib/supabase/service-client';
import {
  CardDavClient,
  type VCardEntry,
  escapeVcardValue,
  stableUidFromSeed,
} from '@/lib/carddav/client';
import type { GenericContact, GroupContactPageRow } from './types';

/**
 * Per-group CardDAV provisioning. Each slug gets its own dedicated CardDAV
 * user (`g-<slug>`) so subscribers see only that group's contacts. The
 * .mobileconfig that iPhones download embeds the slug-specific creds.
 *
 * The CardDAV user is created via a small PHP admin endpoint that the
 * operator hosts alongside their CardDAV server (Baikal, sabre/dav, etc.).
 * On success, we persist `carddav_username` + `carddav_password` on the
 * `group_contact_qr_pages` row so future syncs reuse the same creds.
 *
 * Env vars:
 *   CARDDAV_BASE_URL        - public base URL of your CardDAV server
 *                             (e.g. https://carddav.example.com)
 *   CARDDAV_ADMIN_BASE_URL  - admin endpoint base (e.g. .../carddav-admin)
 *   CARDDAV_ADMIN_SECRET    - shared secret for the admin endpoint
 */

const CARDDAV_BASE_URL = (process.env.CARDDAV_BASE_URL ?? '').replace(/\/$/, '');
const ADMIN_BASE_URL = (process.env.CARDDAV_ADMIN_BASE_URL ?? '').replace(/\/$/, '');
const ADMIN_SECRET = process.env.CARDDAV_ADMIN_SECRET ?? '';

type ProvisionResponse = {
  username: string;
  password: string | null;
  principal_url: string;
  addressbook_url: string;
  created: boolean;
};

export type ProvisionedRow = {
  slug: string;
  carddav_username: string;
  carddav_password: string;
  addressbook_path: string;
};

async function callAdminProvision(
  slug: string,
  displayname: string
): Promise<ProvisionResponse> {
  if (!ADMIN_SECRET || !ADMIN_BASE_URL) {
    throw new Error(
      'CARDDAV_ADMIN_BASE_URL or CARDDAV_ADMIN_SECRET env vars are not set'
    );
  }
  const res = await fetch(`${ADMIN_BASE_URL}/provision.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ slug, displayname }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`CardDAV admin provision failed: ${res.status} ${text.slice(0, 200)}`);
  }
  let parsed: ProvisionResponse;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`CardDAV admin provision: bad JSON response ${text.slice(0, 200)}`);
  }
  return parsed;
}

/**
 * Ensures a CardDAV user + addressbook exist for the given slug. Reads the
 * row from Supabase; if `carddav_provisioned_at` is null, calls the admin
 * endpoint and persists the new creds. Returns the provisioned creds for
 * the caller to use.
 *
 * Idempotent: callers can run this on every page view; the second-and-onward
 * calls are pure DB reads.
 */
export async function ensureProvisioned(row: GroupContactPageRow): Promise<ProvisionedRow> {
  if (row.carddav_username && row.carddav_password && row.carddav_provisioned_at) {
    return {
      slug: row.slug,
      carddav_username: row.carddav_username,
      carddav_password: row.carddav_password,
      addressbook_path: `/dav.php/addressbooks/${row.carddav_username}/default/`,
    };
  }
  const provisioned = await callAdminProvision(row.slug, row.name || `Group: ${row.slug}`);
  if (provisioned.created && provisioned.password) {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from('group_contact_qr_pages')
      .update({
        carddav_username: provisioned.username,
        carddav_password: provisioned.password,
        carddav_provisioned_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (error) {
      throw new Error(`failed to persist carddav creds for ${row.slug}: ${error.message}`);
    }
    return {
      slug: row.slug,
      carddav_username: provisioned.username,
      carddav_password: provisioned.password,
      addressbook_path: `/dav.php/addressbooks/${provisioned.username}/default/`,
    };
  }
  // created=false: server already had the user but we don't have creds in
  // Supabase. This shouldn't happen in normal flow (the row would already
  // have provisioned_at) but can occur if Supabase was wiped while the
  // CardDAV server wasn't. Refuse rather than corrupt state.
  throw new Error(
    `CardDAV admin already had user ${provisioned.username} for slug ${row.slug} but Supabase has no password stored. Manual recovery required.`
  );
}

function contactToVcard(slug: string, c: GenericContact): VCardEntry {
  const seed = (c.email || c.fullName || `${c.firstName} ${c.lastName}` || '').toLowerCase().trim();
  const uid = stableUidFromSeed(seed || `${slug}-${Math.random()}`);
  const fullName =
    c.fullName ||
    [c.firstName, c.lastName].filter(Boolean).join(' ').trim() ||
    c.email ||
    'Unnamed';
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0', `UID:${uid}`];
  lines.push(`FN:${escapeVcardValue(fullName)}`);
  lines.push(
    `N:${escapeVcardValue(c.lastName ?? '')};${escapeVcardValue(c.firstName ?? '')};;;`
  );
  if (c.company) lines.push(`ORG:${escapeVcardValue(c.company)}`);
  if (c.jobTitle) lines.push(`TITLE:${escapeVcardValue(c.jobTitle)}`);
  if (c.email) lines.push(`EMAIL;TYPE=WORK:${escapeVcardValue(c.email)}`);
  if (c.cellPhone) lines.push(`TEL;TYPE=CELL:${escapeVcardValue(c.cellPhone)}`);
  if (c.workPhone) lines.push(`TEL;TYPE=WORK:${escapeVcardValue(c.workPhone)}`);
  if (c.websiteUrl) {
    const url = c.websiteUrl.match(/^https?:\/\//i) ? c.websiteUrl : `https://${c.websiteUrl}`;
    lines.push(`URL:${escapeVcardValue(url)}`);
  }
  if (c.notes) lines.push(`NOTE:${escapeVcardValue(c.notes)}`);
  lines.push('END:VCARD');
  return { uid, body: lines.join('\r\n') + '\r\n' };
}

/**
 * Provisions if needed, then runs a full PUT/DELETE diff against the
 * CardDAV server. Updates `carddav_last_sync_at` + `carddav_card_count`
 * on the row.
 */
export async function syncGroupToCardDav(row: GroupContactPageRow): Promise<{
  desired: number;
  put: number;
  unchanged: number;
  deleted: number;
  errors: { uri: string; status: number; body: string }[];
}> {
  if (!CARDDAV_BASE_URL) {
    throw new Error('CARDDAV_BASE_URL env var is not set');
  }
  const prov = await ensureProvisioned(row);
  const cards = (row.members ?? []).map((c) => contactToVcard(row.slug, c));
  const client = new CardDavClient({
    baseUrl: CARDDAV_BASE_URL,
    username: prov.carddav_username,
    password: prov.carddav_password,
    addressbookPath: prov.addressbook_path,
  });
  const result = await client.syncCards(cards);
  const supabase = createServiceClient();
  await supabase
    .from('group_contact_qr_pages')
    .update({
      carddav_last_sync_at: new Date().toISOString(),
      carddav_card_count: result.put + result.unchanged,
    })
    .eq('id', row.id);
  return result;
}
