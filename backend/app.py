"""스터디 기록 API: React → FastAPI → Supabase.

브라우저는 Supabase에 직접 접근하지 않습니다. 모든 DB 접근은 서버용 secret key로 이 서버에서만 이뤄지고,
사용자 인증은 Supabase Auth의 access token을 검증해서 처리합니다.
"""

import os
from datetime import date, timedelta
from typing import Literal

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY", "")
ALLOWED_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]

Category = Literal["general", "dev"]

app = FastAPI(title="Study Log API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Supabase 호출 도우미
# ---------------------------------------------------------------------------


def _require_config() -> None:
    if not (SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY):
        raise HTTPException(503, "서버에 Supabase 환경 변수가 설정되지 않았습니다.")


def _key_headers(key: str) -> dict[str, str]:
    headers = {"apikey": key}
    # 레거시 JWT 키(eyJ...)는 Authorization 헤더도 필요. 새 sb_secret_/sb_publishable_ 키는 apikey만 사용.
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    return headers


async def db(
    method: str,
    table: str,
    *,
    params: list[tuple[str, str]] | dict[str, str] | None = None,
    json: dict | None = None,
    returning: bool = False,
):
    _require_config()
    headers = _key_headers(SUPABASE_SECRET_KEY)
    if returning:
        headers["Prefer"] = "return=representation"
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.request(
            method, f"{SUPABASE_URL}/rest/v1/{table}", params=params, json=json, headers=headers
        )
    if res.status_code >= 400:
        try:
            code = res.json().get("code")
        except ValueError:
            code = None
        if code == "23505":
            raise HTTPException(409, "이미 존재하는 항목입니다.")
        if code in ("23514", "22P02", "23503"):
            raise HTTPException(400, "입력값이 올바르지 않습니다.")
        raise HTTPException(502, "데이터베이스 요청에 실패했습니다.")
    return res.json() if res.content else None


async def auth(method: str, path: str, *, json: dict | None = None, token: str | None = None, admin: bool = False):
    _require_config()
    headers = _key_headers(SUPABASE_SECRET_KEY if admin else SUPABASE_PUBLISHABLE_KEY)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with httpx.AsyncClient(timeout=10) as client:
        return await client.request(method, f"{SUPABASE_URL}/auth/v1{path}", json=json, headers=headers)


def _session_payload(data: dict) -> dict:
    return {
        "access_token": data["access_token"],
        "refresh_token": data["refresh_token"],
        "expires_in": data.get("expires_in"),
    }


async def current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "로그인이 필요합니다.")
    res = await auth("GET", "/user", token=authorization[7:])
    if res.status_code != 200:
        raise HTTPException(401, "로그인이 만료되었습니다. 다시 로그인해 주세요.")
    rows = await db("GET", "profiles", params={"id": f"eq.{res.json()['id']}", "select": "id,email,nickname"})
    if not rows:
        raise HTTPException(401, "프로필을 찾을 수 없습니다. 다시 가입해 주세요.")
    return rows[0]


# ---------------------------------------------------------------------------
# 상태 확인
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "supabase_url": bool(SUPABASE_URL),
        "publishable_key": bool(SUPABASE_PUBLISHABLE_KEY),
        "secret_key": bool(SUPABASE_SECRET_KEY),
    }


# ---------------------------------------------------------------------------
# 인증
# ---------------------------------------------------------------------------


class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=72)
    nickname: str = Field(pattern=r"^[가-힣A-Za-z0-9_]{2,20}$")


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


async def _password_login(email: str, password: str) -> dict:
    res = await auth("POST", "/token?grant_type=password", json={"email": email, "password": password})
    if res.status_code != 200:
        raise HTTPException(401, "이메일 또는 비밀번호가 올바르지 않습니다.")
    return _session_payload(res.json())


@app.post("/api/auth/signup", status_code=201)
async def signup(body: SignupIn):
    if await db("GET", "profiles", params={"nickname": f"eq.{body.nickname}", "select": "id"}):
        raise HTTPException(409, "이미 사용 중인 닉네임입니다.")

    # 이메일 인증 메일 없이 바로 사용할 수 있도록 서버에서 확인된 계정으로 생성
    res = await auth(
        "POST",
        "/admin/users",
        json={"email": body.email, "password": body.password, "email_confirm": True},
        admin=True,
    )
    if res.status_code == 422:
        raise HTTPException(409, "이미 가입된 이메일입니다.")
    if res.status_code >= 400:
        raise HTTPException(502, "계정을 만들지 못했습니다.")
    user_id = res.json()["id"]

    try:
        await db("POST", "profiles", json={"id": user_id, "email": body.email, "nickname": body.nickname})
    except HTTPException:
        await auth("DELETE", f"/admin/users/{user_id}", admin=True)
        raise
    return await _password_login(body.email, body.password)


