-- Local development data only. All names and figures are fictional.
insert into public.share_classes (id, code, name) values
  ('00000000-0000-4000-8000-000000000001', 'ORD', 'Ordinary shares');

insert into public.holders (id, name, kind, registry_ref) values
  ('00000000-0000-4000-8000-0000000000a1', 'Harbourview Family Trust', 'trust', 'TEST-0001'),
  ('00000000-0000-4000-8000-0000000000a2', 'Northshore Ventures Pty Ltd', 'company', 'TEST-0002'),
  ('00000000-0000-4000-8000-0000000000a3', 'Riverside Super Fund', 'super_fund', 'TEST-0003');

insert into public.holdings (holder_id, share_class_id, shares, as_at) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 1200000, '2025-06-30'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 1500000, '2026-06-30'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', 2500000, '2026-06-30'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000001', 6000000, '2026-06-30');
