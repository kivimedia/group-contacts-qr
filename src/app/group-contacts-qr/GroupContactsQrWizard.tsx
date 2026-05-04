'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { autoMapColumns } from '@/lib/group-contacts-qr/fuzzy-mapper';
import { slugify, validateSlug } from '@/lib/group-contacts-qr/slug';
import {
  CONTACT_FIELDS,
  type ColumnMapping,
  type ContactField,
  type GenericContact,
  MAX_MEMBERS_PER_PAGE,
} from '@/lib/group-contacts-qr/types';

const FIELD_LABELS: Record<ContactField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  fullName: 'Full name',
  company: 'Company',
  jobTitle: 'Job title',
  email: 'Email',
  cellPhone: 'Cell / mobile phone',
  workPhone: 'Work phone',
  websiteUrl: 'Website',
  notes: 'Notes',
};

type ParsedRow = Record<string, string>;

type SlugStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'taken'; reason: string }
  | { state: 'invalid'; reason: string };

// Picks the most likely header row in the first ~10 rows of an upload.
// Real-world rosters often start with banner rows ("DJ THINK TANK ROSTER",
// "Updated as of May 9, 2022") before the actual column headers. We score
// each candidate row by how many cells the fuzzy mapper can recognize as
// known contact fields; ties go to the earliest row.
function detectHeaderRowIdx(rawRows: string[][]): number {
  const SCAN_DEPTH = Math.min(rawRows.length, 10);
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < SCAN_DEPTH; i++) {
    const candidate = (rawRows[i] ?? []).map((c) => c.trim()).filter(Boolean);
    if (candidate.length < 2) continue;
    const mapping = autoMapColumns(candidate);
    const score = Object.keys(mapping).length;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  // If nothing scored anything (file has no recognizable headers anywhere),
  // fall back to the first row that has 2+ non-empty cells, else row 0.
  if (bestScore <= 0) {
    for (let i = 0; i < SCAN_DEPTH; i++) {
      const populated = (rawRows[i] ?? []).filter((c) => c.trim()).length;
      if (populated >= 2) return i;
    }
  }
  return bestIdx;
}

