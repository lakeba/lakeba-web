-- "Getting started" on Admin → Overview: "Hide for now" keeps the card away until this time, for that person on
-- every device. Written by the portal's server only (service role).
alter table public.profiles add column if not exists getting_started_hidden_until timestamptz;
