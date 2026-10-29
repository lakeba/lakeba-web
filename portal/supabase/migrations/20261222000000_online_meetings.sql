-- Lex in online meetings (Teams, Zoom, Google Meet, Webex): the company
-- secretary sends Lex to the meeting's link; a meeting bot (Recall.ai) joins
-- as "Lex", shows the portal's Lex page as its camera, hears the call through
-- it and speaks into it. The bot's browser connects like a boardroom tablet,
-- with its own one-meeting pass (board_tablets.kind = 'bot').

alter table public.board_tablets add column kind text not null default 'tablet' check (kind in ('tablet', 'bot'));

-- {bot_id, meeting_url, platform, status, status_at, sent_by, sent_at, error}: the bot sent to this meeting.
alter table public.board_meetings add column online_bot jsonb;
create index board_meetings_online_bot_idx on public.board_meetings ((online_bot->>'bot_id')) where online_bot is not null;
