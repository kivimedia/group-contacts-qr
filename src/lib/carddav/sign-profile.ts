/**
 * Signs an Apple Configuration Profile XML by POSTing it to a remote signer
 * endpoint that runs `openssl smime -sign` with a Developer ID Installer cert.
 *
 * Returns the signed CMS DER bytes. If `CARDDAV_ADMIN_SECRET` /
 * `CARDDAV_ADMIN_BASE_URL` are missing the helper returns the unsigned XML
 * as bytes with `signed: false` - the resulting profile still works, but
 * iOS shows a red "Unverified" warning on install. Useful for dev /
 * non-production deployments without an Apple Developer Program account.
 *
 * Env vars:
 *   CARDDAV_ADMIN_BASE_URL - e.g. https://your-server.example/carddav-admin
 *                           (the directory that hosts sign.php / provision.php)
 *   CARDDAV_ADMIN_SECRET   - shared secret matched by the server's
 *                           admin-secret.txt
 *
 * See README.md "Sign profiles with an Apple Developer cert" for setup.
 */

const ADMIN_BASE_URL = (process.env.CARDDAV_ADMIN_BASE_URL ?? '').replace(/\/$/, '');
const ADMIN_SECRET = process.env.CARDDAV_ADMIN_SECRET ?? '';

export type SignedProfile = {
  bytes: Uint8Array;
  signed: boolean;
  contentType: string;
};

export async function signProfile(xml: string): Promise<SignedProfile> {
  if (!ADMIN_SECRET || !ADMIN_BASE_URL) {
    return {
      bytes: new TextEncoder().encode(xml),
      signed: false,
      contentType: 'application/x-apple-aspen-config; charset=utf-8',
    };
  }
  const url = `${ADMIN_BASE_URL}/sign.php`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Admin-Secret': ADMIN_SECRET,
      'Content-Type': 'application/xml',
    },
    body: xml,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`sign.php returned ${res.status}: ${detail.slice(0, 200)}`);
  }
  const buf = await res.arrayBuffer();
  return {
    bytes: new Uint8Array(buf),
    signed: true,
    contentType: 'application/x-apple-aspen-config',
  };
}
