import { SLUG_RE } from './types';

const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'create',
  'new',
  'edit',
  'delete',
  'login',
  'logout',
  'about',
  'help',
  'support',
  'terms',
  'privacy',
  '_next',
  'static',
]);

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export type SlugValidation =
  | { ok: true }
  | { ok: false; reason: string };

export function validateSlug(slug: string): SlugValidation {
  if (!slug) return { ok: false, reason: 'Slug is required' };
  if (slug.length < 3) return { ok: false, reason: 'Slug must be at least 3 characters' };
  if (slug.length > 64) return { ok: false, reason: 'Slug must be 64 characters or fewer' };
  if (!SLUG_RE.test(slug)) {
    return {
      ok: false,
      reason: 'Use lowercase letters, numbers, and dashes only (no leading/trailing dash)',
    };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, reason: 'That slug is reserved — try another' };
  }
  return { ok: true };
}
