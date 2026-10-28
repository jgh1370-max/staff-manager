-- Preparation only. Applied by Netlify Database when enabled and deployed.
-- Original Netlify Blobs data remains untouched.
CREATE TABLE IF NOT EXISTS staff_events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  event_day date NOT NULL,
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_events_day_order_idx
  ON staff_events (event_day, occurred_at, id);
CREATE TABLE IF NOT EXISTS staff_current_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version bigint NOT NULL DEFAULT 0,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS staff_migration_status (
  migration_key text PRIMARY KEY,
  imported_events bigint NOT NULL DEFAULT 0,
  imported_at timestamptz,
  verified_at timestamptz
);
