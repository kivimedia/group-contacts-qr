import QRCode from 'qrcode';
import { notFound } from 'next/navigation';
import { fetchGroupContactPage, bumpViewCount } from '@/lib/group-contacts-qr/fetch-page';
import GroupContactsQrFallback from '@/components/group-contacts-qr/GroupContactsQrFallback';
import { contactToVcard } from '@/lib/group-contacts-qr/vcard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';

async function generateQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 512,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const row = await fetchGroupContactPage(slug);
  if (!row) return { title: 'Group not found' };
  return {
    title: `${row.name} contacts - scan once, save the whole group`,
    description: `Add all ${row.member_count} ${row.name} contacts to your phone in one tap.`,
  };
}

type Step = { num: number; title: string; body: string };

const IPHONE_STEPS: Step[] = [
  {
    num: 1,
    title: 'Scan or tap',
    body: 'Use your iPhone Camera to scan the QR (or tap the button under it). Safari will ask "This website is trying to download a configuration profile" - tap Allow.',
  },
  {
    num: 2,
    title: 'Open Settings',
    body: 'Open the Settings app. A "Profile Downloaded" banner appears at the top - tap it. (If you missed it: Settings -> General -> VPN & Device Management.)',
  },
  {
    num: 3,
    title: 'Install the profile',
    body: 'Tap Install (top right), enter your iPhone passcode, then tap Install once more. The contacts appear in your Contacts app within seconds, and stay in sync as the roster grows.',
  },
];

const ANDROID_STEPS: Step[] = [
  {
    num: 1,
    title: 'Scan or tap',
    body: 'Scan the QR with the Camera app, or tap the button. Your browser will download a vCard file with all the contacts.',
  },
  {
    num: 2,
    title: 'Open the file',
    body: 'Tap the downloaded file (in your notification shade or Files / Downloads app). Android offers Contacts as one of the apps to open it with.',
  },
  {
    num: 3,
    title: 'Import all',
    body: 'Pick the Google account or local storage to import into, then confirm. Your phone adds all contacts in one batch.',
  },
];

