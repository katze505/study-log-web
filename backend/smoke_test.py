"""실제 API로 저장 → 재로그인 → 재조회까지 확인하는 점검 스크립트.

사용법: .venv/bin/python smoke_test.py [API 주소]   (기본값 http://localhost:8000)
테스트 계정(smoke_<tag>_a/b@example.com)을 만들고, 끝나면 정리용 SQL을 출력합니다.
"""

import base64
import hashlib
import hmac
import struct
import sys
import time
import uuid
from datetime import date

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
client = httpx.Client(base_url=BASE, timeout=30)
tag = uuid.uuid4().hex[:6]
today = date.today().isoformat()
PASSWORD = "smoke-test-pw-1"


def call(method, path, expect=200, token=None, **kwargs):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    res = client.request(method, path, headers=headers, **kwargs)
    assert res.status_code == expect, f"{method} {path} → {res.status_code} {res.text}"
    return res.json() if res.content else None


def step(text):
    print(f"  ✓ {text}")


def totp(secret, offset=0):
    key = base64.b32decode(secret + "=" * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack(">Q", int(time.time()) // 30 + offset), hashlib.sha1).digest()
    n = struct.unpack(">I", digest[(digest[-1] & 15) : (digest[-1] & 15) + 4])[0] & 0x7FFFFFFF
    return f"{n % 1_000_000:06d}"


print(f"API: {BASE}  (tag={tag})")
assert call("GET", "/api/health")["secret_key"], "서버에 SUPABASE_SECRET_KEY가 없습니다."
step("health: Supabase 설정 확인")

emails = {n: f"smoke_{tag}_{n}@example.com" for n in "ab"}
tokens = {}
for n, email in emails.items():
    assert call("POST", "/api/auth/signup", 201, json={"email": email, "password": PASSWORD, "nickname": f"smoke_{tag}_{n}"}) == {"email": email}
    tokens[n] = call("POST", "/api/auth/login", json={"email": email, "password": PASSWORD})["access_token"]
step("회원가입 2명 (가입 후 토큰 없이 로그인 화면으로 → 로그인)")

call("POST", "/api/auth/login", 401, json={"email": emails["a"], "password": "wrong-password"})
call("POST", "/api/auth/login", 404, json={"email": f"smoke_{tag}_nobody@example.com", "password": PASSWORD})
me = call("GET", "/api/me", token=tokens["a"])
assert me["email"] == emails["a"] and me["joined_at"] and me["mfa_enabled"] is False, me
step("로그인 실패 구분 (비밀번호 틀림 401 / 회원 없음 404), 가입 정보 조회")

subject = call("POST", "/api/subjects", 201, token=tokens["a"], json={"name": "알고리즘", "category": "dev", "color": "#10b981"})
call("POST", "/api/subjects", 409, token=tokens["a"], json={"name": "알고리즘", "category": "dev"})
step("과목 추가 (중복 이름은 409)")

assert call("PATCH", f"/api/subjects/{subject['id']}", token=tokens["a"], json={"color": "#EC4899"})["color"] == "#ec4899"
call("PATCH", f"/api/subjects/{subject['id']}", 404, token=tokens["b"], json={"color": "#ec4899"})
step("과목 색 변경 (다른 사용자는 404)")

saved = call(
    "POST",
    "/api/sessions",
    201,
    token=tokens["a"],
    json={"subject_id": subject["id"], "duration_minutes": 75, "studied_on": today, "memo": "smoke test"},
)
step("공부 기록 저장 75분")

# 새로고침/재접속 상황: 새로 로그인한 토큰으로 DB에서 다시 읽기
fresh = call("POST", "/api/auth/login", json={"email": emails["a"], "password": PASSWORD})["access_token"]
assert call("GET", "/api/me", token=fresh)["nickname"] == f"smoke_{tag}_a"
rows = call("GET", "/api/sessions", token=fresh, params={"start": today, "end": today})
assert [r["id"] for r in rows] == [saved["id"]] and rows[0]["duration_minutes"] == 75, rows
assert [s["id"] for s in call("GET", "/api/subjects", token=fresh)] == [subject["id"]]
step("재로그인 후 과목·기록 재조회 일치")

new_tokens = call("POST", "/api/auth/refresh", json={"refresh_token": call("POST", "/api/auth/login", json={"email": emails["b"], "password": PASSWORD})["refresh_token"]})
tokens["b"] = new_tokens["access_token"]
step("토큰 갱신(refresh)")

assert call("GET", "/api/sessions", token=tokens["b"], params={"start": today, "end": today}) == []
call("DELETE", f"/api/sessions/{saved['id']}", 404, token=tokens["b"])
step("다른 사용자의 기록은 보이지도, 지워지지도 않음")

call("POST", "/api/friends/requests", 201, token=tokens["a"], json={"nickname": f"smoke_{tag}_b"})
incoming = call("GET", "/api/friends", token=tokens["b"], params={"end": today})["incoming"]
call("POST", f"/api/friends/requests/{incoming[0]['friendship_id']}/accept", token=tokens["b"])
friends_of_b = call("GET", "/api/friends", token=tokens["b"], params={"end": today})["friends"]
assert friends_of_b[0]["nickname"] == f"smoke_{tag}_a" and friends_of_b[0]["week_minutes"] == 75, friends_of_b
step("친구 요청 → 수락 → 친구의 주간 공부시간(75분) 조회")

call("DELETE", f"/api/subjects/{subject['id']}", 204, token=tokens["a"])
rows = call("GET", "/api/sessions", token=tokens["a"], params={"start": today, "end": today})
assert rows[0]["subject_id"] is None and rows[0]["subject_name"] == "알고리즘", rows
step("과목 삭제 후에도 기록은 남음")

call("DELETE", f"/api/sessions/{saved['id']}", 204, token=tokens["a"])
assert call("GET", "/api/sessions", token=tokens["a"], params={"start": today, "end": today}) == []
step("기록 삭제")

enroll = call("POST", "/api/auth/mfa/enroll", token=tokens["b"])
assert enroll["qr_code"].startswith("data:image/svg"), enroll
call("POST", "/api/auth/mfa/activate", 400, token=tokens["b"], json={"factor_id": enroll["factor_id"], "code": "000000" if totp(enroll["secret"]) != "000000" else "111111"})
tokens["b"] = call("POST", "/api/auth/mfa/activate", token=tokens["b"], json={"factor_id": enroll["factor_id"], "code": totp(enroll["secret"])})["access_token"]
assert call("GET", "/api/me", token=tokens["b"])["mfa_enabled"] is True
step("2차 인증 등록 (틀린 코드 400 → 올바른 코드로 활성화)")

pending = call("POST", "/api/auth/login", json={"email": emails["b"], "password": PASSWORD})
assert pending["mfa_required"] and "refresh_token" not in pending, pending
call("GET", "/api/me", 401, token=pending["mfa_token"])
time.sleep(31)  # 같은 코드는 한 번만 쓸 수 있으므로 다음 30초 구간 코드 사용
session = call("POST", "/api/auth/login/mfa", json={"mfa_token": pending["mfa_token"], "factor_id": pending["factor_id"], "code": totp(enroll["secret"])})
assert call("GET", "/api/me", token=session["access_token"])["nickname"] == f"smoke_{tag}_b"
step("2차 인증 로그인 (비밀번호만 통과한 토큰은 401 → 코드 입력 후 사용 가능)")

call("DELETE", "/api/auth/mfa", 204, token=session["access_token"])
assert "access_token" in call("POST", "/api/auth/login", json={"email": emails["b"], "password": PASSWORD})
step("2차 인증 끄기 → 비밀번호만으로 로그인")

print("\n모든 점검 통과. 테스트 계정 정리 SQL:")
print(f"  delete from auth.users where email like 'smoke\\_{tag}\\_%@example.com';")
