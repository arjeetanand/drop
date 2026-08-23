create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._-]{2,24}$'),
  display_name text not null default 'Dear friend',
  bio text not null default '',
  letters_sent integer not null default 0 check (letters_sent >= 0),
  letters_received integer not null default 0 check (letters_received >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.letters (
  id text primary key,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete set null,
  sender_display_name text,
  recipient_username text,
  recipient_name text,
  subject text not null default 'Untitled Letter',
  content text not null default '',
  teaser jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'sealed', 'dispatched', 'delivered')),
  seal_id text,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.letter_events (
  id uuid primary key default gen_random_uuid(),
  letter_id text not null references public.letters(id) on delete cascade,
  event_key text not null,
  status text not null,
  note text not null default '',
  is_done boolean not null default false,
  is_current boolean not null default false,
  occurred_at timestamptz not null default now(),
  unique(letter_id, event_key)
);

create table if not exists public.journey_notes (
  id uuid primary key default gen_random_uuid(),
  letter_id text not null references public.letters(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists letters_sender_id_idx on public.letters(sender_id);
create index if not exists letters_status_idx on public.letters(status);
create index if not exists letter_events_letter_id_occurred_at_idx on public.letter_events(letter_id, occurred_at);
create index if not exists journey_notes_letter_id_created_at_idx on public.journey_notes(letter_id, created_at);

alter table public.letters add column if not exists recipient_id uuid references public.profiles(id) on delete set null;
alter table public.letter_events add column if not exists is_done boolean not null default false;
alter table public.letter_events add column if not exists is_current boolean not null default false;

alter table public.profiles enable row level security;
alter table public.letters enable row level security;
alter table public.letter_events enable row level security;
alter table public.journey_notes enable row level security;

create policy "Profiles are publicly readable" on public.profiles for select using (true);
create policy "Users can create their profile" on public.profiles for insert with check (auth.uid() = id);
create policy "Users can update their profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "Users can read their letters" on public.letters for select using (auth.uid() = sender_id or auth.uid() = recipient_id);
create policy "Users can create their letters" on public.letters for insert with check (auth.uid() = sender_id);
create policy "Users can update their letters" on public.letters for update using (auth.uid() = sender_id) with check (auth.uid() = sender_id);
create policy "Users can delete their letters" on public.letters for delete using (auth.uid() = sender_id);

create policy "Users can read their letter events" on public.letter_events for select using (
  exists (select 1 from public.letters where letters.id = letter_events.letter_id and (letters.sender_id = auth.uid() or letters.recipient_id = auth.uid()))
);
create policy "Users can create their letter events" on public.letter_events for insert with check (
  exists (select 1 from public.letters where letters.id = letter_events.letter_id and letters.sender_id = auth.uid())
);
create policy "Users can update their letter events" on public.letter_events for update using (
  exists (select 1 from public.letters where letters.id = letter_events.letter_id and letters.sender_id = auth.uid())
);

create policy "Users can read their journey notes" on public.journey_notes for select using (auth.uid() = author_id);
create policy "Users can create their journey notes" on public.journey_notes for insert with check (
  auth.uid() = author_id and exists (
    select 1 from public.letters where letters.id = journey_notes.letter_id and (letters.sender_id = auth.uid() or letters.recipient_id = auth.uid())
  )
);
create policy "Users can delete their journey notes" on public.journey_notes for delete using (auth.uid() = author_id);
