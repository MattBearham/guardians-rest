-- Guardian's Rest Ledger: improvement voting.
-- Run once in Supabase > SQL Editor, after 1-setup.sql and 2-ledger-data.sql. Safe to re-run.
--
-- Improvements stay hidden from players until the guild levels up and they're on the ballot.
-- Each player then has one token (a row in votes). An option is built as soon as it holds a
-- majority of the players' tokens, or once every token is down and it leads outright.
-- Players can't write picks directly any more; the GM still can (as an override).

-- ---------- helpers ----------
create or replace function public.ledger_num(v jsonb, dflt numeric) returns numeric
language sql immutable as $$
  select case
    when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric
    when jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^\s*-?\d+(\.\d+)?\s*$' then trim(v #>> '{}')::numeric
    else dflt end;
$$;

create or replace function public.ledger_is_gm() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where user_id = auth.uid() and role = 'gm');
$$;

-- Guild level from completed quest XP plus the GM's adjustment (same ladder as index.html).
create or replace function public.ledger_level() returns int
language sql stable security definer set search_path = public as $$
  select greatest(1, count(*))::int
  from unnest(array[0, 100, 500, 1400, 2600, 4100, 5900, 8000, 10400, 13100, 16100,
                    19400, 23000, 26900, 31100, 35600, 40400, 45500, 50900, 56600]) as t(threshold)
  where threshold <= (
    coalesce((select sum(ledger_num(data->'xp', 0)) from docs
              where collection = 'quests' and data->>'status' = 'completed'), 0)
    + coalesce((select ledger_num(data->'bonusXp', 0) from docs
                where collection = 'guild' and id = 'state'), 0));
$$;

-- The open ballot: the lowest earned level with no pick yet, and the improvements that can be
-- built for it. Returns one row with a null option_id if a level is open but nothing qualifies,
-- and no rows if no level is open.
create or replace function public.ledger_ballot()
returns table (ballot_level int, option_id text)
language plpgsql stable security definer set search_path = public as $$
declare
  lv int := ledger_level();
  slot int;
  has_home boolean;
  home_site text;
begin
  select min(g) into slot from generate_series(2, lv) as g
  where not exists (select 1 from docs p where p.collection = 'picks' and p.id = 'level-' || g);
  if slot is null then return; end if;

  select true, i.data->>'site' into has_home, home_site
  from docs i
  where i.collection = 'improvements' and i.data->'home' = 'true'::jsonb
    and exists (select 1 from docs p where p.collection = 'picks' and p.data->>'improvement' = i.id)
  limit 1;
  has_home := coalesce(has_home, false);

  return query
  select slot, i.id from docs i
  where i.collection = 'improvements'
    and not exists (select 1 from docs p where p.collection = 'picks' and p.data->>'improvement' = i.id)
    and case when not has_home then i.data->'home' = 'true'::jsonb
        else i.data->'home' is distinct from 'true'::jsonb
         and ledger_num(i.data->'minLevel', 1) <= lv
         and (home_site is null
              or coalesce(jsonb_typeof(i.data->'sites'), '') <> 'array'
              or jsonb_array_length(i.data->'sites') = 0
              or i.data->'sites' ? home_site)
        end
  order by i.id;
  if not found then return query select slot, null::text; end if;
end $$;

create or replace function public.ledger_visible_improvements() returns setof text
language sql stable security definer set search_path = public as $$
  select data->>'improvement' from docs where collection = 'picks' and data->>'improvement' is not null
  union
  select option_id from ledger_ballot() where option_id is not null;
$$;

-- ---------- who sees improvements, who writes picks ----------
-- Restrictive policies narrow the existing ones without replacing them.
drop policy if exists "improvements: players see built and on the ballot" on public.docs;
create policy "improvements: players see built and on the ballot" on public.docs
  as restrictive for select
  using (collection <> 'improvements' or ledger_is_gm() or id in (select ledger_visible_improvements()));

