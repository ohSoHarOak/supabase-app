-- 016: Services are born from a contract (W-5…W-8).
--
-- Until now a service was set up ad-hoc on the client profile and a contract
-- could optionally point at ONE of them (contracts.service_id, 005). W-6
-- inverts that: one contract carries MANY services, each with its own pets.
-- So the link moves to the child side, where 1:N belongs.
--
-- Nullable on purpose. Services created before this migration have no
-- originating contract, and W-13's pause/end flow still has to work on them.
-- A null contract_id means "predates W-5", not "invalid".
--
-- contracts.service_id (005) is deliberately left in place and unread rather
-- than dropped: Week 5/6 code still selects it, and dropping a column to make
-- a point isn't worth a migration that can't be rolled back cleanly.

ALTER TABLE services
  ADD COLUMN contract_id uuid REFERENCES contracts(id) ON DELETE SET NULL;

-- Read path: "show me everything this contract created", on the profile and
-- at the signing transition that activates them.
CREATE INDEX idx_services_contract ON services (contract_id);
