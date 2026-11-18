"""스터디 기록 API: React → FastAPI → Supabase.

브라우저는 Supabase에 직접 접근하지 않습니다. 모든 DB 접근은 서버용 secret key로 이 서버에서만 이뤄지고,
사용자 인증은 Supabase Auth의 access token을 검증해서 처리합니다.
"""

import base64
import json as jsonlib
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

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


def _verified_factors(user: dict) -> list[dict]:
    return [f for f in user.get("factors") or [] if f.get("status") == "verified"]


def _token_aal(token: str) -> str | None:
    # /user 호출로 이미 검증된 토큰이므로 서명 확인 없이 aal 클레임만 읽음
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return jsonlib.loads(base64.urlsafe_b64decode(payload)).get("aal")
    except (IndexError, ValueError):
        return None


async def current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "로그인이 필요합니다.")
    token = authorization[7:]
    res = await auth("GET", "/user", token=token)
    if res.status_code != 200:
        raise HTTPException(401, "로그인이 만료되었습니다. 다시 로그인해 주세요.")
    user = res.json()
    verified = _verified_factors(user)
    # 2차 인증을 켠 계정은 OTP까지 통과한 토큰(aal2)만 허용
    if verified and _token_aal(token) != "aal2":
        raise HTTPException(401, "2차 인증이 필요합니다. 다시 로그인해 주세요.")
    rows = await db("GET", "profiles", params={"id": f"eq.{user['id']}", "select": "id,nickname"})
    if not rows:
        raise HTTPException(401, "프로필을 찾을 수 없습니다. 다시 가입해 주세요.")
    return {
        **rows[0],
        "email": user["email"],
        "token": token,
        "factors": user.get("factors") or [],
        "factor_id": verified[0]["id"] if verified else None,
    }


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


class MfaLoginIn(BaseModel):
    mfa_token: str
    factor_id: UUID
    code: str = Field(pattern=r"^\d{6}$")


class MfaActivateIn(BaseModel):
    factor_id: UUID
    code: str = Field(pattern=r"^\d{6}$")


async def _touch_login(user_id: str) -> None:
    await db(
        "PATCH",
        "accounts",
        params={"id": f"eq.{user_id}"},
        json={"last_login_at": datetime.now(timezone.utc).isoformat()},
    )


async def _verify_totp(token: str, factor_id: UUID, code: str) -> dict:
    res = await auth("POST", f"/factors/{factor_id}/challenge", json={}, token=token)
    if res.status_code != 200:
        raise HTTPException(401, "2차 인증 시간이 지났습니다. 처음부터 다시 로그인해 주세요.")
    res = await auth(
        "POST", f"/factors/{factor_id}/verify", json={"challenge_id": res.json()["id"], "code": code}, token=token
    )
    if res.status_code != 200:
        raise HTTPException(400, "인증 코드가 올바르지 않습니다. 앱에 표시된 최신 6자리 코드를 입력해 주세요.")
    return res.json()


@app.post("/api/auth/signup", status_code=201)
async def signup(body: SignupIn):
    """가입 정보는 accounts, 화면에 보이는 정보는 profiles에 따로 저장. 가입 후에는 로그인 화면에서 다시 로그인."""
    email = body.email.lower()
    if await db("GET", "profiles", params={"nickname": f"eq.{body.nickname}", "select": "id"}):
        raise HTTPException(409, "이미 사용 중인 닉네임입니다.")

    # 이메일 인증 메일 없이 바로 사용할 수 있도록 서버에서 확인된 계정으로 생성
    res = await auth(
        "POST",
        "/admin/users",
        json={"email": email, "password": body.password, "email_confirm": True},
        admin=True,
    )
    if res.status_code == 422:
        raise HTTPException(409, "이미 가입된 이메일입니다.")
    if res.status_code >= 400:
        raise HTTPException(502, "계정을 만들지 못했습니다.")
    user_id = res.json()["id"]

    try:
        await db("POST", "accounts", json={"id": user_id, "email": email})
        await db("POST", "profiles", json={"id": user_id, "nickname": body.nickname})
    except HTTPException:
        await auth("DELETE", f"/admin/users/{user_id}", admin=True)  # accounts/profiles도 함께 삭제(cascade)
        raise
    return {"email": email}


