-- 025: Business logo for professional profiles.
-- The profile photo (a headshot of the person) already exists as
-- profile_photo_url in 002 and is required at onboarding. The business logo is
-- separate and OPTIONAL — many solo walkers don't have one yet.

ALTER TABLE professional_profiles
  ADD COLUMN business_logo_url text;
