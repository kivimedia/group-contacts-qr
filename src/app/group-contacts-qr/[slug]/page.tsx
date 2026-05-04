import QRCode from 'qrcode';
import { notFound } from 'next/navigation';
import { fetchGroupContactPage, bumpViewCount } from '@/lib/group-contacts-qr/fetch-page';
import GroupContactsQrFallback from '@/components/group-contacts-qr/GroupContactsQrFallback';
import { contactToVcard } from '@/lib/group-contacts-qr/vcard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? 'https://kmboards.co';

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
    title: `${row.name} contacts — scan once, save the whole group`,
    description: `Scan the QR to add all ${row.member_count} ${row.name} contacts to your phone in one tap.`,
  };
}

export default async function GroupContactsQrViewerPage({ params }: Props) {
  const { slug } = await params;
  const row = await fetchGroupContactPage(slug);
  if (!row) notFound();

  const vcfUrl = `${SITE_URL}/group-contacts-qr/${row.slug}/contacts.vcf`;
  const qrDataUrl = await generateQrDataUrl(vcfUrl);

  // Best-effort view bump — don't await, don't block render on failure.
  bumpViewCount(row);

  const fallbackMembers = row.members.map((m) => ({
    fullName: m.fullName || `${m.firstName} ${m.lastName}`.trim(),
    company: m.company,
    vcard: contactToVcard(m, row.name),
  }));

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-8 sm:p-10">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            {row.name}
          </h1>
          <p className="mt-2 text-base text-slate-700">
            Scan this QR with your phone&apos;s Camera app to add every contact
            in one step.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            {row.member_count} contacts
          </p>

          <div className="mt-8 flex flex-col items-center gap-6">
            <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt={`QR code for ${vcfUrl}`}
                width={512}
                height={512}
                className="h-64 w-64 sm:h-80 sm:w-80"
              />
            </div>

            <a
              href={vcfUrl}
              className="inline-flex w-full max-w-md items-center justify-center rounded-xl bg-slate-900 px-6 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800 active:bg-slate-950"
            >
              Add all {row.member_count} contacts to my phone
            </a>

            <p className="max-w-md text-center text-xs text-slate-600">
              Best results: scan with the iPhone or Android Camera app, not
              from inside Messages, WhatsApp, or Instagram.
            </p>
          </div>

          <div className="mt-10 border-t border-slate-200 pt-6">
            <GroupContactsQrFallback members={fallbackMembers} />
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Direct file link:{' '}
          <a
            href={vcfUrl}
            className="font-mono text-slate-600 underline hover:text-slate-900"
          >
            {vcfUrl}
          </a>
        </p>
      </div>
    </main>
  );
}
