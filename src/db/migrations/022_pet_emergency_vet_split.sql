-- 022: Split pets.emergency_vet into clinic name + phone (PH-2, 2026-07-18 gap).
--
-- Today emergency_vet is one free-text string (usually "Clinic, 5551234"), so
-- on the one screen where someone may need to call a vet urgently the number
-- can't be formatted, can't be searched, and can't become a tel: link. This
-- splits it into a name and a phone.
--
-- SAFE + REVERSIBLE ON PURPOSE:
--   * The two new columns are ADDED; the original emergency_vet column is
--     KEPT, not dropped. Nothing is destroyed, so a bad split can be re-run
--     from the untouched source. A later migration drops emergency_vet once
--     the split is verified in the app.
--   * The backfill splits on the FIRST run of digits: everything before the
--     first digit is the clinic name (trailing separators trimmed), the first
--     digit onward is the phone. No digits at all → the whole string is the
--     name and phone stays NULL. This is a heuristic over free text, which is
--     exactly why the source column is retained.
--
-- ⚠️ DEPLOY ORDER: apply this migration BEFORE deploying the app code that
--    writes emergency_vet_name / emergency_vet_phone, or those inserts hit
--    columns that don't exist yet.

ALTER TABLE pets
  ADD COLUMN emergency_vet_name  text,
  ADD COLUMN emergency_vet_phone text;

UPDATE pets SET
  emergency_vet_name  = NULLIF(btrim(regexp_replace(emergency_vet, '[0-9].*$', ''), E' ,;:-\t'), ''),
  emergency_vet_phone = NULLIF(btrim(substring(emergency_vet from '[0-9].*$')), '')
WHERE emergency_vet IS NOT NULL;

COMMENT ON COLUMN pets.emergency_vet_name IS
  'Emergency vet clinic name (PH-2). Split from the legacy emergency_vet free-text column in 022.';
COMMENT ON COLUMN pets.emergency_vet_phone IS
  'Emergency vet phone (PH-2). Split from the legacy emergency_vet free-text column in 022; formatted for display and tel: links in the app.';
COMMENT ON COLUMN pets.emergency_vet IS
  'DEPRECATED (022): superseded by emergency_vet_name + emergency_vet_phone. Retained read-only for rollback; drop in a later migration once the split is verified.';
