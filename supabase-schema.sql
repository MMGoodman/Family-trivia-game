-- ============================================================
--  משחק טרוויה משפחתי — סכימת בסיס הנתונים
--  להדביק ב-Supabase → SQL Editor → Run
-- ============================================================

-- ---------- טבלאות ----------

-- משחק = אירוע שלם ("חופשת קיץ 2026", "מסיבת חנוכה")
create table if not exists public.games (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users(id) on delete cascade,
  name                text not null,
  description         text,
  -- מצב חי, מה שמסך ההקרנה מקשיב לו
  current_question_id uuid,
  phase               text not null default 'idle',  -- idle | question | revealed | finished
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ישות מצביעה: קבוצה/משפחה או שחקן בודד — אותו דבר מבחינת המערכת
create table if not exists public.groups (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  name         text not null,
  color        text,
  position     int  not null default 0,
  -- התאמה ידנית של ניקוד (בונוס/עונש), הכל השאר מחושב מההצבעות
  adjustment   int  not null default 0,
  adjust_note  text,
  created_at   timestamptz not null default now()
);

create table if not exists public.questions (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  text        text,
  image_path  text,
  weight      int  not null default 1 check (weight between 1 and 5),
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.answers (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.questions(id) on delete cascade,
  text         text not null,
  is_correct   boolean not null default false,
  position     int  not null default 0
);

-- הרישום: מי ענה מה. הניקוד נגזר מכאן ולא נשמר לעולם.
create table if not exists public.votes (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.questions(id) on delete cascade,
  group_id     uuid not null references public.groups(id) on delete cascade,
  answer_id    uuid references public.answers(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (question_id, group_id)   -- קבוצה מצביעה פעם אחת לשאלה; תיקון = עדכון
);

create index if not exists idx_groups_game    on public.groups(game_id);
create index if not exists idx_questions_game on public.questions(game_id);
create index if not exists idx_answers_q      on public.answers(question_id);
create index if not exists idx_votes_q        on public.votes(question_id);
create index if not exists idx_votes_group    on public.votes(group_id);

-- ---------- Row Level Security ----------
-- כל אחת מהטבלאות נגישה רק לבעלים של המשחק שאליו היא שייכת.

alter table public.games     enable row level security;
alter table public.groups    enable row level security;
alter table public.questions enable row level security;
alter table public.answers   enable row level security;
alter table public.votes     enable row level security;

drop policy if exists games_owner on public.games;
create policy games_owner on public.games
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists groups_owner on public.groups;
create policy groups_owner on public.groups
  for all to authenticated
  using (exists (select 1 from public.games g
                 where g.id = groups.game_id and g.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.games g
                 where g.id = groups.game_id and g.owner_id = (select auth.uid())));

drop policy if exists questions_owner on public.questions;
create policy questions_owner on public.questions
  for all to authenticated
  using (exists (select 1 from public.games g
                 where g.id = questions.game_id and g.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.games g
                 where g.id = questions.game_id and g.owner_id = (select auth.uid())));

drop policy if exists answers_owner on public.answers;
create policy answers_owner on public.answers
  for all to authenticated
  using (exists (select 1 from public.questions q
                 join public.games g on g.id = q.game_id
                 where q.id = answers.question_id and g.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.questions q
                 join public.games g on g.id = q.game_id
                 where q.id = answers.question_id and g.owner_id = (select auth.uid())));

drop policy if exists votes_owner on public.votes;
create policy votes_owner on public.votes
  for all to authenticated
  using (exists (select 1 from public.questions q
                 join public.games g on g.id = q.game_id
                 where q.id = votes.question_id and g.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.questions q
                 join public.games g on g.id = q.game_id
                 where q.id = votes.question_id and g.owner_id = (select auth.uid())));

-- ---------- סנכרון חי (מסך הקרנה) ----------

alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.votes;
alter publication supabase_realtime add table public.groups;
alter publication supabase_realtime add table public.questions;
alter publication supabase_realtime add table public.answers;

-- ---------- אחסון תמונות ----------

insert into storage.buckets (id, name, public)
values ('question-images', 'question-images', true)
on conflict (id) do nothing;

drop policy if exists qimg_read on storage.objects;
create policy qimg_read on storage.objects
  for select using (bucket_id = 'question-images');

drop policy if exists qimg_write on storage.objects;
create policy qimg_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'question-images');

drop policy if exists qimg_delete on storage.objects;
create policy qimg_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'question-images' and owner = (select auth.uid()));
