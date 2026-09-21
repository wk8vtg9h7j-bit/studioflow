-- ============================================================================
-- StudioFlow — extend the recurring class schedule by 5 months.
--
-- RUN THIS IN THE SUPABASE SQL EDITOR AGAINST PRODUCTION. Read the notes first.
--
-- What it does
-- ------------
-- The schedule has no recurrence model — there is no series table, only
-- individual `sessions` rows. "Extending" therefore means generating more rows.
--
-- Each recurring slot is identified by (studio, class type, room, weekday,
-- local time of day). For every slot that was still running at the end of the
-- current schedule, the script takes its LAST occurrence as a template and
-- repeats it weekly until the target end date. Instructor, capacity, title,
-- room, notes and the class duration are all carried over from that template.
--
-- Safety properties
-- -----------------
--   * Idempotent. Re-running it inserts nothing new — every row is guarded by
--     a NOT EXISTS check on (studio, class type, start time, room). Note this
--     is a predicate, not ON CONFLICT: `sessions` has no unique constraint
--     other than its primary key, so ON CONFLICT has nothing to target.
--   * Insert-only. No existing row is updated or deleted. Bookings, payroll
--     and the credit ledger are untouched.
--   * Does not reference `filler_seats`. Migration 0009 is not applied in
--     production; the column may not exist there. It has `not null default 0`,
--     so simply omitting it works on either database.
--   * Does not copy `google_event_id`. That is the id of an already-synced
--     Google Calendar event — duplicating it across new rows would corrupt
--     calendar sync. New rows get NULL and sync fresh.
--   * Wall-clock safe. Weeks are added in each studio's own timezone
--     (`studios.timezone`), so a 09:00 class stays a 09:00 class.
--
-- Slots that already stopped are NOT resurrected: a slot only qualifies if its
-- last occurrence falls within 42 days of the end of the schedule. A class type
-- that was retired months ago stays retired.
--
-- Why the target date is a fixed literal
-- --------------------------------------
-- An earlier version derived the horizon from `max(starts_at) where status =
-- 'scheduled'`. That is wrong once past classes get marked `completed`: the
-- horizon collapses to NULL or a stale date, every downstream CTE returns zero
-- rows, and the insert becomes a silent no-op. Slot detection has the same
-- problem, so both now read `status in ('scheduled','completed')` and the end
-- date is pinned explicitly in `params.target_end`. Change that literal if you
-- want a different end date.
--
-- How to run
-- ----------
--   0. Run STEP 0 to see where the schedule actually ends, per status.
--   1. Run STEP 1. It writes nothing. Check the dates and the row count.
--      `recurring_slots` must not be 0 — if it is, stop; nothing below works.
--   2. Run STEP 1b to skim the first 40 rows and confirm the times look right.
--   3. If it looks right, run STEP 2. The Supabase SQL editor does not hold an
--      interactive transaction across submissions, so there is deliberately no
--      BEGIN/COMMIT here — the insert commits when it runs.
--   4. Run STEP 3 to confirm the new end date.
--
-- Assumptions worth confirming before you run it
-- ----------------------------------------------
--   * Holidays are not skipped. Tet and public holidays will get classes
--     generated on them; cancel those individually afterwards.
--   * The current instructor for each slot is assumed to keep teaching it.
--   * Capacity is copied from the last occurrence, not from
--     `class_types.default_capacity`.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- STEP 0 — DIAGNOSTIC. Where does the schedule actually end?
-- ----------------------------------------------------------------------------
select status,
       count(*)       as rows,
       min(starts_at) as first_class,
       max(starts_at) as last_class
from sessions
group by status
order by status;


-- ----------------------------------------------------------------------------
-- STEP 1 — PREVIEW. Writes nothing. Run this first.
-- ----------------------------------------------------------------------------
with params as (
  select timestamptz '2027-02-19 23:59:59+07' as target_end,
         interval '42 days'                   as active_window
),
anchor as (
  select max(starts_at) as last_class
  from sessions
  where status in ('scheduled','completed')
),
slots as (
  select distinct on (
           s.studio_id,
           s.class_type_id,
           s.room,
           extract(dow from s.starts_at at time zone st.timezone),
           (s.starts_at at time zone st.timezone)::time
         )
         s.studio_id, s.class_type_id, s.instructor_id, s.title,
         s.starts_at, s.ends_at, s.capacity, s.room, s.notes,
         st.timezone
  from sessions s
  join studios st on st.id = s.studio_id
  cross join anchor a
  cross join params p
  where s.status in ('scheduled','completed')
    and s.starts_at >= a.last_class - p.active_window
  order by s.studio_id,
           s.class_type_id,
           s.room,
           extract(dow from s.starts_at at time zone st.timezone),
           (s.starts_at at time zone st.timezone)::time,
           s.starts_at desc
),
projected as (
  select
    sl.studio_id,
    sl.class_type_id,
    sl.instructor_id,
    sl.title,
    sl.capacity,
    sl.room,
    sl.notes,
    sl.timezone,
    ((sl.starts_at at time zone sl.timezone) + (g.n * interval '7 days'))
      at time zone sl.timezone                                   as starts_at,
    ((sl.starts_at at time zone sl.timezone) + (g.n * interval '7 days'))
      at time zone sl.timezone + (sl.ends_at - sl.starts_at)     as ends_at
  from slots sl
  cross join params p
  cross join lateral generate_series(
    1,
    greatest(
      0,
      floor(extract(epoch from (p.target_end - sl.starts_at)) / 604800)::int
    )
  ) as g(n)
),
new_rows as (
  select pr.*
  from projected pr
  where not exists (
    select 1
    from sessions x
    where x.studio_id     = pr.studio_id
      and x.class_type_id = pr.class_type_id
      and x.starts_at     = pr.starts_at
      and x.room is not distinct from pr.room
  )
)
select
  (select last_class from anchor)  as schedule_ends_now,
  (select target_end from params)  as schedule_ends_after,
  (select count(*) from slots)     as recurring_slots,
  (select count(*) from new_rows)  as rows_to_insert;


