-- ============================================================================
-- StudioFlow — WhatsApp integration
--
-- Adds the data layer for a WhatsApp "agent":
--   * a shared inbox (conversations + messages) so the owner can read customer
--     chats and see which staff member replied,
--   * an outbox that decouples "decide to notify" from "actually send", drained
--     by the /api/cron/whatsapp-dispatch endpoint (mirrors the Google sync cron),
--   * a trigger on bookings that enqueues owner/customer notifications for every
--     booking, cancellation and waitlist promotion — regardless of whether the
--     booking came from the web, the admin console, or a walk-in.
--
-- Why a trigger + outbox rather than hooking the server action: all booking
-- rules live in the book_session / cancel_booking RPCs, and the customer action
-- just calls the RPC and redirects. A trigger is the only place that reliably
-- sees every booking mutation, and the outbox gives us retries + dedup.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
do $$ begin
  create type wa_direction as enum ('inbound', 'outbound');
exception when duplicate_object then null; end $$;

do $$ begin
  -- queued/sent/delivered/read/failed track outbound delivery; received is the
  -- terminal state for an inbound message we stored.
  create type wa_msg_status as enum ('queued', 'sent', 'delivered', 'read', 'failed', 'received');
exception when duplicate_object then null; end $$;

do $$ begin
  create type outbox_status as enum ('queued', 'sent', 'failed', 'skipped');
exception when duplicate_object then null; end $$;

do $$ begin
  -- What kind of notification an outbox row represents. Drives which template
  -- the dispatcher uses and who it fans out to.
  create type outbox_kind as enum (
    'owner_booking_alert',
    'booking_confirmation',
    'booking_cancelled',
    'waitlist_promoted',
    'customer_reminder',
    'instructor_reminder'
  );
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Per-studio owner override: where booking alerts for this studio should go.
-- Falls back to env WHATSAPP_OWNER_PHONES when null (resolved at send time).
-- ----------------------------------------------------------------------------
alter table studios add column if not exists notify_phone text;

