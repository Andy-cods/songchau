"""W3-10 — RBAC cho task_assignments: staff chỉ thấy/thao tác task LIÊN QUAN mình.

Trước W3-10: GET "" (list) và GET /{id} không lọc theo user → staff thấy MỌI task
(rò việc người khác). Sau W3-10: filter Ở TẦNG QUERY (WHERE) — staff chỉ thấy task
mà assigned_to = mình HOẶC assigned_by = mình; manager/admin (+ viewer, vì viewer là
observer read-only toàn hệ — xem app/core/rbac.py) vẫn thấy tất cả.

task_type có CHECK constraint DB (chỉ nhận rfq_review|po_followup|delivery_prep|
invoice_review|general) nên KHÔNG dùng được làm marker cô lập test — seed cố định
task_type="general" và cô lập bằng cách assert theo ID cụ thể (subset check: task
liên quan PHẢI có mặt, task không liên quan PHẢI vắng mặt), không đếm tuyệt đối
total/độ dài danh sách, nên robust trước seed data / migration sẵn có.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio

BASE = "/api/v1/task-assignments"


async def _seed(db, *, assigned_to, assigned_by, status="pending", priority=3):
    return await db.fetchval(
        """
        INSERT INTO task_assignments (title, task_type, priority, status, assigned_to, assigned_by)
        VALUES ($1, 'general', $2, $3, $4::uuid, $5::uuid)
        RETURNING id
        """,
        "RBAC test task",
        priority,
        status,
        assigned_to,
        assigned_by,
    )


# ---------------------------------------------------------------------------
# GET "" (list) — staff chỉ thấy task liên quan; manager/admin thấy tất cả
# ---------------------------------------------------------------------------

async def test_staff_list_only_sees_related_tasks(client, staff, manager, admin, db):
    t_mine = await _seed(db, assigned_to=staff["id"], assigned_by=manager["id"])
    t_created_by_me = await _seed(db, assigned_to=admin["id"], assigned_by=staff["id"])
    t_unrelated = await _seed(db, assigned_to=admin["id"], assigned_by=manager["id"])

    r = await client.get(BASE, headers=staff["headers"], params={"limit": 200})
    assert r.status_code == 200
    ids = {item["id"] for item in r.json()["data"]["items"]}

    assert t_mine in ids
    assert t_created_by_me in ids  # assigned_by = staff -> vẫn thấy
    assert t_unrelated not in ids  # KHÔNG liên quan -> KHÔNG được rò


async def test_admin_list_sees_all_tasks(client, admin, staff, manager, db):
    t1 = await _seed(db, assigned_to=staff["id"], assigned_by=manager["id"])
    t2 = await _seed(db, assigned_to=admin["id"], assigned_by=manager["id"])

    r = await client.get(BASE, headers=admin["headers"], params={"limit": 200})
    assert r.status_code == 200
    ids = {item["id"] for item in r.json()["data"]["items"]}
    assert {t1, t2} <= ids


async def test_manager_list_sees_all_tasks(client, manager, staff, admin, db):
    t1 = await _seed(db, assigned_to=staff["id"], assigned_by=admin["id"])
    t2 = await _seed(db, assigned_to=admin["id"], assigned_by=admin["id"])

    r = await client.get(BASE, headers=manager["headers"], params={"limit": 200})
    assert r.status_code == 200
    ids = {item["id"] for item in r.json()["data"]["items"]}
    assert {t1, t2} <= ids


async def test_viewer_list_sees_all_tasks(client, viewer, staff, manager, db):
    """viewer = observer read-only toàn hệ (app/core/rbac.py, allow_viewer=True mặc
    định) -> require_role("staff","manager","admin") của list_tasks vẫn để viewer
    bypass qua GET. TASK_VIEW_ALL_ROLES chủ ý gồm viewer -> không bị siết ownership."""
    t1 = await _seed(db, assigned_to=staff["id"], assigned_by=manager["id"])
    t2 = await _seed(db, assigned_to=manager["id"], assigned_by=manager["id"])

    r = await client.get(BASE, headers=viewer["headers"], params={"limit": 200})
    assert r.status_code == 200
    ids = {item["id"] for item in r.json()["data"]["items"]}
    assert {t1, t2} <= ids


async def test_role_outside_allowed_list_forbidden(client, accountant, staff, manager, db):
    """accountant không nằm trong require_role("staff","manager","admin") của
    list_tasks -> phải 403 ngay ở tầng require_role, TRƯỚC KHI chạm logic filter
    ownership vừa thêm (khoá hành vi, tránh regression khi sửa allowed_roles)."""
    await _seed(db, assigned_to=staff["id"], assigned_by=manager["id"])
    r = await client.get(BASE, headers=accountant["headers"], params={"limit": 200})
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "INSUFFICIENT_PERMISSIONS"


async def test_staff_filter_by_other_user_returns_empty_not_error(client, staff, admin, manager, db):
    """staff cố ?assigned_to=<người khác> -> kết hợp AND với filter ownership ->
    task đó không xuất hiện, KHÔNG lỗi 500, KHÔNG rò dữ liệu người khác."""
    t_other = await _seed(db, assigned_to=admin["id"], assigned_by=manager["id"])

    r = await client.get(
        BASE,
        headers=staff["headers"],
        params={"assigned_to": admin["id"], "limit": 200},
    )
    assert r.status_code == 200
    items = r.json()["data"]["items"]
    ids = {item["id"] for item in items}
    assert t_other not in ids
    for item in items:
        assert item["assigned_to"] == staff["id"] or item["assigned_by"] == staff["id"]


# ---------------------------------------------------------------------------
# GET /{id} — staff chỉ xem được task liên quan mình; không liên quan -> 404
# ---------------------------------------------------------------------------

async def test_staff_get_own_assigned_task_ok(client, staff, manager, db):
    tid = await _seed(db, assigned_to=staff["id"], assigned_by=manager["id"])
    r = await client.get(f"{BASE}/{tid}", headers=staff["headers"])
    assert r.status_code == 200
    assert r.json()["data"]["id"] == tid


async def test_staff_get_task_created_by_self_ok(client, staff, admin, db):
    tid = await _seed(db, assigned_to=admin["id"], assigned_by=staff["id"])
    r = await client.get(f"{BASE}/{tid}", headers=staff["headers"])
    assert r.status_code == 200  # nhánh assigned_by = mình


async def test_staff_get_unrelated_task_returns_404(client, staff, admin, manager, db):
    tid = await _seed(db, assigned_to=admin["id"], assigned_by=manager["id"])
    r = await client.get(f"{BASE}/{tid}", headers=staff["headers"])
    assert r.status_code == 404
    assert "không tồn tại" in r.json()["detail"]


async def test_admin_get_any_task_ok(client, admin, staff, manager, db):
    tid = await _seed(db, assigned_to=staff["id"], assigned_by=manager["id"])
    r = await client.get(f"{BASE}/{tid}", headers=admin["headers"])
    assert r.status_code == 200


async def test_viewer_get_unrelated_task_ok(client, viewer, staff, manager, db):
    """viewer nằm trong TASK_VIEW_ALL_ROLES -> xem được task không liên quan mình,
    khác hẳn staff (404). Khoá hành vi thiết kế này bằng test tường minh."""
    tid = await _seed(db, assigned_to=staff["id"], assigned_by=manager["id"])
    r = await client.get(f"{BASE}/{tid}", headers=viewer["headers"])
    assert r.status_code == 200
    assert r.json()["data"]["id"] == tid


async def test_role_outside_allowed_get_forbidden(client, accountant, staff, manager, db):
    """accountant không nằm trong allowed_roles -> 403 ở tầng require_role, trước cả
    khi chạm ownership filter trong WHERE."""
    tid = await _seed(db, assigned_to=staff["id"], assigned_by=manager["id"])
    r = await client.get(f"{BASE}/{tid}", headers=accountant["headers"])
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "INSUFFICIENT_PERMISSIONS"


# ---------------------------------------------------------------------------
# PUT /{id} — staff không có quyền sửa (role-level qua require_role), bất kể
# task có liên quan mình hay không. Chốt hành vi bằng automation, tránh regression.
# ---------------------------------------------------------------------------

async def test_staff_put_unrelated_task_forbidden(client, staff, admin, manager, db):
    tid = await _seed(db, assigned_to=admin["id"], assigned_by=manager["id"])
    r = await client.put(f"{BASE}/{tid}", headers=staff["headers"], json={"status": "completed"})
    assert r.status_code == 403
    assert r.json()["detail"]["error"] == "INSUFFICIENT_PERMISSIONS"


async def test_staff_put_own_task_still_forbidden(client, staff, manager, db):
    tid = await _seed(db, assigned_to=staff["id"], assigned_by=manager["id"])
    r = await client.put(f"{BASE}/{tid}", headers=staff["headers"], json={"status": "completed"})
    assert r.status_code == 403
