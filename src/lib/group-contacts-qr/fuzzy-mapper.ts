import type { ColumnMapping, ContactField } from './types';

/**
 * Fuzzy-match raw column headers against our canonical contact fields.
 * Pure function — runs on both server (CSV from upload) and client
 * (preview after parsing).
 *
 * Strategy: lowercase + strip non-alphanum, then match against a per-field
 * synonym list. First column to win a field keeps it; later columns can take
 * different fields. Returns mapping `field -> column header`.
 */
const SYNONYMS: Record<ContactField, RegExp[]> = {
  firstName: [/^first(name)?$/, /^fname$/, /^givenname$/, /^given$/],
  lastName: [/^last(name)?$/, /^lname$/, /^surname$/, /^familyname$/, /^family$/],
  fullName: [
    /^(full)?name$/,
    /^displayname$/,
    /^contact(name)?$/,
    /^person$/,
  ],
  company: [
    /^company(name)?$/,
    /^organi[sz]ation$/,
    /^org$/,
    /^business$/,
    /^employer$/,
  ],
  jobTitle: [/^(job)?title$/, /^role$/, /^position$/, /^jobrole$/],
  email: [
    /^email(address)?$/,
    /^e?mail$/,
    /^workemail$/,
    /^primaryemail$/,
  ],
  cellPhone: [
    /^(cell|mobile)(phone)?(number)?$/,
    /^phone$/,
    /^phonenumber$/,
    /^mobile$/,
    /^cell$/,
    /^sms$/,
  ],
  workPhone: [
    /^work(phone)?(number)?$/,
    /^office(phone)?$/,
    /^business(phone)?$/,
    /^landline$/,
  ],
  websiteUrl: [
    /^(website|web)?url$/,
    /^website$/,
    /^url$/,
    /^homepage$/,
    /^site$/,
  ],
  notes: [/^notes?$/, /^comments?$/, /^description$/, /^bio$/],
};

function normalize(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const usedHeaders = new Set<string>();

  // Two-pass: prefer more-specific fields (firstName before fullName, cell
  // before generic phone) so a sheet that has both `Cell Phone` and `Phone`
  // sends each to the right slot.
  const passOrder: ContactField[][] = [
    [
      'firstName',
      'lastName',
      'cellPhone',
      'workPhone',
      'jobTitle',
      'email',
      'company',
      'websiteUrl',
      'notes',
    ],
    ['fullName'],
  ];

  for (const fields of passOrder) {
    for (const field of fields) {
      if (mapping[field]) continue;
      for (const header of headers) {
        if (usedHeaders.has(header)) continue;
        const norm = normalize(header);
        if (SYNONYMS[field].some((re) => re.test(norm))) {
          mapping[field] = header;
          usedHeaders.add(header);
          break;
        }
      }
    }
  }

  return mapping;
}
