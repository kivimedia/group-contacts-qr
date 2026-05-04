'use client';

import { useMemo, useState } from 'react';

type FallbackMember = {
  fullName: string;
  company: string;
  vcard: string;
};

function vcardToBlobUrl(vcard: string): string {
  const blob = new Blob([vcard], { type: 'text/vcard;charset=utf-8' });
  return URL.createObjectURL(blob);
}

export default function GroupContactsQrFallback({
  members,
}: {
  members: FallbackMember[];
}) {
  const [open, setOpen] = useState(false);

  const memberRows = useMemo(
    () =>
      members.map((m, idx) => ({
        ...m,
        id: `${idx}-${m.fullName}`,
      })),
    [members]
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
        aria-expanded={open}
      >
        iOS issues? Add contacts one at a time
      </button>

      {open && (
        <div className="mt-4 rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
          <p className="text-xs text-slate-600">
            If your phone&apos;s &quot;Add All&quot; sheet didn&apos;t work,
            you can add each contact individually. Tap a name; the phone will
            open a single contact card and let you save it.
          </p>
          <ul className="mt-3 divide-y divide-slate-200">
            {memberRows.map((m) => {
              const blobUrl = vcardToBlobUrl(m.vcard);
              return (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {m.fullName}
                    </div>
                    {m.company ? (
                      <div className="truncate text-xs text-slate-500">
                        {m.company}
                      </div>
                    ) : null}
                  </div>
                  <a
                    href={blobUrl}
                    download={`${m.fullName.replace(/\s+/g, '-').toLowerCase()}.vcf`}
                    className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    Save
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
