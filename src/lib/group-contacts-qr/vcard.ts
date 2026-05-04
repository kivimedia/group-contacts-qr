import type { GenericContact } from './types';

function escapeVcardValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function deriveFullName(c: GenericContact): string {
  if (c.fullName) return c.fullName;
  return [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
}

function deriveLastFirst(c: GenericContact): { first: string; last: string } {
  if (c.firstName || c.lastName) {
    return { first: c.firstName, last: c.lastName };
  }
  // Fall back to splitting fullName on the last space.
  const full = c.fullName.trim();
  if (!full) return { first: '', last: '' };
  const idx = full.lastIndexOf(' ');
  if (idx === -1) return { first: full, last: '' };
  return { first: full.slice(0, idx), last: full.slice(idx + 1) };
}

export function contactToVcard(c: GenericContact, groupName: string): string {
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];

  const fn = deriveFullName(c);
  if (!fn) return '';
  const { first, last } = deriveLastFirst(c);

  lines.push(`FN:${escapeVcardValue(fn)}`);
  lines.push(`N:${escapeVcardValue(last)};${escapeVcardValue(first)};;;`);

  if (c.company) lines.push(`ORG:${escapeVcardValue(c.company)}`);
  if (c.jobTitle) lines.push(`TITLE:${escapeVcardValue(c.jobTitle)}`);
  if (c.email) lines.push(`EMAIL;TYPE=WORK:${escapeVcardValue(c.email)}`);
  if (c.cellPhone) lines.push(`TEL;TYPE=CELL:${escapeVcardValue(c.cellPhone)}`);
  if (c.workPhone) lines.push(`TEL;TYPE=WORK:${escapeVcardValue(c.workPhone)}`);
  if (c.websiteUrl) lines.push(`URL:${escapeVcardValue(c.websiteUrl)}`);

  const noteParts: string[] = [];
  if (groupName) noteParts.push(groupName);
  if (c.notes) noteParts.push(c.notes);
  if (noteParts.length) {
    lines.push(`NOTE:${escapeVcardValue(noteParts.join(' - '))}`);
  }

  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function buildMultiVcard(
  contacts: GenericContact[],
  groupName: string
): string {
  return (
    contacts
      .map((c) => contactToVcard(c, groupName))
      .filter(Boolean)
      .join('\r\n') + '\r\n'
  );
}
