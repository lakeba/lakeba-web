-- A data room's test guest: the admins' own TEST link, made when the room is
-- created, to review the room exactly as a guest sees it before inviting
-- anyone. Opening it gives the link a new token and asks for the terms again;
-- no email is sent. It isn't counted as a guest.
alter table public.data_room_guests add column is_test boolean not null default false;
create unique index data_room_guests_one_test on public.data_room_guests (room_id) where is_test;
