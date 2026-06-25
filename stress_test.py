#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stress test for Customer Type Workflow"""

import json, time, sys, urllib.request

BASE = "http://127.0.0.1:2288"
results = []

def log(step, ok, detail, ms):
    results.append({"step": step, "ok": ok, "detail": detail, "ms": ms})
    status = "PASS" if ok else "FAIL"
    print(f"   [{status}] {step}  ({ms}ms)  {detail}")

def req(method, path, body=None):
    url = f"{BASE}{path}"
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body else None
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    start = time.time()
    with urllib.request.urlopen(r, timeout=30) as resp:
        text = resp.read().decode("utf-8")
    ms = int((time.time() - start) * 1000)
    return json.loads(text), ms

def req_ignore_409(path, body):
    try:
        return req("POST", path, body)
    except urllib.error.HTTPError as e:
        if e.code == 409:
            return json.loads(e.read().decode("utf-8")), 0
        raise

print("="*60)
print("  STRESS TEST: Customer Type Workflow")
print("="*60)

# 1. Login
print("\n[1] DEV LOGIN ...")
try:
    j, ms = req("POST", "/api/auth/login", {"login":"dev", "pin":"dev@123", "localDate":"2026-06-23"})
    actor = {"id": j["user"]["id"], "login": j["user"]["login"], "name": j["user"]["name"], "role": j["user"]["role"]}
    log("login", True, f"role={actor['role']}", ms)
except Exception as e:
    log("login", False, str(e), 0)
    actor = {"id":"00000000-0000-4000-8000-000000000001","login":"dev","name":"dev","role":"developer"}
    print("   Using fallback actor")

# 2. Get tables
print("\n[2] GET TABLES ...")
try:
    j, ms = req("GET", "/api/restaurant/tables")
    tables = j.get("tables", [])
    avail = [t for t in tables if t.get("status") == "available"]
    log("get-tables", True, f"total={len(tables)} available={len(avail)}", ms)
except Exception as e:
    log("get-tables", False, str(e), 0)
    tables, avail = [], []

if len(avail) < 4:
    print("\n   NOT ENOUGH AVAILABLE TABLES — aborting seat tests")
    sys.exit(1)

t1, t2, t3, t4 = avail[0], avail[1], avail[2], avail[3]

def seat(table, ctype):
    body = {
        "tableId": table["id"],
        "mat3amActor": actor,
        "assignOrderTaker": True,
        "startedByRole": actor["role"],
        "startReason": f"stress_test_{ctype}",
        "customerType": ctype,
    }
    return req("POST", "/api/restaurant/table-sessions", body)

# 3. Seat CASH
print(f"\n[3] SEAT CASH on T{t1['number']} ...")
try:
    j, ms = seat(t1, "cash")
    sid_cash = j.get("id") or j.get("session", {}).get("id")
    pending = j.get("guestApprovalPending") or j.get("session", {}).get("guestApprovalPending")
    ctype = j.get("customerType") or j.get("session", {}).get("customerType")
    log("seat-cash", True, f"sid={sid_cash[:8]}.. pending={pending} type={ctype}", ms)
except Exception as e:
    log("seat-cash", False, str(e), 0)
    sid_cash = None

# 4. Seat GUEST (approval required)
print(f"\n[4] SEAT GUEST on T{t2['number']} ...")
try:
    j, ms = seat(t2, "guest")
    sid_guest = j.get("id") or j.get("session", {}).get("id")
    pending = j.get("guestApprovalPending") or j.get("session", {}).get("guestApprovalPending")
    ctype = j.get("customerType") or j.get("session", {}).get("customerType")
    log("seat-guest", pending is True, f"sid={sid_guest[:8]}.. pending={pending} type={ctype}", ms)
except Exception as e:
    log("seat-guest", False, str(e), 0)
    sid_guest = None

# 5. Seat OWNER
print(f"\n[5] SEAT OWNER on T{t3['number']} ...")
try:
    j, ms = seat(t3, "owner")
    sid_owner = j.get("id") or j.get("session", {}).get("id")
    pending = j.get("guestApprovalPending") or j.get("session", {}).get("guestApprovalPending")
    ctype = j.get("customerType") or j.get("session", {}).get("customerType")
    log("seat-owner", pending is True, f"sid={sid_owner[:8]}.. pending={pending} type={ctype}", ms)
except Exception as e:
    log("seat-owner", False, str(e), 0)
    sid_owner = None

# 6. Seat VIP
print(f"\n[6] SEAT VIP on T{t4['number']} ...")
try:
    j, ms = seat(t4, "vip")
    sid_vip = j.get("id") or j.get("session", {}).get("id")
    pending = j.get("guestApprovalPending") or j.get("session", {}).get("guestApprovalPending")
    ctype = j.get("customerType") or j.get("session", {}).get("customerType")
    log("seat-vip", pending is True, f"sid={sid_vip[:8]}.. pending={pending} type={ctype}", ms)
except Exception as e:
    log("seat-vip", False, str(e), 0)
    sid_vip = None

# 7. Get sessions and verify guest is locked
print("\n[7] VERIFY GUEST LOCKED ...")
try:
    j, ms = req("GET", "/api/restaurant/table-sessions")
    sessions = j.get("data", [])
    gs = next((s for s in sessions if s.get("id") == sid_guest), {})
    locked = bool(gs.get("guestApprovalPending") or gs.get("customerTypeLocked"))
    log("guest-locked", locked, f"type={gs.get('customerType')} pending={gs.get('guestApprovalPending')}", ms)
except Exception as e:
    log("guest-locked", False, str(e), 0)

