import GroupContactsQrWizard from './GroupContactsQrWizard';

export const metadata = {
  title: 'Group Contacts QR — one scan, every contact saved',
  description:
    'Upload your group roster (CSV or Excel) and get a QR code. One scan adds every member to a phone — no app, no signup.',
};

export default function GroupContactsQrIndexPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 p-8 sm:p-10">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Group Contacts QR
          </h1>
          <p className="mt-2 text-base text-slate-700">
            Upload your group roster, pick a name and a link, and get a single
            QR code that adds every contact to a phone in one scan.
          </p>

          <GroupContactsQrWizard />
        </div>
      </div>
    </main>
  );
}
