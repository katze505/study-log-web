-- 회원가입 정보(accounts)와 화면용 프로필(profiles)을 분리합니다.
-- 기존 백엔드가 아직 profiles.email을 쓰더라도 깨지지 않도록 email 컬럼은 nullable로만 바꿉니다.
-- 새 백엔드 배포 후 20261118000100_drop_profiles_email.sql로 컬럼을 삭제하세요.

create table public.accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

insert into public.accounts (id, email, created_at)
select id, lower(email), created_at from public.profiles;

alter table public.profiles alter column email drop not null;

alter table public.accounts enable row level security;
revoke all on public.accounts from anon, authenticated;
