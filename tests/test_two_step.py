"""Two-step sign-in for staff: password, then a code from an authenticator app (or a recovery code)."""
import time

from app.services import accounts, two_step


def _code(secret):
    return two_step.code_at(secret.replace(" ", ""), int(time.time() // two_step.STEP))


def _login(api, password="admin-password"):
    return api.post("/api/staff/auth/login", json={"email": "admin@lavelondon.com", "password": password})


def test_codes_match_the_rfc_test_vector():
    # RFC 6238, SHA-1, T = 59s: 94287082 (last six digits 287082)
    import base64
    secret = base64.b32encode(b"12345678901234567890").decode()
    assert two_step.code_at(secret, 59 // 30) == "287082"


def test_set_up_then_sign_in_with_a_code_or_a_recovery_code(api, staff_headers):
    r = api.post("/api/staff/auth/two-step/setup", headers=staff_headers)
    assert r.status_code == 200 and "<svg" in r.json()["qr_svg"] and r.json()["uri"].startswith("otpauth://totp/")
    secret = r.json()["secret"]
    assert api.post("/api/staff/auth/two-step/enable", headers=staff_headers, json={"code": "000000"}).status_code == 400
    r = api.post("/api/staff/auth/two-step/enable", headers=staff_headers, json={"code": _code(secret)})
    assert r.status_code == 200 and len(r.json()["recovery_codes"]) == 10
    recovery = r.json()["recovery_codes"]

    api.cookies.clear()
    r = _login(api)
    assert r.json()["two_step"] is True and "token" not in r.json()
    pending = r.json()["pending"]
    assert api.post("/api/staff/auth/login/code", json={"pending": pending, "code": "123456"}).status_code == 401
    # The code just used to turn it on can't be used again; recovery codes work once.
    r = api.post("/api/staff/auth/login/code", json={"pending": pending, "code": recovery[0]})
    assert r.status_code == 200 and r.json()["staff"]["two_step"] and r.json()["staff"]["recovery_codes_left"] == 9
    assert api.post("/api/staff/auth/login/code", json={"pending": pending, "code": recovery[0]}).status_code == 401
    assert api.post("/api/staff/auth/login/code", json={"pending": "nonsense", "code": recovery[1]}).status_code == 401


def test_required_for_everyone_limits_sessions_until_set_up(api, staff_headers):
    # An admin must have it on before requiring it.
    r = api.put("/api/staff/team/two-step-required", headers=staff_headers, json={"on": True})
    assert r.status_code == 409
    secret = api.post("/api/staff/auth/two-step/setup", headers=staff_headers).json()["secret"]
    api.post("/api/staff/auth/two-step/enable", headers=staff_headers, json={"code": _code(secret)})
    assert api.put("/api/staff/team/two-step-required", headers=staff_headers, json={"on": True}).json()["required"]

    api.cookies.clear()
    r = api.post("/api/staff/auth/login", json={"email": "driver@lavelondon.com", "password": "driver-password"})
    assert r.status_code == 200 and r.json()["setup_two_step"] is True
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert api.get("/api/staff/delivery-settings", headers=h).status_code == 403
    assert api.get("/api/staff/me", headers=h).json()["setup_two_step"] is True
    s = api.post("/api/staff/auth/two-step/setup", headers=h).json()["secret"]
    r = api.post("/api/staff/auth/two-step/enable", headers=h, json={"code": _code(s)})
    full = {"Authorization": f"Bearer {r.json()['token']}"}
    assert api.get("/api/staff/delivery-settings", headers=full).status_code == 200


def test_wrong_passwords_pause_sign_in(api):
    accounts.reset_limits()
    for _ in range(10):
        assert _login(api, "wrong").status_code == 401
    assert _login(api).status_code == 429
    accounts.reset_limits()
    assert _login(api).status_code == 200
