# Group Contacts QR

Open-source CSV/Excel-to-QR contact-card builder. Upload a roster, get a public page with QR codes that add every member of your group to a phone in one scan. No app, no signup.

A gift to the world from [Kivi Media](https://kivimedia.co).

## What it does

1. Upload a CSV or Excel file (drag-drop or click). First row is column headers.
2. The tool fuzzy-matches your columns against `First / Last / Full / Email / Cell / Work / Title / Company / URL / Notes` automatically; you can override any mapping.
3. Name the group, pick a slug.
4. Get a public viewer page at `/group-contacts-qr/<slug>` with two QRs:
   - **iPhone QR** -> downloads an Apple Configuration Profile that subscribes the device to a CardDAV addressbook with all the contacts. Auto-syncs on roster updates.
   - **Android QR** -> downloads a multi-vCard. Native bulk-import in one tap.

The viewer also exposes a direct download at `/group-contacts-qr/<slug>/contacts.vcf` (the raw multi-vCard) and a per-contact fallback list.

## Why two QRs?

iOS 26 broke the bulk multi-vCard import path that worked for years. iPhones now only import the FIRST card from any web-originated multi-vCard, regardless of `Content-Disposition`, file size, or routing through Files. After confirming this end-to-end (Safari preview, attachment + Files-app, batched 24-card files, bare-minimum format - all returned only the first contact), we pivoted iPhone to Apple's CardDAV protocol via signed Configuration Profiles. Android still handles bulk vCard import natively, so it stays on the simple path.

The CardDAV side adds infrastructure (a CardDAV server + a small signing endpoint), so it's **optional**. If you don't configure it, the app falls back to Android-only mode (single vCard QR). Most demos don't need iPhone support; production deployments serving iPhone users do.

## Stack

- Next.js 14 (App Router)
- React + Tailwind
- Supabase Postgres for slug uniqueness + storage of contacts as JSONB
- `xlsx` for both CSV and Excel parsing (client-side, never uploaded as a file)
- `qrcode` for QR generation (server-side at render time)
- **Optional:** any CardDAV server (Baikal recommended) + a 2-file PHP admin shim ([`server/provision.php`](server/provision.php) + [`server/sign.php`](server/sign.php))
- **Optional:** Apple Developer Program ($99/yr) for profile signing - without it, iOS shows a red "Unverified" warning during install but the contacts still sync

No auth required to create - anyone with the link can build a page. Server-side rate limit (10 pages / hour / IP) and a 5,000-contact-per-page ceiling are configurable in [src/app/api/group-contacts-qr/create/route.ts](src/app/api/group-contacts-qr/create/route.ts).

## Self-hosting

### 1. Spin up Supabase

Create a free [Supabase](https://supabase.com) project. In the SQL editor, run [supabase/migrations/001_group_contact_qr_pages.sql](supabase/migrations/001_group_contact_qr_pages.sql) followed by [supabase/migrations/002_group_contact_qr_carddav.sql](supabase/migrations/002_group_contact_qr_carddav.sql).

### 2. Configure env (Android-only minimal setup)

Copy `.env.example` to `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...     # service role, server-side only
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

Leave `CARDDAV_*` blank if you don't need iPhone support yet - the app silently downgrades to Android-only mode (one QR per page). You can add CardDAV later without re-running any migrations.

### 3. Run

```
npm install
npm run dev
```

### 4. Deploy

Push to GitHub, import the repo into Vercel, set the same env vars, deploy. The app needs the Node runtime (already declared on each route). No long-running workers, no queues.

---

## iPhone CardDAV setup (optional, ~1-2 hours)

Restores one-tap "add all contacts" on iOS 26+. You need:

- A small server you control (a $5/mo VPS works) with PHP 8 + nginx
- A CardDAV server installed there ([Baikal](https://sabre.io/baikal/) recommended; anything sabre/dav-compatible works)
- *Optional:* An Apple Developer Program membership ($99/yr) to sign profiles. Without it, iPhones show a red "Unverified" warning during install (the contacts still sync, but users have to click through a scary screen).

### A. Install Baikal

Download from [github.com/sabre-io/Baikal/releases](https://github.com/sabre-io/Baikal/releases). Extract under your web root, point nginx at the `html/` directory, run the install wizard. See [server/README-baikal.md](server/README-baikal.md) for an opinionated setup with nginx config + permissions.

### B. Install the admin shim (provision.php + sign.php)

Copy [server/provision.php](server/provision.php) and [server/sign.php](server/sign.php) into a directory outside the Baikal web root (e.g. `/var/www/carddav-admin/`). Configure nginx to serve that directory under `/carddav-admin/` with PHP-FPM. Drop a random 64-hex-char secret (e.g. `openssl rand -hex 32`) into `admin-secret.txt` next to the PHP files (mode 640, owned by `www-data`).

`provision.php` creates per-slug Baikal users + addressbooks on demand. `sign.php` runs `openssl smime -sign` against the .mobileconfig XML using your Apple Developer Installer cert.

### C. Get an Apple Developer Installer cert (if you want signed profiles)

1. Sign up for the [Apple Developer Program](https://developer.apple.com/programs/) ($99/yr). Activation takes minutes to 2 business days.
2. On your CardDAV server, generate a CSR:
   ```bash
   openssl genrsa -out signing.key 2048
   openssl req -new -key signing.key -out signing.csr \
     -subj "/CN=Profile Signing/O=Your Org/C=US/emailAddress=YOUR-APPLE-ID-EMAIL"
   ```
   **The `emailAddress` MUST match your Apple Developer account email** or the portal rejects the CSR with a generic "Invalid Certificate". (We got bitten by this - Apple gives no helpful error message.)
3. In the Apple Developer portal: Certificates -> "+" -> **Developer ID Installer** -> **G2 Sub-CA (Xcode 11.4.1 or later)** -> upload `signing.csr` -> Continue -> Download.
4. Convert the downloaded DER to PEM and bundle Apple's chain:
   ```bash
   openssl x509 -inform DER -in developerID_installer.cer -out signing.cer.pem
   curl -sL https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer -o DeveloperIDG2CA.cer
   curl -sL https://www.apple.com/appleca/AppleIncRootCertificate.cer -o AppleIncRootCA.cer
   openssl x509 -inform DER -in DeveloperIDG2CA.cer -out DeveloperIDG2CA.pem
   openssl x509 -inform DER -in AppleIncRootCA.cer -out AppleIncRootCA.pem
   cat DeveloperIDG2CA.pem AppleIncRootCA.pem > apple-chain.pem
   ```
5. Place `signing.cer.pem` + `signing.key` + `apple-chain.pem` in the directory `sign.php` looks for them (default: `/home/<your-user>/profile-signing/` - see the `$signingDir` constant in [server/sign.php](server/sign.php), edit if needed).

The cert is valid 5 years. Set a calendar reminder for renewal.

### D. Set the iPhone-related env vars

```
CARDDAV_BASE_URL=https://your-server.example/baikal
CARDDAV_ADMIN_BASE_URL=https://your-server.example/carddav-admin
CARDDAV_ADMIN_SECRET=<the same secret as admin-secret.txt>
CARDDAV_SYNC_SECRET=<another random secret>
PROFILE_IDENTIFIER_PREFIX=org.your-domain.gcqr
PROFILE_ORGANIZATION=Your Org
```

Redeploy. The viewer page now renders both QR codes; iPhone scans get the signed CardDAV profile, Android scans still get the multi-vCard.

### E. Skip the cert (unsigned mode)

If you want CardDAV but don't want to pay $99/yr to Apple: remove `sign.php` from your admin dir entirely OR leave `CARDDAV_ADMIN_BASE_URL` blank. The app detects the missing signer and passes unsigned XML through. iOS shows a red "Unverified" warning on install, but the CardDAV subscription itself works fine. You can add the cert later without redeploying.

---

## How tenant isolation works

Each slug provisions a dedicated Baikal user `g-<slug>` with a random 24-char password. The .mobileconfig embeds those creds, so a user who installs `group-foo`'s profile gets credentials only for `group-foo`'s addressbook. PROPFIND from `g-foo` against `g-bar`'s addressbook returns 403 on every resource (verified end-to-end in production).

The same Apple Developer Installer cert signs every group's profile - the cert authenticates the *publisher*, not the *contents*. Adding a new group requires no per-group cert work; the wizard auto-provisions everything.

## License

MIT - see [LICENSE](LICENSE).

## Credits

Built by Claude (Anthropic) with [Ziv Raviv](https://kivimedia.co). Originally shipped at [kmboards.co/group-contacts-qr](https://kmboards.co/group-contacts-qr) for Kivi Media's agency clients.
