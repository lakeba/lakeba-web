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

-- Phase 2–5 sample content (fictional).
insert into public.portal_settings (key, value) values
  ('liquidity', '{"title": "Secondary trading", "body": "Eligible investors can buy and sell Lakeba shares through a private secondary market during trading windows.", "url": "https://example.com/secondary-market", "label": "Visit the marketplace"}');

insert into public.announcements (title, body, link_url, link_label, tone) values
  ('FY26 annual report published', 'The audited FY26 annual report is now in your documents.', '/documents?category=report', 'Open documents', 'success');

insert into public.posts (slug, title, excerpt, body_md, published_at) values
  ('studio-becomes-an-os', 'The venture studio becomes an operating system', 'LakebaOS gives founders an AI team and a path to co-founding with Lakeba.', E'Lakeba has turned its studio playbook into **LakebaOS**.\n\nFounders describe an idea, an AI team builds the MVP, and Lakeba co-founds the best ventures.', now() - interval '3 days'),
  ('half-year-update', 'Half-year update for shareholders', 'Highlights from the first half and what comes next.', E'This is sample content for local development.\n\n- Revenue grew across the portfolio\n- Two new ventures entered the build phase', now() - interval '40 days');

insert into public.ventures (slug, name, tagline, stage, lakeba_stake, status, sort) values
  ('northwind-ai', 'Northwind AI', 'Document intelligence for regulated industries', 'Scale-up', 62.50, 'active', 1),
  ('brightlane', 'Brightlane', 'Shared-equity home ownership', 'Growth', 48.00, 'active', 2),
  ('kestrel-labs', 'Kestrel Labs', 'Built with LakebaOS: booking for solo barbers', 'MVP', 49.00, 'building', 3),
  ('harbourguard', 'Harbourguard', 'Mobile app protection', 'Exited', null, 'exited', 4);

insert into public.venture_updates (venture_id, title, body, happened_on)
select id, 'Signed a bank partnership', 'Sample milestone for local development.', current_date - 20 from public.ventures where slug = 'northwind-ai'
union all
select id, 'MVP built in 6 minutes of agent time', 'Sample milestone for local development.', current_date - 5 from public.ventures where slug = 'kestrel-labs';

insert into public.reference_prices (share_class_id, price, priced_on, source, note) values
  ('00000000-0000-4000-8000-000000000001', 0.42, '2024-06-30', 'valuation', 'Directors'' valuation'),
  ('00000000-0000-4000-8000-000000000001', 0.55, '2025-03-15', 'capital_raise', 'Series C round'),
  ('00000000-0000-4000-8000-000000000001', 0.61, '2025-11-20', 'secondary_trade', 'Last trading window'),
  ('00000000-0000-4000-8000-000000000001', 0.68, '2026-06-30', 'valuation', 'Directors'' valuation');

insert into public.meetings (id, title, kind, starts_at, location, livestream_url, proxy_deadline, status) values
  ('00000000-0000-4000-8000-0000000000b1', '2026 Annual General Meeting', 'agm', now() + interval '30 days', 'Sydney and online', 'https://example.com/live', now() + interval '28 days', 'open');

insert into public.resolutions (meeting_id, number, title, description, kind) values
  ('00000000-0000-4000-8000-0000000000b1', 1, 'Adopt the remuneration report', 'Non-binding advisory vote.', 'ordinary'),
  ('00000000-0000-4000-8000-0000000000b1', 2, 'Re-elect a director', 'Re-election of a non-executive director retiring by rotation.', 'ordinary'),
  ('00000000-0000-4000-8000-0000000000b1', 3, 'Approve the LakebaOS co-founding program', 'Approve the company taking up to 49% in ventures founded through LakebaOS.', 'special');
