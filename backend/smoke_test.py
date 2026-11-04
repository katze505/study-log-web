"""실제 API로 저장 → 재로그인 → 재조회까지 확인하는 점검 스크립트.

사용법: .venv/bin/python smoke_test.py [API 주소]   (기본값 http://localhost:8000)
테스트 계정(smoke_<tag>_a/b@example.com)을 만들고, 끝나면 정리용 SQL을 출력합니다.
"""

import sys
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


print(f"API: {BASE}  (tag={tag})")
assert call("GET", "/api/health")["secret_key"], "서버에 SUPABASE_SECRET_KEY가 없습니다."
step("health: Supabase 설정 확인")

emails = {n: f"smoke_{tag}_{n}@example.com" for n in "ab"}
tokens = {}
for n, email in emails.items():
    session = call("POST", "/api/auth/signup", 201, json={"email": email, "password": PASSWORD, "nickname": f"smoke_{tag}_{n}"})
    tokens[n] = session["access_token"]
step("회원가입 2명")

subject = call("POST", "/api/subjects", 201, token=tokens["a"], json={"name": "알고리즘", "category": "dev", "color": "#10b981"})
call("POST", "/api/subjects", 409, token=tokens["a"], json={"name": "알고리즘", "category": "dev"})
step("과목 추가 (중복 이름은 409)")

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

print("\n모든 점검 통과. 테스트 계정 정리 SQL:")
print(f"  delete from auth.users where email like 'smoke\\_{tag}\\_%@example.com';")