export default function GroupContactsQrWizard() {
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [headerRowIdx, setHeaderRowIdx] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});

  const [groupName, setGroupName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>({ state: 'idle' });

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Auto-derive slug from group name until the user manually edits it.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(groupName));
  }, [groupName, slugTouched]);

  // Debounced slug availability check.
  useEffect(() => {
    if (!slug) {
      setSlugStatus({ state: 'idle' });
      return;
    }
    const validation = validateSlug(slug);
    if (!validation.ok) {
      setSlugStatus({ state: 'invalid', reason: validation.reason });
      return;
    }
    setSlugStatus({ state: 'checking' });
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/group-contacts-qr/check-slug?slug=${encodeURIComponent(slug)}`,
          { cache: 'no-store' }
        );
        const json = (await res.json()) as {
          available: boolean;
          reason?: string;
        };
        if (json.available) setSlugStatus({ state: 'available' });
        else setSlugStatus({ state: 'taken', reason: json.reason ?? 'Taken' });
      } catch (err) {
        setSlugStatus({
          state: 'invalid',
          reason: err instanceof Error ? err.message : 'Check failed',
        });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [slug]);

  function handleFile(f: File) {
    setFile(f);
    setParseError(null);
    setRawRows([]);
    setHeaderRowIdx(0);
    setMapping({});

    const reader = new FileReader();
    reader.onerror = () => setParseError('Failed to read the file');
    reader.onload = () => {
      try {
        const data = reader.result;
        if (!data) throw new Error('Empty file');
        const wb = XLSX.read(data, { type: 'array' });
        const firstSheet = wb.SheetNames[0];
        if (!firstSheet) throw new Error('Workbook has no sheets');
        const sheet = wb.Sheets[firstSheet]!;
        const rowsAoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          defval: '',
          blankrows: false,
        });
        if (rowsAoa.length === 0) throw new Error('Sheet is empty');

        const normalized: string[][] = rowsAoa.map((r) =>
          (r ?? []).map((c) => String(c ?? '').trim())
        );
        const detectedIdx = detectHeaderRowIdx(normalized);

        setRawRows(normalized);
        setHeaderRowIdx(detectedIdx);
        // Mapping recomputes via useEffect that watches headerRowIdx + rawRows.
      } catch (err) {
        setParseError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsArrayBuffer(f);
  }

  // Re-derive headers + data rows whenever the user picks a different header
  // row. Memoized so the contact preview doesn't recompute on every keystroke.
  const headers = useMemo(
    () => (rawRows[headerRowIdx] ?? []).map((c) => c.trim()).filter(Boolean),
    [rawRows, headerRowIdx]
  );
  const rows: ParsedRow[] = useMemo(() => {
    if (rawRows.length === 0) return [];
    const headerRow = rawRows[headerRowIdx] ?? [];
    return rawRows.slice(headerRowIdx + 1).map((r) => {
      const obj: ParsedRow = {};
      headerRow.forEach((h, i) => {
        const key = String(h ?? '').trim();
        if (!key) return;
        obj[key] = String(r[i] ?? '').trim();
      });
      return obj;
    });
  }, [rawRows, headerRowIdx]);

  // When the user manually changes the header row, re-run auto-mapping so the
  // dropdowns update to match the new headers (they can still override).
  useEffect(() => {
    if (rawRows.length === 0) return;
    setMapping(autoMapColumns(headers));
    // Intentionally only on header row changes, not on every headers-array
    // identity flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerRowIdx, rawRows]);

  const previewMembers: GenericContact[] = useMemo(() => {
    if (rows.length === 0) return [];
    return rows
      .map((row) => buildContact(row, mapping))
      .filter((c): c is GenericContact => c !== null);
  }, [rows, mapping]);

  const canSubmit =
    previewMembers.length > 0 &&
    groupName.trim().length > 0 &&
    slugStatus.state === 'available' &&
    !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/group-contacts-qr/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          name: groupName.trim(),
          members: previewMembers,
        }),
      });
      const json = (await res.json()) as { slug?: string; error?: string };
      if (!res.ok) {
        setSubmitError(json.error ?? 'Save failed');
        setSubmitting(false);
        return;
      }
      router.push(`/group-contacts-qr/${json.slug}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-8 space-y-8">
      {/* Step 1: file upload */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          1. Upload the roster
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          CSV or Excel (.xlsx) file. We&apos;ll find your header row even if
          there are banner rows above it.
        </p>
        <FileDrop file={file} onFile={handleFile} />
        {parseError && (
          <p className="mt-2 text-sm text-red-700">{parseError}</p>
        )}
        {rawRows.length > 0 && (
          <>
            <p className="mt-3 text-sm text-slate-600">
              Loaded <strong>{rows.length}</strong> rows ·{' '}
              <strong>{headers.length}</strong> columns. Header row is{' '}
              <strong>row {headerRowIdx + 1}</strong>. Wrong? Click another
              row.
            </p>
            <HeaderRowPicker
              rawRows={rawRows}
              selectedIdx={headerRowIdx}
              onSelect={setHeaderRowIdx}
            />
          </>
        )}
      </section>

      {/* Step 2: column mapping */}
      {headers.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            2. Confirm column mapping
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            We auto-detected these columns. Adjust any that look wrong.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {CONTACT_FIELDS.map((field) => (
              <label key={field} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-700">
                  {FIELD_LABELS[field]}
                </span>
                <select
                  value={mapping[field] ?? ''}
                  onChange={(e) =>
                    setMapping((m) => ({
                      ...m,
                      [field]: e.target.value || undefined,
                    }))
                  }
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                >
                  <option value="">— not in file —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {previewMembers.length > 0 && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-700 ring-1 ring-slate-200">
              Preview: <strong>{previewMembers.length}</strong> contacts will
              be saved · first 3:{' '}
              {previewMembers
                .slice(0, 3)
                .map((m) => m.fullName || m.firstName + ' ' + m.lastName)
                .filter(Boolean)
                .join(', ')}
              {previewMembers.length > MAX_MEMBERS_PER_PAGE && (
                <span className="ml-1 text-red-700">
                  · over the {MAX_MEMBERS_PER_PAGE} limit, trim before saving
                </span>
              )}
            </div>
          )}
        </section>
      )}

      {/* Step 3: name + slug */}
      {previewMembers.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            3. Name your page
          </h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-700">
                Group name (shown on the page)
              </span>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. DJ Think Tank Sponsors"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
                maxLength={120}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-700">
                Link
              </span>
              <div className="flex items-center rounded-md border border-slate-300 bg-white text-sm focus-within:border-slate-500">
                <span className="select-none px-2 py-2 text-slate-500">
                  /group-contacts-qr/
                </span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                  className="w-full bg-transparent py-2 pr-2 text-slate-900 focus:outline-none"
                  maxLength={64}
                />
              </div>
              <SlugStatusLine status={slugStatus} />
            </label>
          </div>
        </section>
      )}

      {/* Step 4: create */}
      {previewMembers.length > 0 && (
        <section>
          {submitError && (
            <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
              {submitError}
            </p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {submitting
              ? 'Creating…'
              : `Create page with ${previewMembers.length} contacts`}
          </button>
        </section>
      )}
    </div>
  );
}

function buildContact(
  row: ParsedRow,
  mapping: ColumnMapping
): GenericContact | null {
  const get = (f: ContactField) => {
    const col = mapping[f];
    if (!col) return '';
    return (row[col] ?? '').toString().trim();
  };
  const firstName = get('firstName');
  const lastName = get('lastName');
  let fullName = get('fullName');
  if (!fullName) fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (!fullName && !firstName && !lastName && !get('email')) return null;
  return {
    firstName,
    lastName,
    fullName,
    company: get('company'),
    jobTitle: get('jobTitle'),
    email: get('email'),
    cellPhone: get('cellPhone'),
    workPhone: get('workPhone'),
    websiteUrl: get('websiteUrl'),
    notes: get('notes'),
  };
}

function FileDrop({
  file,
  onFile,
}: {
  file: File | null;
  onFile: (f: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      onClick={() => inputRef.current?.click()}
      className={`mt-3 cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition ${
        dragOver
          ? 'border-slate-900 bg-slate-50'
          : 'border-slate-300 bg-white hover:border-slate-500'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      {file ? (
        <p className="text-sm text-slate-700">
          <strong>{file.name}</strong> · click or drop to replace
        </p>
      ) : (
        <p className="text-sm text-slate-600">
          Drop a CSV or Excel file here, or click to choose
        </p>
      )}
    </div>
  );
}

function HeaderRowPicker({
  rawRows,
  selectedIdx,
  onSelect,
}: {
  rawRows: string[][];
  selectedIdx: number;
  onSelect: (idx: number) => void;
}) {
  const PEEK = Math.min(rawRows.length, 6);
  const peekRows = rawRows.slice(0, PEEK);

  return (
    <div className="mt-3 overflow-x-auto rounded-lg ring-1 ring-slate-200">
      <table className="min-w-full text-xs">
        <tbody>
          {peekRows.map((row, idx) => {
            const isSelected = idx === selectedIdx;
            const cells = row.slice(0, 6);
            const more = row.length - cells.length;
            return (
              <tr
                key={idx}
                onClick={() => onSelect(idx)}
                className={`cursor-pointer border-b border-slate-100 last:border-b-0 transition ${
                  isSelected
                    ? 'bg-emerald-50 font-medium text-emerald-900'
                    : 'bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <td className="px-2 py-1.5 text-slate-400">
                  {isSelected ? '▸' : ''}
                  {idx + 1}
                </td>
                {cells.map((c, i) => (
                  <td
                    key={i}
                    className="max-w-[180px] truncate px-2 py-1.5"
                    title={c}
                  >
                    {c || <span className="text-slate-300">·</span>}
                  </td>
                ))}
                {more > 0 && (
                  <td className="px-2 py-1.5 text-slate-400">+{more} more</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SlugStatusLine({ status }: { status: SlugStatus }) {
  if (status.state === 'idle') {
    return <span className="mt-1 text-xs text-slate-500">&nbsp;</span>;
  }
  if (status.state === 'checking') {
    return <span className="mt-1 text-xs text-slate-500">Checking…</span>;
  }
  if (status.state === 'available') {
    return <span className="mt-1 text-xs text-emerald-700">Available</span>;
  }
  return <span className="mt-1 text-xs text-red-700">{status.reason}</span>;
}
