-- Words the Observer's speech to text should listen for at a company's board
-- meetings (product names, people's names, jargon), on top of the group's
-- company names and the meeting's attendees, which it always gets. Set by
-- Lakeba on the company page, with the board assistant switch.

alter table public.entities add column speech_terms text[] not null default '{}';
