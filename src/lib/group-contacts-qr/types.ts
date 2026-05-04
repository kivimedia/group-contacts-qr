/**
 * Shared types for the /group-contacts-qr tool. Persisted as JSONB inside
 * group_contact_qr_pages.members.
 */
export type GenericContact = {
  firstName: string;
  lastName: string;
  fullName: string;
  company: string;
  jobTitle: string;
  email: string;
  cellPhone: string;
  workPhone: string;
  websiteUrl: string;
  notes: string;
};

export const CONTACT_FIELDS: readonly (keyof GenericContact)[] = [
  'firstName',
  'lastName',
  'fullName',
  'company',
  'jobTitle',
  'email',
  'cellPhone',
  'workPhone',
  'websiteUrl',
  'notes',
] as const;

export type ContactField = (typeof CONTACT_FIELDS)[number];

export type ColumnMapping = Partial<Record<ContactField, string>>;

export type GroupContactPageRow = {
  id: string;
  slug: string;
  name: string;
  members: GenericContact[];
  member_count: number;
  view_count: number;
  created_at: string;
};

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

export const MAX_MEMBERS_PER_PAGE = 5000;
