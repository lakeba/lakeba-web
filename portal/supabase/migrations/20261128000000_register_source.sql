-- A company whose holdings come from the company secretary's register of
-- members: its holdings and official shares on issue are set by importing the
-- register (Admin → Import data → Register of members). The workbook import
-- then only checks them, and changes made on screen ask for a reason.
alter table public.entities add column holdings_from_register boolean not null default false;
