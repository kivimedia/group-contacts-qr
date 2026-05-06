import { createHash } from 'node:crypto';

/**
 * Generic CardDAV client for our self-hosted Baikal server. Both the DJTT
 * roster and the multi-tenant group-contacts-qr feature lean on this so the
 * Digest auth dance + PROPFIND/PUT/DELETE diff lives in one place.
 */

export type CardDavConfig = {
  /** Origin + base path of the Baikal install. e.g. https://host/baikal */
  baseUrl: string;
  /** CardDAV principal username. */
  username: string;
  /** CardDAV principal password (plaintext - we compute Digest HA1 inline). */
  password: string;
  /**
   * Server-relative path of the addressbook collection, including trailing
   * slash. e.g. `/dav.php/addressbooks/<username>/default/`.
   */
  addressbookPath: string;
};

export type VCardEntry = {
  /** Stable identifier becomes the .vcf URI inside the addressbook. */
  uid: string;
  /** Full vCard body including BEGIN/END and trailing CRLF. */
  body: string;
};

export type CardDavSyncResult = {
  desired: number;
  put: number;
  unchanged: number;
  deleted: number;
  errors: { uri: string; status: number; body: string }[];
};

type WWWAuth = {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
};

const PROPFIND_BODY =
  '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>';

function md5(s: string): string {
  return createHash('md5').update(s).digest('hex');
}

function parseWWWAuthenticate(header: string): WWWAuth | null {
  if (!header.toLowerCase().startsWith('digest ')) return null;
  const out: Record<string, string> = {};
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|([^\s,]+))/g;
  let m: RegExpExecArray | null;
  const body = header.slice(7);
  while ((m = re.exec(body))) {
    out[m[1].toLowerCase()] = m[2] ?? m[3];
  }
  if (!out.realm || !out.nonce) return null;
  return {
    realm: out.realm,
    nonce: out.nonce,
    qop: out.qop,
    opaque: out.opaque,
    algorithm: out.algorithm,
  };
}

export class CardDavClient {
  constructor(private readonly cfg: CardDavConfig) {
    if (!cfg.password) {
      throw new Error('CardDavClient: password is required');
    }
  }

  private get addressbookUrl(): string {
    return `${this.cfg.baseUrl}${this.cfg.addressbookPath}`;
  }

  private get basePathname(): string {
    // Strip trailing slash so `/baikal/foo` and `/baikal` normalize.
    return new URL(this.cfg.baseUrl).pathname.replace(/\/$/, '');
  }

  private async digestFetch(
    url: string,
    init: RequestInit & { method?: string } = {}
  ): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();
    const probe = await fetch(url, { ...init, method });
    if (probe.status !== 401) return probe;
    const wwa = parseWWWAuthenticate(probe.headers.get('www-authenticate') ?? '');
    if (!wwa) {
      throw new Error(`CardDAV auth failed: ${probe.status} no Digest challenge from ${url}`);
    }
    const { username, password } = this.cfg;
    const ha1 = md5(`${username}:${wwa.realm}:${password}`);
    const u = new URL(url);
    const path = u.pathname + (u.search || '');
    const ha2 = md5(`${method}:${path}`);
    const cnonce = md5(`${Date.now()}-${Math.random()}`).slice(0, 16);
    const nc = '00000001';
    const qop =
      wwa.qop?.split(',').map((s) => s.trim()).find((s) => s === 'auth') ?? 'auth';
    const response = md5(`${ha1}:${wwa.nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
    const parts = [
      `username="${username}"`,
      `realm="${wwa.realm}"`,
      `nonce="${wwa.nonce}"`,
      `uri="${path}"`,
      `qop=${qop}`,
      `nc=${nc}`,
      `cnonce="${cnonce}"`,
      `response="${response}"`,
      wwa.algorithm ? `algorithm=${wwa.algorithm}` : null,
      wwa.opaque ? `opaque="${wwa.opaque}"` : null,
    ].filter(Boolean);
    const authHeader = `Digest ${parts.join(', ')}`;
    return fetch(url, {
      ...init,
      method,
      headers: { ...(init.headers ?? {}), Authorization: authHeader },
    });
  }

  /**
   * Returns map of relative-path -> etag for all .vcf entries currently in
   * the addressbook. Path is normalized to start with addressbookPath
   * (BASE_URL pathname stripped) so it can be compared with locally-built keys.
   */
  async listExistingCards(): Promise<Map<string, string>> {
    const res = await this.digestFetch(this.addressbookUrl, {
      method: 'PROPFIND',
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
      body: PROPFIND_BODY,
    });
    if (res.status !== 207) {
      const body = await res.text().catch(() => '');
      throw new Error(`PROPFIND failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const xml = await res.text();
    const out = new Map<string, string>();
    const prefix = this.basePathname;
    const re =
      /<d:response>[\s\S]*?<d:href>([^<]+\.vcf)<\/d:href>[\s\S]*?<d:getetag>"?([^"<]+)"?<\/d:getetag>[\s\S]*?<\/d:response>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      let href = m[1];
      if (prefix && href.startsWith(prefix)) href = href.slice(prefix.length);
      out.set(href, m[2]);
    }
    return out;
  }

  /**
   * Idempotent sync. Each VCardEntry becomes <addressbookPath>m-<uid>.vcf in
   * the addressbook. Cards present on the server but missing from `cards` are
   * deleted (orphan cleanup).
   */
  async syncCards(cards: VCardEntry[]): Promise<CardDavSyncResult> {
    const existing = await this.listExistingCards();
    const desired = new Map<string, string>();
    for (const c of cards) {
      desired.set(`${this.cfg.addressbookPath}m-${c.uid}.vcf`, c.body);
    }
    const result: CardDavSyncResult = {
      desired: cards.length,
      put: 0,
      unchanged: 0,
      deleted: 0,
      errors: [],
    };

    for (const [href, body] of desired) {
      const url = `${this.cfg.baseUrl}${href}`;
      const res = await this.digestFetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/vcard; charset=utf-8' },
        body,
      });
      if (res.status === 201 || res.status === 204) {
        result.put += 1;
      } else if (res.status === 412) {
        result.unchanged += 1;
      } else {
        result.errors.push({
          uri: href,
          status: res.status,
          body: (await res.text().catch(() => '')).slice(0, 200),
        });
      }
    }

    for (const href of existing.keys()) {
      if (desired.has(href)) continue;
      const url = `${this.cfg.baseUrl}${href}`;
      const res = await this.digestFetch(url, { method: 'DELETE' });
      if (res.status === 204 || res.status === 404) {
        result.deleted += 1;
      } else {
        result.errors.push({
          uri: href,
          status: res.status,
          body: (await res.text().catch(() => '')).slice(0, 200),
        });
      }
    }

    return result;
  }
}

export function escapeVcardValue(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

export function stableUidFromSeed(seed: string): string {
  return md5(seed.toLowerCase().trim()).slice(0, 16);
}