export default async function GroupContactsQrViewerPage({ params }: Props) {
  const { slug } = await params;
  const row = await fetchGroupContactPage(slug);
  if (!row) notFound();

  const iphoneUrl = `${SITE_URL}/group-contacts-qr/${row.slug}/profile.mobileconfig`;
  const androidUrl = `${SITE_URL}/group-contacts-qr/${row.slug}/contacts.vcf`;
  const [iphoneQr, androidQr] = await Promise.all([
    generateQrDataUrl(iphoneUrl),
    generateQrDataUrl(androidUrl),
  ]);

  // Best-effort view bump - don't await, don't block render on failure.
  bumpViewCount(row);

  const fallbackMembers = row.members.map((m) => ({
    fullName: m.fullName || `${m.firstName} ${m.lastName}`.trim(),
    company: m.company,
    vcard: contactToVcard(m, row.name),
  }));

  const total = row.member_count;
  const cardDavConfigured = !!process.env.CARDDAV_BASE_URL;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {row.name}
          </h1>
          <p className="mt-3 text-base text-slate-700">
            Add every contact to your phone in under a minute.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            {total} {total === 1 ? 'contact' : 'contacts'}
          </p>
        </header>

        <div
          className={`mt-10 grid grid-cols-1 gap-6 ${
            cardDavConfigured ? 'lg:grid-cols-2' : ''
          }`}
        >
          {cardDavConfigured && (
            <PlatformCard
              label="iPhone"
              tagline="Auto-syncing - new members appear automatically"
              qrDataUrl={iphoneQr}
              url={iphoneUrl}
              buttonLabel="Install on iPhone"
              steps={IPHONE_STEPS}
              accent="indigo"
              count={total}
            />
          )}
          <PlatformCard
            label={cardDavConfigured ? 'Android' : 'Add all contacts'}
            tagline={
              cardDavConfigured
                ? 'One-time download - re-scan if the roster updates'
                : 'Scan the QR with the Camera app'
            }
            qrDataUrl={androidQr}
            url={androidUrl}
            buttonLabel={`Add ${total} ${total === 1 ? 'contact' : 'contacts'}`}
            steps={ANDROID_STEPS}
            accent="emerald"
            count={total}
          />
        </div>

        {cardDavConfigured && (
          <div className="mt-10 rounded-xl bg-white p-6 ring-1 ring-slate-200">
            <h2 className="text-base font-semibold text-slate-900">
              Not sure which to use?
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li>
                <strong className="text-slate-900">iPhone owners:</strong> use
                the left card. iOS broke the bulk &quot;import many vCards&quot;
                flow in 2026, so we ship contacts via Apple&apos;s CardDAV
                protocol. Bonus: when the group&apos;s roster gets updated, the
                new contacts show up on your phone automatically.
              </li>
              <li>
                <strong className="text-slate-900">Android owners:</strong> use
                the right card. Android handles bulk vCard imports natively, so
                one tap adds all {total} contacts.
              </li>
              <li>
                <strong className="text-slate-900">Removing later:</strong> on
                iPhone go to Settings -&gt; General -&gt; VPN & Device
                Management -&gt; {row.name} Contacts -&gt; Remove. On Android,
                delete the contacts from your Contacts app.
              </li>
            </ul>
          </div>
        )}

        <div className="mt-10 border-t border-slate-200 pt-8">
          <GroupContactsQrFallback members={fallbackMembers} />
        </div>

        <p className="mt-10 text-center text-xs text-slate-500">
          Direct links:{' '}
          {cardDavConfigured && (
            <>
              <a
                href={iphoneUrl}
                className="font-mono underline hover:text-slate-900"
              >
                iPhone profile
              </a>{' '}
              ·{' '}
            </>
          )}
          <a href={androidUrl} className="font-mono underline hover:text-slate-900">
            Android vCard
          </a>
        </p>
      </div>
    </main>
  );
}

function PlatformCard({
  label,
  tagline,
  qrDataUrl,
  url,
  buttonLabel,
  steps,
  accent,
  count,
}: {
  label: string;
  tagline: string;
  qrDataUrl: string;
  url: string;
  buttonLabel: string;
  steps: Step[];
  accent: 'indigo' | 'emerald';
  count: number;
}) {
  const accentClasses =
    accent === 'indigo'
      ? {
          ring: 'ring-indigo-200',
          badge: 'bg-indigo-100 text-indigo-900',
          stepNum: 'bg-indigo-600',
          button: 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800',
        }
      : {
          ring: 'ring-emerald-200',
          badge: 'bg-emerald-100 text-emerald-900',
          stepNum: 'bg-emerald-600',
          button: 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800',
        };

  return (
    <section
      className={`flex flex-col rounded-2xl bg-white p-6 shadow-sm ring-1 ${accentClasses.ring}`}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-bold text-slate-900">{label}</h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${accentClasses.badge}`}
        >
          {count} contacts
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-600">{tagline}</p>

      <div className="mt-5 flex flex-col items-center gap-4 rounded-xl bg-slate-50 p-5 ring-1 ring-slate-200">
        <div className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt={`QR code for ${label}`}
            width={512}
            height={512}
            className="h-44 w-44 sm:h-52 sm:w-52"
          />
        </div>
        <a
          href={url}
          className={`inline-flex w-full items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold text-white shadow-sm transition ${accentClasses.button}`}
        >
          {buttonLabel}
        </a>
        <p className="text-center text-xs text-slate-500">
          Scan with Camera (recommended) or tap the button
        </p>
      </div>

      <ol className="mt-6 space-y-4">
        {steps.map((s) => (
          <li key={s.num} className="flex gap-3">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${accentClasses.stepNum}`}
              aria-hidden
            >
              {s.num}
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {s.title}
              </div>
              <div className="mt-0.5 text-sm leading-relaxed text-slate-700">
                {s.body}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