-- ----------------------------------------------------------------------------
-- STEP 1b — SAMPLE. Writes nothing. First 40 rows that would be created.
-- ----------------------------------------------------------------------------
with params as (
  select timestamptz '2027-02-19 23:59:59+07' as target_end,
         interval '42 days'                   as active_window
),
anchor as (
  select max(starts_at) as last_class
  from sessions
  where status in ('scheduled','completed')
),
slots as (
  select distinct on (
           s.studio_id,
           s.class_type_id,
           s.room,
           extract(dow from s.starts_at at time zone st.timezone),
           (s.starts_at at time zone st.timezone)::time
         )
         s.studio_id, s.class_type_id, s.instructor_id, s.title,
         s.starts_at, s.ends_at, s.capacity, s.room, s.notes,
         st.timezone
  from sessions s
  join studios st on st.id = s.studio_id
  cross join anchor a
  cross join params p
  where s.status in ('scheduled','completed')
    and s.starts_at >= a.last_class - p.active_window
  order by s.studio_id,
           s.class_type_id,
           s.room,
           extract(dow from s.starts_at at time zone st.timezone),
           (s.starts_at at time zone st.timezone)::time,
           s.starts_at desc
),
projected as (
  select
    sl.studio_id, sl.class_type_id, sl.capacity, sl.room, sl.timezone,
    ((sl.starts_at at time zone sl.timezone) + (g.n * interval '7 days'))
      at time zone sl.timezone                                   as starts_at
  from slots sl
  cross join params p
  cross join lateral generate_series(
    1,
    greatest(
      0,
      floor(extract(epoch from (p.target_end - sl.starts_at)) / 604800)::int
    )
  ) as g(n)
),
new_rows as (
  select pr.*
  from projected pr
  where not exists (
    select 1
    from sessions x
    where x.studio_id     = pr.studio_id
      and x.class_type_id = pr.class_type_id
      and x.starts_at     = pr.starts_at
      and x.room is not distinct from pr.room
  )
)
select ct.name as class_type,
       st.name as studio,
       to_char(n.starts_at at time zone n.timezone,
               'Dy DD Mon YYYY HH24:MI') as local_time,
       n.capacity,
       n.room
from new_rows n
join class_types ct on ct.id = n.class_type_id
join studios     st on st.id = n.studio_id
order by n.starts_at
limit 40;


-- ----------------------------------------------------------------------------
-- STEP 2 — INSERT. Only run after STEP 1 looks correct.
--
-- No BEGIN/COMMIT: the Supabase SQL editor does not keep a transaction open
-- between submissions, so a pasted `rollback;` would not undo anything. The
-- insert commits when it runs. The NOT EXISTS guard makes it safe to re-run.
-- ----------------------------------------------------------------------------
with params as (
  select timestamptz '2027-02-19 23:59:59+07' as target_end,
         interval '42 days'                   as active_window
),
anchor as (
  select max(starts_at) as last_class
  from sessions
  where status in ('scheduled','completed')
),
slots as (
  select distinct on (
           s.studio_id,
           s.class_type_id,
           s.room,
           extract(dow from s.starts_at at time zone st.timezone),
           (s.starts_at at time zone st.timezone)::time
         )
         s.studio_id, s.class_type_id, s.instructor_id, s.title,
         s.starts_at, s.ends_at, s.capacity, s.room, s.notes,
         st.timezone
  from sessions s
  join studios st on st.id = s.studio_id
  cross join anchor a
  cross join params p
  where s.status in ('scheduled','completed')
    and s.starts_at >= a.last_class - p.active_window
  order by s.studio_id,
           s.class_type_id,
           s.room,
           extract(dow from s.starts_at at time zone st.timezone),
           (s.starts_at at time zone st.timezone)::time,
           s.starts_at desc
),
projected as (
  select
    sl.studio_id,
    sl.class_type_id,
    sl.instructor_id,
    sl.title,
    sl.capacity,
    sl.room,
    sl.notes,
    ((sl.starts_at at time zone sl.timezone) + (g.n * interval '7 days'))
      at time zone sl.timezone                                   as starts_at,
    ((sl.starts_at at time zone sl.timezone) + (g.n * interval '7 days'))
      at time zone sl.timezone + (sl.ends_at - sl.starts_at)     as ends_at
  from slots sl
  cross join params p
  cross join lateral generate_series(
    1,
    greatest(
      0,
      floor(extract(epoch from (p.target_end - sl.starts_at)) / 604800)::int
    )
  ) as g(n)
)
insert into sessions (
  studio_id, class_type_id, instructor_id, title,
  starts_at, ends_at, capacity, room, notes, status
)
select
  pr.studio_id, pr.class_type_id, pr.instructor_id, pr.title,
  pr.starts_at, pr.ends_at, pr.capacity, pr.room, pr.notes, 'scheduled'
from projected pr
where not exists (
  select 1
  from sessions x
  where x.studio_id     = pr.studio_id
    and x.class_type_id = pr.class_type_id
    and x.starts_at     = pr.starts_at
    and x.room is not distinct from pr.room
);


-- ----------------------------------------------------------------------------
-- STEP 3 — VERIFY.
-- ----------------------------------------------------------------------------
select
  max(starts_at)                                      as schedule_ends,
  count(*) filter (where starts_at > now())           as future_classes
from sessions
where status = 'scheduled';