@app.post("/api/auth/login")
async def login(body: LoginIn):
    return await _password_login(body.email, body.password)


@app.post("/api/auth/refresh")
async def refresh(body: RefreshIn):
    res = await auth("POST", "/token?grant_type=refresh_token", json={"refresh_token": body.refresh_token})
    if res.status_code != 200:
        raise HTTPException(401, "로그인이 만료되었습니다. 다시 로그인해 주세요.")
    return _session_payload(res.json())


@app.get("/api/me")
async def me(user: dict = Depends(current_user)):
    return user


# ---------------------------------------------------------------------------
# 과목
# ---------------------------------------------------------------------------


class SubjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=30)
    category: Category
    color: str = Field(default="#6366f1", pattern=r"^#[0-9a-fA-F]{6}$")


@app.get("/api/subjects")
async def list_subjects(user: dict = Depends(current_user)):
    return await db(
        "GET",
        "subjects",
        params={"user_id": f"eq.{user['id']}", "select": "id,name,category,color", "order": "created_at.asc"},
    )


@app.post("/api/subjects", status_code=201)
async def create_subject(body: SubjectIn, user: dict = Depends(current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "과목 이름을 입력해 주세요.")
    try:
        rows = await db(
            "POST",
            "subjects",
            json={"user_id": user["id"], "name": name, "category": body.category, "color": body.color},
            returning=True,
        )
    except HTTPException as e:
        if e.status_code == 409:
            raise HTTPException(409, "같은 이름의 과목이 이미 있습니다.") from e
        raise
    row = rows[0]
    return {k: row[k] for k in ("id", "name", "category", "color")}


@app.delete("/api/subjects/{subject_id}", status_code=204)
async def delete_subject(subject_id: str, user: dict = Depends(current_user)):
    rows = await db(
        "DELETE",
        "subjects",
        params={"id": f"eq.{subject_id}", "user_id": f"eq.{user['id']}"},
        returning=True,
    )
    if not rows:
        raise HTTPException(404, "과목을 찾을 수 없습니다.")


# ---------------------------------------------------------------------------
# 공부 기록
# ---------------------------------------------------------------------------

SESSION_FIELDS = "id,subject_id,subject_name,category,duration_minutes,studied_on,memo,created_at"


class SessionIn(BaseModel):
    subject_id: str
    duration_minutes: int = Field(ge=1, le=1440)
    studied_on: date
    memo: str | None = Field(default=None, max_length=500)


@app.get("/api/sessions")
async def list_sessions(start: date, end: date, user: dict = Depends(current_user)):
    if start > end or (end - start).days > 400:
        raise HTTPException(400, "조회 기간이 올바르지 않습니다.")
    return await db(
        "GET",
        "study_sessions",
        params=[
            ("user_id", f"eq.{user['id']}"),
            ("studied_on", f"gte.{start}"),
            ("studied_on", f"lte.{end}"),
            ("select", SESSION_FIELDS),
            ("order", "studied_on.desc,created_at.desc"),
        ],
    )


@app.post("/api/sessions", status_code=201)
async def create_session(body: SessionIn, user: dict = Depends(current_user)):
    subjects = await db(
        "GET",
        "subjects",
        params={"id": f"eq.{body.subject_id}", "user_id": f"eq.{user['id']}", "select": "id,name,category"},
    )
    if not subjects:
        raise HTTPException(404, "과목을 찾을 수 없습니다.")
    subject = subjects[0]
    memo = (body.memo or "").strip() or None
    rows = await db(
        "POST",
        f"study_sessions?select={SESSION_FIELDS}",
        json={
            "user_id": user["id"],
            "subject_id": subject["id"],
            "subject_name": subject["name"],
            "category": subject["category"],
            "duration_minutes": body.duration_minutes,
            "studied_on": body.studied_on.isoformat(),
            "memo": memo,
        },
        returning=True,
    )
    return rows[0]


@app.delete("/api/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str, user: dict = Depends(current_user)):
    rows = await db(
        "DELETE",
        "study_sessions",
        params={"id": f"eq.{session_id}", "user_id": f"eq.{user['id']}"},
        returning=True,
    )
    if not rows:
        raise HTTPException(404, "기록을 찾을 수 없습니다.")


# ---------------------------------------------------------------------------
# 친구
# ---------------------------------------------------------------------------


class FriendRequestIn(BaseModel):
    nickname: str = Field(min_length=2, max_length=20)


@app.get("/api/friends")
async def list_friends(end: date = Query(description="사용자 기준 오늘 날짜"), user: dict = Depends(current_user)):
    uid = user["id"]
    links = await db(
        "GET",
        "friendships",
        params={
            "or": f"(requester_id.eq.{uid},addressee_id.eq.{uid})",
            "select": "id,status,requester_id,addressee_id",
            "order": "created_at.asc",
        },
    )
    other_ids = {link["addressee_id"] if link["requester_id"] == uid else link["requester_id"] for link in links}
    nicknames: dict[str, str] = {}
    if other_ids:
        profiles = await db("GET", "profiles", params={"id": f"in.({','.join(other_ids)})", "select": "id,nickname"})
        nicknames = {p["id"]: p["nickname"] for p in profiles}

    friend_ids = [
        link["addressee_id"] if link["requester_id"] == uid else link["requester_id"]
        for link in links
        if link["status"] == "accepted"
    ]
    week_minutes = {fid: 0 for fid in [uid, *friend_ids]}
    rows = await db(
        "GET",
        "study_sessions",
        params=[
            ("user_id", f"in.({','.join(week_minutes)})"),
            ("studied_on", f"gte.{end - timedelta(days=6)}"),
            ("studied_on", f"lte.{end}"),
            ("select", "user_id,duration_minutes"),
        ],
    )
    for row in rows:
        week_minutes[row["user_id"]] += row["duration_minutes"]

    friends, incoming, outgoing = [], [], []
    for link in links:
        other = link["addressee_id"] if link["requester_id"] == uid else link["requester_id"]
        item = {"friendship_id": link["id"], "id": other, "nickname": nicknames.get(other, "(알 수 없음)")}
        if link["status"] == "accepted":
            friends.append({**item, "week_minutes": week_minutes.get(other, 0)})
        elif link["requester_id"] == uid:
            outgoing.append(item)
        else:
            incoming.append(item)
    friends.sort(key=lambda f: f["week_minutes"], reverse=True)

    return {
        "me": {"id": uid, "nickname": user["nickname"], "week_minutes": week_minutes[uid]},
        "friends": friends,
        "incoming": incoming,
        "outgoing": outgoing,
    }


@app.post("/api/friends/requests", status_code=201)
async def send_friend_request(body: FriendRequestIn, user: dict = Depends(current_user)):
    uid = user["id"]
    targets = await db("GET", "profiles", params={"nickname": f"eq.{body.nickname.strip()}", "select": "id"})
    if not targets:
        raise HTTPException(404, "해당 닉네임의 사용자가 없습니다.")
    target = targets[0]["id"]
    if target == uid:
        raise HTTPException(400, "자기 자신은 친구로 추가할 수 없습니다.")

    existing = await db(
        "GET",
        "friendships",
        params={
            "or": f"(and(requester_id.eq.{uid},addressee_id.eq.{target}),and(requester_id.eq.{target},addressee_id.eq.{uid}))",
            "select": "id,status,requester_id",
        },
    )
    if existing:
        link = existing[0]
        if link["status"] == "accepted":
            raise HTTPException(409, "이미 친구입니다.")
        if link["requester_id"] == uid:
            raise HTTPException(409, "이미 친구 요청을 보냈습니다.")
        # 상대가 먼저 보낸 요청이 있으면 바로 수락
        await db("PATCH", "friendships", params={"id": f"eq.{link['id']}"}, json={"status": "accepted"})
        return {"status": "accepted"}

    await db("POST", "friendships", json={"requester_id": uid, "addressee_id": target})
    return {"status": "pending"}


@app.post("/api/friends/requests/{friendship_id}/accept")
async def accept_friend_request(friendship_id: str, user: dict = Depends(current_user)):
    rows = await db(
        "PATCH",
        "friendships",
        params={"id": f"eq.{friendship_id}", "addressee_id": f"eq.{user['id']}", "status": "eq.pending"},
        json={"status": "accepted"},
        returning=True,
    )
    if not rows:
        raise HTTPException(404, "친구 요청을 찾을 수 없습니다.")
    return {"status": "accepted"}


@app.delete("/api/friends/{friendship_id}", status_code=204)
async def remove_friend(friendship_id: str, user: dict = Depends(current_user)):
    """친구 삭제, 받은 요청 거절, 보낸 요청 취소에 모두 사용."""
    uid = user["id"]
    rows = await db(
        "DELETE",
        "friendships",
        params={"id": f"eq.{friendship_id}", "or": f"(requester_id.eq.{uid},addressee_id.eq.{uid})"},
        returning=True,
    )
    if not rows:
        raise HTTPException(404, "친구 정보를 찾을 수 없습니다.")
