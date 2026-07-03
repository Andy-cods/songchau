"""W2-11 — Cache-Control CHỌN LỌC cho ảnh BQMS/thumbnail (Thang 2026-07-03).

Bug: app/main.py `security_headers` middleware (line ~261) ép
`Cache-Control: no-store` lên MỌI response — kể cả sau khi 1 endpoint ảnh đã
tự đặt header riêng — vì middleware chạy SAU route handler và ghi đè vô điều
kiện. Hệ quả: trang /bqms phải tải lại toàn bộ ảnh mỗi lần vào (mỗi hàng lưới
gọi GET /api/v1/bqms/rfq/image — xem frontend BqmsImageThumb.tsx).

Fix (2 lớp, cả 2 đều test ở đây):
  1. Middleware CHỈ bỏ qua việc ép no-store khi response là ảnh
     (Content-Type: image/*) VÀ chính endpoint đã tự đặt Cache-Control — tức
     endpoint phải CHỦ ĐỘNG "xin" cache (không có cache ngầm mặc định).
  2. 2 endpoint ảnh nóng nhất (`/rfq/image`, `/code/{code}/image-blob`) đặt
     `Cache-Control: private, max-age=86400` + ETag content-derived
     (path+mtime+size[+bqms_code]) — `private` (KHÔNG `public`) để proxy/CDN
     dùng chung không được cache, chỉ trình duyệt của đúng người dùng đó.

Bất biến PHẢI giữ (test ở đây):
  - RBAC (require_role) chạy TRƯỚC khi ảnh được resolve/trả về — kể cả với
    request có If-None-Match (304) — nên 403/401 luôn xảy ra trước khi có
    bất kỳ byte ảnh nào rời server. Không có "cache bypass auth".
  - JSON/API khác (không phải ảnh) tiếp tục bị ép no-store y như trước —
    không đổi hành vi, không rò dữ liệu nội bộ qua cache.
  - 404 "chưa có ảnh" (dùng cho auto-retry ở FE) vẫn no-store — không cache
    nhầm câu trả lời "chưa có ảnh" trong lúc crawler đang index.
"""
from __future__ import annotations

import os
import time

import pytest

pytestmark = pytest.mark.smoke

BQMS = "/api/v1/bqms"


