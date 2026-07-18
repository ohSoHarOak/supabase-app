-- 018: Founder feedback round 3 (2026-07-18) — R-8 and R-9.
--
-- 1. 'drop_in' service type (R-8): a drop-in visit is not a walk. It is a
--    short check-in — feed, water, litter, medication, let out — and walkers
--    price it separately from a walk. It rides the existing per_visit cadence
--    and needs no other machinery. (New enum value is only ADDed here, never
--    used in this migration — required for ALTER TYPE inside a transaction.)
--
-- 2. pets.species (R-9): the product could not tell a cat from a dog. Every
--    pet field (breed, weight, vet, behavior notes) applies to both, so this
--    is a label, not a fork in the data model — but a drop-in visit for a cat
--    is one of the most common non-dog jobs a walker takes, and the contract
--    and walk report both read wrong when a cat is described as a dog.
--
--    Deliberately NOT an enum: species is exactly the column that grows
--    (rabbit, bird, reptile, horse) and every addition to a Postgres enum is
--    a migration. Free text with a CHECK-free default keeps the UI's dropdown
--    authoritative without a migration per animal. Defaults to 'dog' because
--    every existing row was created by a dog walker under a dog-only product;
--    NULL would claim we don't know, and we do.

ALTER TYPE service_type_enum ADD VALUE IF NOT EXISTS 'drop_in';

ALTER TABLE pets
  ADD COLUMN species text NOT NULL DEFAULT 'dog';

COMMENT ON COLUMN pets.species IS
  'dog | cat | other (free text, not an enum — the UI dropdown is authoritative and new species must not cost a migration). Existing rows backfilled to dog: they were created under a dog-only product.';
