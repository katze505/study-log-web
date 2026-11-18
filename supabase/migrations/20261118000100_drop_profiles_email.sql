-- 새 백엔드(accounts 사용)를 배포한 뒤에 적용하세요. 이메일은 accounts에만 남습니다.
alter table public.profiles drop column email;