def _write_fake_image(path) -> None:
    """Tạo 1 file .png giả (bytes bất kỳ) — FileResponse chỉ stream bytes và
    suy Content-Type từ đuôi file, không cần nội dung PNG hợp lệ cho path
    non-normalize (path duy nhất decode PNG thật là ?normalize=1, không dùng
    trong các test này).
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\nFAKE-IMAGE-BYTES-FOR-TEST-W2-11")


# ─── Ảnh: /code/{code}/image-blob (lưới ảnh trong picker modal) ───────────


async def test_image_blob_has_private_cache_and_etag(client, admin, monkeypatch, tmp_path):
    import app.api.v1.bqms_images as bqms_images_mod
    monkeypatch.setattr(bqms_images_mod, "_CODE_OVERRIDE_ROOT", tmp_path)

    img = tmp_path / "TESTCODE001" / "photo.png"
    _write_fake_image(img)

    r = await client.get(
        f"{BQMS}/code/TESTCODE001/image-blob",
        params={"path": str(img)},
        headers=admin["headers"],
    )
    assert r.status_code == 200, r.text
    cc = r.headers.get("cache-control", "")
    assert "max-age=86400" in cc, cc
    assert "private" in cc, cc
    assert "public" not in cc, f"KHÔNG được có public (chống proxy/CDN cache chung): {cc}"
    assert r.headers.get("etag"), "Thiếu ETag trên response ảnh"


async def test_image_blob_conditional_304_on_etag_match(client, admin, monkeypatch, tmp_path):
    import app.api.v1.bqms_images as bqms_images_mod
    monkeypatch.setattr(bqms_images_mod, "_CODE_OVERRIDE_ROOT", tmp_path)

    img = tmp_path / "TESTCODE002" / "photo.png"
    _write_fake_image(img)

    r1 = await client.get(
        f"{BQMS}/code/TESTCODE002/image-blob",
        params={"path": str(img)},
        headers=admin["headers"],
    )
    assert r1.status_code == 200, r1.text
    etag = r1.headers["etag"]

    r2 = await client.get(
        f"{BQMS}/code/TESTCODE002/image-blob",
        params={"path": str(img)},
        headers={**admin["headers"], "If-None-Match": etag},
    )
    assert r2.status_code == 304, r2.text
    assert r2.content == b""
    # 304 vẫn phải đi qua RBAC — thử lại KHÔNG có token phải 401, KHÔNG 304.
    r3 = await client.get(
        f"{BQMS}/code/TESTCODE002/image-blob",
        params={"path": str(img)},
        headers={"If-None-Match": etag},
    )
    assert r3.status_code == 401, r3.text


async def test_image_blob_etag_changes_when_file_content_changes(client, admin, monkeypatch, tmp_path):
    """Ảnh pinned bị đổi (re-crop/re-upload ghi đè file) -> ETag đổi theo ->
    KHÔNG bị 304 trả nhầm ảnh cũ. Đây là cơ chế đảm bảo ảnh mới hiện ra thay
    vì bị 'shadow' bởi response cache cũ.
    """
    import app.api.v1.bqms_images as bqms_images_mod
    monkeypatch.setattr(bqms_images_mod, "_CODE_OVERRIDE_ROOT", tmp_path)

    img = tmp_path / "TESTCODE003" / "photo.png"
    _write_fake_image(img)
    r1 = await client.get(
        f"{BQMS}/code/TESTCODE003/image-blob",
        params={"path": str(img)}, headers=admin["headers"],
    )
    etag1 = r1.headers["etag"]

    time.sleep(0.01)
    img.write_bytes(b"COMPLETELY-DIFFERENT-BYTES-NEW-PIN")
    os.utime(img, None)  # đảm bảo mtime nhích (phòng khi fs mtime resolution thô)

    r2 = await client.get(
        f"{BQMS}/code/TESTCODE003/image-blob",
        params={"path": str(img)},
        headers={**admin["headers"], "If-None-Match": etag1},
    )
    assert r2.status_code == 200, "ETag cũ không còn khớp -> phải trả 200 (ảnh mới), không 304"
    assert r2.headers["etag"] != etag1
    assert r2.content == b"COMPLETELY-DIFFERENT-BYTES-NEW-PIN"


async def test_image_blob_forbidden_role_gets_403_no_image_leak(client, vendor, monkeypatch, tmp_path):
    """RBAC chặn TRƯỚC khi ảnh được resolve — role không đủ quyền (vendor
    không nằm trong allow-list của endpoint này) vẫn 403, và response 403
    KHÔNG được là ảnh (không rò byte ảnh giữa user/role).
    """
    import app.api.v1.bqms_images as bqms_images_mod
    monkeypatch.setattr(bqms_images_mod, "_CODE_OVERRIDE_ROOT", tmp_path)

    img = tmp_path / "TESTCODE004" / "photo.png"
    _write_fake_image(img)

    r = await client.get(
        f"{BQMS}/code/TESTCODE004/image-blob",
        params={"path": str(img)},
        headers=vendor["headers"],
    )
    assert r.status_code == 403, r.text
    ctype = r.headers.get("content-type", "")
    assert not ctype.startswith("image/"), f"403 làm rò ảnh! content-type={ctype}"
    assert r.headers.get("cache-control", "").startswith("no-store"), (
        "Response 403 (JSON lỗi) phải giữ no-store — không cache lỗi phân quyền"
    )


async def test_image_blob_no_token_401_no_leak(client, tmp_path, monkeypatch):
    import app.api.v1.bqms_images as bqms_images_mod
    monkeypatch.setattr(bqms_images_mod, "_CODE_OVERRIDE_ROOT", tmp_path)
    img = tmp_path / "TESTCODE005" / "photo.png"
    _write_fake_image(img)

    r = await client.get(f"{BQMS}/code/TESTCODE005/image-blob", params={"path": str(img)})
    assert r.status_code == 401, r.text
    assert not r.headers.get("content-type", "").startswith("image/")


# ─── Ảnh nóng nhất: /rfq/image — 1 request/hàng lưới trang /bqms ──────────


async def test_rfq_image_has_private_cache_and_etag(client, admin, monkeypatch, tmp_path):
    import app.etl.bqms_bidding_scraper as scraper_mod
    monkeypatch.setattr(scraper_mod, "RFQ_ROOT", tmp_path)

    from datetime import datetime
    now = datetime.now()
    rfq_number = "QT99999999"
    bqms_code = "Z0000002-999999"
    img_path = tmp_path / f"RFQ {now.year}" / f"THANG {now.month}" / rfq_number / "images" / f"{bqms_code}_1.png"
    _write_fake_image(img_path)

    r = await client.get(
        f"{BQMS}/rfq/image",
        params={"bqms_code": bqms_code, "rfq_number": rfq_number},
        headers=admin["headers"],
    )
    assert r.status_code == 200, r.text
    cc = r.headers.get("cache-control", "")
    assert "max-age=86400" in cc and "private" in cc, cc
    assert "public" not in cc, cc
    assert r.headers.get("etag"), "Thiếu ETag trên /rfq/image"


async def test_rfq_image_not_found_stays_no_store(client, admin, monkeypatch, tmp_path):
    """Chưa có ảnh (404) -> KHÔNG cache -> FE auto-retry (BqmsImageThumb) sau
    khi inline-indexer chạy xong sẽ thấy ảnh ngay, không bị 404 cũ che mất.
    """
    import app.etl.bqms_bidding_scraper as scraper_mod
    monkeypatch.setattr(scraper_mod, "RFQ_ROOT", tmp_path)

    r = await client.get(
        f"{BQMS}/rfq/image",
        params={"bqms_code": "Z0000002-NOTFOUND", "rfq_number": "QT00000000"},
        headers=admin["headers"],
    )
    assert r.status_code == 404, r.text
    assert r.headers.get("cache-control", "").startswith("no-store")


async def test_rfq_image_forbidden_role_no_leak(client, vendor, monkeypatch, tmp_path):
    import app.etl.bqms_bidding_scraper as scraper_mod
    monkeypatch.setattr(scraper_mod, "RFQ_ROOT", tmp_path)

    from datetime import datetime
    now = datetime.now()
    rfq_number = "QT88888888"
    bqms_code = "Z0000002-888888"
    img_path = tmp_path / f"RFQ {now.year}" / f"THANG {now.month}" / rfq_number / "images" / f"{bqms_code}_1.png"
    _write_fake_image(img_path)

    r = await client.get(
        f"{BQMS}/rfq/image",
        params={"bqms_code": bqms_code, "rfq_number": rfq_number},
        headers=vendor["headers"],
    )
    assert r.status_code == 403, r.text
    assert not r.headers.get("content-type", "").startswith("image/")


# ─── JSON/API khác: GIỮ NGUYÊN no-store — không đổi hành vi ───────────────


async def test_health_json_stays_no_store(client):
    r = await client.get("/api/health")
    assert r.status_code == 200, r.text
    cc = r.headers.get("cache-control", "")
    assert "no-store" in cc, cc
    assert "max-age" not in cc, f"JSON không được có max-age: {cc}"


async def test_users_json_requires_auth_and_no_store(client):
    """/api/v1/users (JSON, không phải ảnh) — vẫn 401 khi thiếu token, vẫn
    no-store dù middleware giờ đã CHỌN LỌC cho ảnh.
    """
    r = await client.get("/api/v1/users")
    assert r.status_code == 401, r.text
    assert r.headers.get("cache-control", "").startswith("no-store")
