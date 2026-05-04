-- Migration 001: Group Contact QR pages
-- Anonymous-create tool. Anyone can upload a CSV/sheet, name the group, pick
-- a slug, and the page at /group-contacts-qr/<slug> shows a QR + bulk vCard
-- so visitors add the whole group to their phone in one tap.

CREATE TABLE IF NOT EXISTS group_contact_qr_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  members jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Soft attribution / abuse signals (no auth required to create).
  creator_email text,
  creator_ip inet,

  -- Cached counters; cheap to keep in sync at write time.
  member_count integer NOT NULL DEFAULT 0,
  view_count bigint NOT NULL DEFAULT 0,

  CONSTRAINT slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  CONSTRAINT slug_lowercase CHECK (slug = lower(slug)),
  CONSTRAINT name_nonempty CHECK (length(trim(name)) > 0),
  CONSTRAINT member_count_sane CHECK (member_count >= 0 AND member_count <= 5000)
);

CREATE INDEX IF NOT EXISTS idx_gcqr_created_at ON group_contact_qr_pages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gcqr_creator_ip_recent
  ON group_contact_qr_pages(creator_ip, created_at DESC);

ALTER TABLE group_contact_qr_pages ENABLE ROW LEVEL SECURITY;

-- Public viewer pages: anyone may SELECT. Writes go through the service-role
-- API route, which performs its own validation and rate limiting. We do NOT
-- grant anon insert directly so abuse can be gated server-side.
DROP POLICY IF EXISTS group_contact_qr_pages_public_read ON group_contact_qr_pages;
CREATE POLICY group_contact_qr_pages_public_read
  ON group_contact_qr_pages FOR SELECT
  USING (true);
