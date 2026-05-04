# Group Contacts QR

Open-source CSV/Excel-to-QR contact-card builder. Upload a roster, get a public page with a single QR that adds every member of your group to a phone in one scan. No app, no signup.

A gift to the world from [Kivi Media](https://kivimedia.co).

## What it does

1. Upload a CSV or Excel file (drag-drop or click). First row is column headers.
2. The tool fuzzy-matches your columns against `First / Last / Full / Email / Cell / Work / Title / Company / URL / Notes` automatically; you can override any mapping.
3. Name the group, pick a slug.
4. Get a public viewer page at `/group-contacts-qr/<slug>` with a QR that, when scanned by an iPhone or Android Camera app, prompts the user to save every contact to their phone in one tap.

The viewer also exposes a direct download at `/group-contacts-qr/<slug>/contacts.vcf` (a multi-vCard) for fallback flows.

## Stack

- Next.js 14 (App Router)
- React + Tailwind
- Supabase Postgres for slug uniqueness + storage of contacts as JSONB
- `xlsx` for both CSV and Excel parsing (client-side, never uploaded as a file)
- `qrcode` for QR generation (server-side at render time)

No auth required to create — anyone with the link can build a page. Server-side rate limit (10 pages / hour / IP) and a 5,000-contact-per-page ceiling are configurable in [src/app/api/group-contacts-qr/create/route.ts](src/app/api/group-contacts-qr/create/route.ts).

## Self-hosting

### 1. Spin up Supabase

Create a free [Supabase](https://supabase.com) project. In the SQL editor, run [supabase/migrations/001_group_contact_qr_pages.sql](supabase/migrations/001_group_contact_qr_pages.sql).

### 2. Configure env

Copy `.env.example` to `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...     # service role, server-side only
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

### 3. Run

```
npm install
npm run dev
```

### 4. Deploy

Push to GitHub, import the repo into Vercel, set the same env vars, deploy. The app needs the Node runtime (already declared on each route). No long-running workers, no queues.

## License

MIT — see [LICENSE](LICENSE).

## Credits

Built by Claude (Anthropic) with [Ziv Raviv](https://kivimedia.co). Originally shipped at [kmboards.co/group-contacts-qr](https://kmboards.co/group-contacts-qr) for Kivi Media's agency clients.