-- ----------------------------------------------------------------------------
-- wa_conversations — one row per WhatsApp phone number we talk to.
-- last_inbound_at drives the 24h customer-service window: free-form replies are
-- only allowed within 24h of the customer's last inbound message; outside it,
-- sends must use an approved template.
-- ----------------------------------------------------------------------------
create table if not exists wa_conversations (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid references customers(id) on delete set null,
  wa_phone        text not null unique,
  display_name    text,
  status          text not null default 'open',  -- 'open' | 'closed'
  assigned_to     uuid references profiles(id) on delete set null,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  unread_count    int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists wa_conversations_last_message_idx
  on wa_conversations (last_message_at desc nulls last);
create index if not exists wa_conversations_customer_idx
  on wa_conversations (customer_id);

drop trigger if exists trg_wa_conversations_updated on wa_conversations;
create trigger trg_wa_conversations_updated
  before update on wa_conversations
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- wa_messages — every inbound and outbound message in a conversation.
-- wa_message_id is the provider's id, used to dedup webhook re-deliveries.
-- sent_by records which staff member sent an outbound message (the "see what
-- staff reply" requirement). ai_drafted flags replies that started as an AI draft.
-- ----------------------------------------------------------------------------
create table if not exists wa_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references wa_conversations(id) on delete cascade,
  direction       wa_direction not null,
  wa_message_id   text unique,
  body            text,
  template_name   text,
  status          wa_msg_status not null default 'queued',
  sent_by         uuid references profiles(id) on delete set null,
  ai_drafted      boolean not null default false,
  error           text,
  created_at      timestamptz not null default now()
);

create index if not exists wa_messages_conversation_idx
  on wa_messages (conversation_id, created_at);

-- ----------------------------------------------------------------------------
-- message_outbox — durable queue of notifications to send. The dispatcher cron
-- claims queued rows whose scheduled_for has passed, sends them, and flips the
-- status. dedup_key makes enqueue idempotent so a re-fired trigger or a re-run
-- reminder scan never double-sends.
--
-- to_phone is null for owner alerts: the dispatcher fans those out to the
-- studio's notify_phone (or env WHATSAPP_OWNER_PHONES). payload carries the
-- display fields (names, times) so the dispatcher needn't re-query.
-- ----------------------------------------------------------------------------
create table if not exists message_outbox (
  id            uuid primary key default gen_random_uuid(),
  kind          outbox_kind not null,
  to_phone      text,
  studio_id     uuid references studios(id) on delete set null,
  payload       jsonb not null default '{}'::jsonb,
  template_name text,
  scheduled_for timestamptz not null default now(),
  status        outbox_status not null default 'queued',
  attempts      int not null default 0,
  last_error    text,
  dedup_key     text not null unique,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);

create index if not exists message_outbox_due_idx
  on message_outbox (status, scheduled_for);

-- ----------------------------------------------------------------------------
-- Booking notification trigger
--
-- Fires after a booking is inserted or its status changes. Resolves the
-- customer's phone (profiles.phone, else customers.phone for walk-ins) and the
-- session context, then enqueues the right notifications:
--   * new seat               -> booking_confirmation (customer) + owner alert
--   * waitlisted -> booked   -> waitlist_promoted   (customer) + owner alert
--   * booked/waitlisted -> cancelled -> booking_cancelled (customer) + owner alert
-- Other transitions (attended/no_show) are ignored.
-- ----------------------------------------------------------------------------
create or replace function enqueue_booking_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cust_phone   text;
  v_cust_name    text;
  v_class_name   text;
  v_studio_id    uuid;
  v_studio_name  text;
  v_timezone     text;
  v_starts_at    timestamptz;
  v_capacity     int;
  v_booked_count int;
  v_payload      jsonb;
  v_event        text;  -- 'confirm' | 'promote' | 'cancel'
begin
  -- Decide what happened. On UPDATE, only act when status actually changed.
  if tg_op = 'INSERT' then
    if new.status = 'booked' then
      v_event := 'confirm';
    elsif new.status = 'waitlisted' then
      v_event := null;  -- joining the waitlist sends no customer message
    else
      v_event := null;
    end if;
  else
    if new.status = old.status then
      return new;
    end if;
    if new.status = 'booked' and old.status = 'waitlisted' then
      v_event := 'promote';
    elsif new.status = 'booked' then
      v_event := 'confirm';
    elsif new.status = 'cancelled' and old.status in ('booked', 'waitlisted') then
      v_event := 'cancel';
    else
      v_event := null;
    end if;
  end if;

  -- Owner alerts fire for booked/cancelled even when there's no customer event,
  -- so compute context whenever there is anything worth reporting.
  if v_event is null then
    return new;
  end if;

  select coalesce(p.phone, c.phone), coalesce(p.full_name, c.name)
    into v_cust_phone, v_cust_name
  from customers c
  left join profiles p on p.id = c.profile_id
  where c.id = new.customer_id;

  select s.starts_at, s.capacity, s.studio_id, st.name, st.timezone, ct.name
    into v_starts_at, v_capacity, v_studio_id, v_studio_name, v_timezone, v_class_name
  from sessions s
  join studios st on st.id = s.studio_id
  join class_types ct on ct.id = s.class_type_id
  where s.id = new.session_id;

  select count(*) into v_booked_count
  from bookings where session_id = new.session_id and status = 'booked';

  v_payload := jsonb_build_object(
    'booking_id',   new.id,
    'session_id',   new.session_id,
    'customer_name', coalesce(v_cust_name, 'Member'),
    'class_name',    coalesce(v_class_name, 'class'),
    'studio_name',   coalesce(v_studio_name, 'the studio'),
    'timezone',      coalesce(v_timezone, 'Asia/Ho_Chi_Minh'),
    'starts_at',     v_starts_at,
    'capacity',      v_capacity,
    'booked_count',  v_booked_count,
    'status',        new.status
  );

  -- Customer-facing message (only if we have a phone to send to).
  if v_cust_phone is not null then
    if v_event = 'confirm' then
      insert into message_outbox (kind, to_phone, studio_id, payload, dedup_key)
      values ('booking_confirmation', v_cust_phone, v_studio_id, v_payload,
              'booking_confirmation:' || new.id::text)
      on conflict (dedup_key) do nothing;
    elsif v_event = 'promote' then
      insert into message_outbox (kind, to_phone, studio_id, payload, dedup_key)
      values ('waitlist_promoted', v_cust_phone, v_studio_id, v_payload,
              'waitlist_promoted:' || new.id::text)
      on conflict (dedup_key) do nothing;
    elsif v_event = 'cancel' then
      insert into message_outbox (kind, to_phone, studio_id, payload, dedup_key)
      values ('booking_cancelled', v_cust_phone, v_studio_id, v_payload,
              'booking_cancelled:' || new.id::text || ':' || new.cancelled_at::text)
      on conflict (dedup_key) do nothing;
    end if;
  end if;

  -- Owner alert (to_phone null -> dispatcher fans out to configured numbers).
  insert into message_outbox (kind, to_phone, studio_id, payload, dedup_key)
  values ('owner_booking_alert', null, v_studio_id, v_payload,
          'owner_booking_alert:' || new.id::text || ':' || v_event)
  on conflict (dedup_key) do nothing;

  return new;
end $$;

drop trigger if exists trg_booking_notifications on bookings;
create trigger trg_booking_notifications
  after insert or update on bookings
  for each row execute function enqueue_booking_notifications();

-- ----------------------------------------------------------------------------
-- Row-Level Security — admin-only. The dispatcher + webhook use the service-role
-- client, which bypasses RLS, so no policy is needed for them.
-- ----------------------------------------------------------------------------
alter table wa_conversations enable row level security;
alter table wa_messages      enable row level security;
alter table message_outbox   enable row level security;

do $$ begin
  create policy "wa_conversations admin all" on wa_conversations
    for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "wa_messages admin all" on wa_messages
    for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "message_outbox admin all" on message_outbox
    for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;
