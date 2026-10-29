-- The board assistant for every board (phase 5): Lakeba's board first, then
-- each venture's board when its company secretary is ready. A new permission
-- area "boardroom" (see, do), given per company, covers that company's board
-- meetings with the Observer, Lex and the decks, and their minutes, without
-- the rest of Legal (still Lakeba-only). A new built-in role "Company
-- secretary" has it. A switch per company turns the board assistant on;
-- Lakeba Group's is on.

alter table public.entities add column board_assistant boolean not null default false;
update public.entities set board_assistant = true where relationship = 'group';

insert into public.roles (key, name, description, builtin) values
  ('secretary', 'Company secretary', 'A company''s board meetings: the Observer, Lex and the decks it presents, the minutes and their signing. Given for one company.', true)
on conflict (key) do nothing;
insert into public.role_permissions (role_key, permission) values
  ('secretary', 'boardroom.view'), ('secretary', 'boardroom.do'), ('secretary', 'boardask.view'),
  ('admin', 'boardroom.view'), ('admin', 'boardroom.do'),
  ('legal', 'boardroom.view'), ('legal', 'boardroom.do')
on conflict do nothing;