@app.post("/api/auth/login")
async def login(body: LoginIn):
    email = body.email.lower()
    res = await auth("POST", "/token?grant_type=password", json={"email": email, "password": body.password})
    if res.status_code == 429:
        raise HTTPException(429, "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.")
    if res.status_code != 200:
        if not await db("GET", "accounts", params={"email": f"eq.{email}", "select": "id"}):
            raise HTTPException(404, "가입된 회원 정보가 없습니다. 이메일을 확인하거나 회원가입해 주세요.")
        raise HTTPException(401, "비밀번호가 올바르지 않습니다.")
    data = res.json()
    verified = _verified_factors(data.get("user") or {})
    if verified:
        # 비밀번호만 통과한 토큰(aal1)은 current_user에서 거부되므로, OTP 확인용으로만 돌려줌
        return {"mfa_required": True, "mfa_token": data["access_token"], "factor_id": verified[0]["id"]}
    await _touch_login(data["user"]["id"])
    return _session_payload(data)


@app.post("/api/auth/login/mfa")
async def login_mfa(body: MfaLoginIn):
    data = await _verify_totp(body.mfa_token, body.factor_id, body.code)
    await _touch_login(data["user"]["id"])
    return _session_payload(data)


@app.post("/api/auth/refresh")
async def refresh(body: RefreshIn):
    res = await auth("POST", "/token?grant_type=refresh_token", json={"refresh_token": body.refresh_token})
    if res.status_code != 200:
        raise HTTPException(401, "로그인이 만료되었습니다. 다시 로그인해 주세요.")
    return _session_payload(res.json())


@app.get("/api/me")
async def me(user: dict = Depends(current_user)):
    rows = await db("GET", "accounts", params={"id": f"eq.{user['id']}", "select": "created_at"})
    return {
        "id": user["id"],
        "email": user["email"],
        "nickname": user["nickname"],
        "joined_at": rows[0]["created_at"] if rows else None,
        "mfa_enabled": bool(user["factor_id"]),
    }


# ---------------------------------------------------------------------------
# 2차 인증 (TOTP: Google Authenticator 등 인증 앱)
# ---------------------------------------------------------------------------


@app.post("/api/auth/mfa/enroll")
async def mfa_enroll(user: dict = Depends(current_user)):
    if user["factor_id"]:
        raise HTTPException(409, "이미 2차 인증이 켜져 있습니다.")
    # 이전에 끝내지 않은 등록은 정리하고 새로 시작
    for factor in user["factors"]:
        if factor.get("status") != "verified":
            await auth("DELETE", f"/factors/{factor['id']}", token=user["token"])
    res = await auth(
        "POST",
        "/factors",
        json={"factor_type": "totp", "issuer": "StudyLog", "friendly_name": f"studylog-{uuid.uuid4().hex[:8]}"},
        token=user["token"],
    )
    if res.status_code != 200:
        raise HTTPException(502, "2차 인증을 등록하지 못했습니다.")
    data = res.json()
    qr = data["totp"]["qr_code"]
    if not qr.startswith("data:"):  # Supabase는 SVG 원문을 주므로 <img src>에 바로 쓸 수 있게 변환
        qr = "data:image/svg+xml;base64," + base64.b64encode(qr.encode()).decode()
    return {"factor_id": data["id"], "qr_code": qr, "secret": data["totp"]["secret"]}


@app.post("/api/auth/mfa/activate")
async def mfa_activate(body: MfaActivateIn, user: dict = Depends(current_user)):
    """첫 코드 확인으로 2차 인증을 켜고, 2차 인증까지 통과한 새 세션을 돌려줌."""
    return _session_payload(await _verify_totp(user["token"], body.factor_id, body.code))


@app.delete("/api/auth/mfa", status_code=204)
async def mfa_disable(user: dict = Depends(current_user)):
    if not user["factor_id"]:
        raise HTTPException(404, "2차 인증이 켜져 있지 않습니다.")
    res = await auth("DELETE", f"/factors/{user['factor_id']}", token=user["token"])
    if res.status_code != 200:
        raise HTTPException(502, "2차 인증을 끄지 못했습니다.")


# ---------------------------------------------------------------------------
# 과목
# ---------------------------------------------------------------------------


class SubjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=30)
    category: Category
    color: str = Field(default="#6366f1", pattern=r"^#[0-9a-fA-F]{6}$")


class SubjectColorIn(BaseModel):
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


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


@app.patch("/api/subjects/{subject_id}")
async def update_subject_color(subject_id: str, body: SubjectColorIn, user: dict = Depends(current_user)):
    rows = await db(
        "PATCH",
        "subjects",
        params={"id": f"eq.{subject_id}", "user_id": f"eq.{user['id']}", "select": "id,name,category,color"},
        json={"color": body.color.lower()},
        returning=True,
    )
    if not rows:
        raise HTTPException(404, "과목을 찾을 수 없습니다.")
    return rows[0]


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