# 8. Inbox
print("\n[8] MANAGER INBOX ...")
try:
    j, ms = req("GET", "/api/manager-approval/inbox?limit=50")
    reqs = j.get("data", []) if isinstance(j, dict) else []
    log("inbox", True, f"count={len(reqs)}", ms)
except Exception as e:
    log("inbox", False, str(e), 0)
    reqs = []

# 9. Approve guest
print("\n[9] APPROVE GUEST ...")
req_guest = next((r for r in reqs if r.get("sessionId") == sid_guest), None)
if req_guest:
    try:
        j, ms = req("POST", "/api/manager-approval/decide", {"requestId": req_guest["id"], "decision": "approve", "mat3amActor": actor})
        log("approve-guest", True, f"req={req_guest['id'][:8]}..", ms)
    except Exception as e:
        log("approve-guest", False, str(e), 0)
else:
    log("approve-guest", False, "request not found", 0)

# 10. Verify guest unlocked
print("\n[10] VERIFY GUEST UNLOCKED ...")
time.sleep(0.5)
try:
    j, ms = req("GET", "/api/restaurant/table-sessions")
    sessions = j.get("data", [])
    gs = next((s for s in sessions if s.get("id") == sid_guest), {})
    unlocked = not (gs.get("guestApprovalPending") or gs.get("customerTypeLocked"))
    is_guest = gs.get("guestSession")
    log("guest-unlocked", unlocked and is_guest, f"guestSession={is_guest} type={gs.get('customerType')}", ms)
except Exception as e:
    log("guest-unlocked", False, str(e), 0)

# 11. Approve owner
print("\n[11] APPROVE OWNER ...")
req_owner = next((r for r in reqs if r.get("sessionId") == sid_owner), None)
if req_owner:
    try:
        j, ms = req("POST", "/api/manager-approval/decide", {"requestId": req_owner["id"], "decision": "approve", "mat3amActor": actor})
        log("approve-owner", True, f"req={req_owner['id'][:8]}..", ms)
    except Exception as e:
        log("approve-owner", False, str(e), 0)
else:
    log("approve-owner", False, "request not found", 0)

# 12. Verify owner type
print("\n[12] VERIFY OWNER customerType ...")
time.sleep(0.5)
try:
    j, ms = req("GET", "/api/restaurant/table-sessions")
    sessions = j.get("data", [])
    osess = next((s for s in sessions if s.get("id") == sid_owner), {})
    ok = osess.get("customerType") == "owner"
    log("owner-type", ok, f"type={osess.get('customerType')}", ms)
except Exception as e:
    log("owner-type", False, str(e), 0)

# 13. Duplicate guard
print(f"\n[13] DUPLICATE GUARD (seat T{t1['number']} again with cash) ...")
try:
    j, ms = seat(t1, "cash")
    dup_sid = j.get("id") or j.get("session", {}).get("id")
    is_same = dup_sid == sid_cash
    log("duplicate-guard", is_same, f"same-session={is_same}", ms)
except Exception as e:
    log("duplicate-guard", False, str(e), 0)

# 14. Reject VIP
print("\n[14] REJECT VIP ...")
req_vip = next((r for r in reqs if r.get("sessionId") == sid_vip), None)
if req_vip:
    try:
        j, ms = req("POST", "/api/manager-approval/decide", {"requestId": req_vip["id"], "decision": "reject", "mat3amActor": actor})
        log("reject-vip", True, f"req={req_vip['id'][:8]}..", ms)
    except Exception as e:
        log("reject-vip", False, str(e), 0)
else:
    log("reject-vip", False, "request not found", 0)

# 15. Verify VIP rejected (back to cash)
print("\n[15] VERIFY VIP REJECTED (should be cash) ...")
time.sleep(0.5)
try:
    j, ms = req("GET", "/api/restaurant/table-sessions")
    sessions = j.get("data", [])
    vs = next((s for s in sessions if s.get("id") == sid_vip), {})
    is_cash = vs.get("customerType") in (None, "", "cash")
    log("vip-rejected", is_cash, f"type={vs.get('customerType')} pending={vs.get('guestApprovalPending')}", ms)
except Exception as e:
    log("vip-rejected", False, str(e), 0)

# 16. Speed burst
print("\n[16] SPEED BURST (10x GET /tables) ...")
times = []
for i in range(10):
    t0 = time.time()
    req("GET", "/api/restaurant/tables")
    times.append(int((time.time() - t0) * 1000))
avg = sum(times) // len(times)
mn = min(times)
mx = max(times)
log("speed-burst", True, f"avg={avg}ms min={mn}ms max={mx}ms", avg)

# 17. Cleanup
print("\n[17] CLEANUP (close test sessions) ...")
for sid, label in [(sid_cash,"cash"),(sid_guest,"guest"),(sid_owner,"owner"),(sid_vip,"vip")]:
    if sid:
        try:
            _, ms = req("POST", f"/api/restaurant/table-sessions/{sid}/close", {"mat3amActor": actor, "reason": "stress_test_cleanup"})
            log(f"close-{label}", True, f"sid={sid[:8]}..", ms)
        except Exception as e:
            log(f"close-{label}", False, str(e), 0)

# Summary
print("\n" + "="*60)
passed = sum(1 for r in results if r["ok"])
failed = sum(1 for r in results if not r["ok"])
print(f"  RESULTS: {passed} PASS / {failed} FAIL")
print("="*60)
for r in results:
    s = "OK " if r["ok"] else "ERR"
    print(f"  [{s}] {r['step']:20s}  {r['ms']:5d}ms  {r['detail']}")
print("="*60 + "\n")
