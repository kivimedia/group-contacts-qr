-- Migration 002: per-group CardDAV provisioning columns
--
-- Why: iOS 26 broke the bulk-multi-vCard import path that the original
-- /<slug>/contacts.vcf flow relied on. iPhones returning to /<slug> now scan
-- the iPhone QR which downloads an Apple Configuration Profile
-- (.mobileconfig) that subscribes the device to a per-slug CardDAV
-- addressbook. Each slug gets its own dedicated CardDAV user
-- (g-<slug>) so subscribers to one group cannot read another group's
-- contacts.
--
-- These columns track the per-slug CardDAV state. They get populated by
-- the wizard's create endpoint when it provisions the addressbook on the
-- CardDAV server, and again every time the wizard is re-run for the same
-- slug to push roster changes.

ALTER TABLE group_contact_qr_pages
  ADD COLUMN IF NOT EXISTS carddav_username text,
  ADD COLUMN IF NOT EXISTS carddav_password text,
  ADD COLUMN IF NOT EXISTS carddav_provisioned_at timestamptz,
  ADD COLUMN IF NOT EXISTS carddav_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS carddav_card_count integer;

-- Lookup index for the lazy-provisioning code path: when a viewer hits
-- /group-contacts-qr/<slug>/profile.mobileconfig we filter by slug AND
-- carddav_provisioned_at IS NULL to know whether to call the CardDAV
-- admin endpoint.
CREATE INDEX IF NOT EXISTS idx_gcqr_unprovisioned
  ON group_contact_qr_pages(slug)
  WHERE carddav_provisioned_at IS NULL;

COMMENT ON COLUMN group_contact_qr_pages.carddav_password IS
  'Plaintext CardDAV password embedded in /group-contacts-qr/<slug>/profile.mobileconfig. Anyone scanning the iPhone QR receives this credential, so encryption-at-rest is theatre against the threat model. API routes that surface this column should be limited to the .mobileconfig generator.';
