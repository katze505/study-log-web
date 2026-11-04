-- Supabase MCP(apply_migration: init_study_log)로 이미 적용된 스키마의 사본입니다.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  nickname text not null unique check (char_length(nickname) between 2 and 20),
  created_at timestamptz not null default now()
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  category text not null check (category in ('general', 'dev')),
  color text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
create index subjects_user_id_idx on public.subjects(user_id);

-- 과목이 삭제돼도 기록은 남도록 과목 이름/분류를 함께 저장
create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  subject_name text not null,
  category text not null check (category in ('general', 'dev')),
  duration_minutes integer not null check (duration_minutes between 1 and 1440),
  studied_on date not null,
  memo text check (char_length(memo) <= 500),
  created_at timestamptz not null default now()
);
create index study_sessions_user_date_idx on public.study_sessions(user_id, studied_on);
create index study_sessions_subject_id_idx on public.study_sessions(subject_id);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
create unique index friendships_pair_idx on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_requester_idx on public.friendships(requester_id);
create index friendships_addressee_idx on public.friendships(addressee_id);

-- 모든 접근은 FastAPI(secret key)를 통해서만: RLS 켜고 정책 없음 = 공개 키로는 접근 불가
alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.study_sessions enable row level security;
alter table public.friendships enable row level security;
revoke all on public.profiles, public.subjects, public.study_sessions, public.friendships from anon, authenticated;
