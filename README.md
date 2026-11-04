# 스터디로그

일반 공부와 개발 스터디를 함께 기록하는 웹사이트입니다.

- 프런트엔드: https://study-log-web-jade.vercel.app (Vercel 프로젝트 `study-log-web`, Root Directory `frontend`)
- 백엔드 API: https://study-log-api.vercel.app (Vercel 프로젝트 `study-log-api`, Root Directory `backend`)
  - 상태 확인: `/api/health` · API 문서: `/docs`

데이터 흐름은 React → FastAPI → Supabase입니다. 브라우저는 Supabase에 직접 접근하지 않습니다.
테이블은 RLS가 켜져 있고 정책이 없어서, 서버의 secret key로만 읽고 쓸 수 있습니다.

## 환경 변수

| 파일 | 변수 | 값 |
| --- | --- | --- |
| `frontend/.env.local` | `VITE_API_URL` | 로컬: `http://localhost:8000` |
| `backend/.env` | `SUPABASE_URL` | Supabase 프로젝트 주소 |
| | `SUPABASE_PUBLISHABLE_KEY` | 공개 키(`sb_publishable_...`), 로그인 요청에 사용 |
| | `SUPABASE_SECRET_KEY` | **직접 입력해야 합니다.** Supabase 대시보드 → Project Settings → API Keys → Secret keys(`sb_secret_...`) |
| | `ALLOWED_ORIGINS` | CORS 허용 주소(쉼표로 구분). 로컬: `http://localhost:5173` |

`.env`와 `.env.local`은 Git에서 제외됩니다. 변수 이름은 각 폴더의 `.env.example`을 참고하세요.

프로덕션 값은 Vercel 프로젝트 환경 변수에 저장되어 있습니다.

- `study-log-web`: `VITE_API_URL=https://study-log-api.vercel.app`
- `study-log-api`: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`(Sensitive), `ALLOWED_ORIGINS=https://study-log-web-jade.vercel.app`

## 로컬 실행 (macOS)

백엔드 (터미널 1):

```bash
cd backend
python3 -m venv .venv            # 처음 한 번만
.venv/bin/pip install -r requirements.txt
.venv/bin/fastapi dev app.py --port 8000
# → http://localhost:8000/api/health, http://localhost:8000/docs
```

프런트엔드 (터미널 2):

```bash
cd frontend
npm install                      # 처음 한 번만
npm run dev
# → http://localhost:5173
```

## 점검

```bash
cd backend
.venv/bin/python smoke_test.py                                  # 로컬 API
.venv/bin/python smoke_test.py https://study-log-api.vercel.app # 프로덕션 API
```

회원가입 → 과목 추가 → 기록 저장 → 재로그인 후 재조회 → 친구 요청/수락 → 과목/기록 삭제를 실제 API로 확인합니다.

## 배포

```bash
# 저장소 루트에서 실행 (각 프로젝트의 Root Directory 설정을 사용)
VERCEL_ORG_ID=team_GK7I34NHVue1gHqIxOhfTh60 VERCEL_PROJECT_ID=prj_z3QJ2tI3QB2Lwmdlu9COBZh0CCBh vercel deploy --prod  # 백엔드
VERCEL_ORG_ID=team_GK7I34NHVue1gHqIxOhfTh60 VERCEL_PROJECT_ID=prj_VvCcHia4UDHxtcAmnBR1XCsQspvV vercel deploy --prod  # 프런트엔드
```

DB 스키마: `supabase/migrations/20261028000000_init_study_log.sql`