drop policy if exists "picks: GM only (insert)" on public.docs;
create policy "picks: GM only (insert)" on public.docs
  as restrictive for insert with check (collection <> 'picks' or ledger_is_gm());
drop policy if exists "picks: GM only (update)" on public.docs;
create policy "picks: GM only (update)" on public.docs
  as restrictive for update using (collection <> 'picks' or ledger_is_gm()) with check (collection <> 'picks' or ledger_is_gm());
drop policy if exists "picks: GM only (delete)" on public.docs;
create policy "picks: GM only (delete)" on public.docs
  as restrictive for delete using (collection <> 'picks' or ledger_is_gm());

-- ---------- votes ----------
create table if not exists public.votes (
  level int not null,
  user_id uuid not null references auth.users on delete cascade,
  improvement text not null,
  at timestamptz not null default now(),
  primary key (level, user_id)
);
alter table public.votes enable row level security;
revoke all on public.votes from anon, authenticated;
grant select on public.votes to authenticated;
drop policy if exists "votes: members read" on public.votes;
create policy "votes: members read" on public.votes for select to authenticated
  using (exists (select 1 from members m where m.user_id = auth.uid()));

-- Place, move (choice = an improvement id) or take back (choice = null) your token.
-- Returns the improvement id if this vote decided the ballot, otherwise null.
create or replace function public.ledger_vote(choice text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := auth.uid();
  v_slot int;
  v_players int;
  v_cast int;
  v_counts int[];
  v_top text;
begin
  if v_me is null or not exists (select 1 from members m where m.user_id = v_me and m.role <> 'gm') then
    raise exception 'Only players have tokens' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('ledger_vote'));

  select min(b.ballot_level) into v_slot from ledger_ballot() b where b.option_id is not null;
  if v_slot is null then raise exception 'No vote is open'; end if;

  if choice is null then
    delete from votes v where v.level = v_slot and v.user_id = v_me;
  elsif not exists (select 1 from ledger_ballot() b where b.option_id = choice) then
    raise exception 'That improvement is not on the ballot';
  else
    insert into votes (level, user_id, improvement) values (v_slot, v_me, choice)
    on conflict (level, user_id) do update set improvement = excluded.improvement, at = now();
  end if;

  select count(*) into v_players from members m where m.role <> 'gm';
  select count(*) into v_cast from votes v join members m on m.user_id = v.user_id and m.role <> 'gm'
  where v.level = v_slot;
  select array_agg(n order by n desc) into v_counts from (
    select count(*)::int as n from votes v join members m on m.user_id = v.user_id and m.role <> 'gm'
    where v.level = v_slot group by v.improvement) t;

  if v_counts[1] * 2 > v_players or (v_cast >= v_players and v_counts[1] > coalesce(v_counts[2], 0)) then
    select v.improvement into v_top from votes v join members m on m.user_id = v.user_id and m.role <> 'gm'
    where v.level = v_slot group by v.improvement having count(*) = v_counts[1];
    insert into docs (collection, id, data) values ('picks', 'level-' || v_slot, jsonb_build_object(
      'improvement', v_top, 'by', null, 'at', floor(extract(epoch from now()) * 1000)::bigint,
      'votes', (select jsonb_object_agg(v.user_id::text, v.improvement) from votes v where v.level = v_slot)))
    on conflict (collection, id) do nothing;
    return v_top;
  end if;
  return null;
end $$;
revoke execute on function public.ledger_vote(text) from public, anon;
grant execute on function public.ledger_vote(text) to authenticated;

-- When the GM undoes a pick, clear that level's tokens so the vote starts fresh.
create or replace function public.ledger_pick_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.collection = 'picks' and old.id ~ '^level-\d+$' then
    delete from votes where level = substring(old.id from 7)::int;
  end if;
  return old;
end $$;
drop trigger if exists ledger_pick_deleted on public.docs;
create trigger ledger_pick_deleted after delete on public.docs
  for each row execute function public.ledger_pick_deleted();

-- Live updates for tokens.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'votes') then
    alter publication supabase_realtime add table public.votes;
  end if;
end $$;
