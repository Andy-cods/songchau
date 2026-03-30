"""
BQMS Service — business logic for Samsung BQMS operations.

Coordinates between the Samsung API client, PDF parser, Excel writer,
and the database (asyncpg raw SQL).
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone
from typing import Any

import asyncpg

from app.core.config import settings
from app.etl.samsung_bqms_client import (
    BQMSAPIError,
    BQMSAuthError,
    BQMSError,
    SamsungBQMSClient,
)
from app.utils.excel_writer import generate_quotation_files
from app.utils.pdf_parser import RFQItem, RFQParseResult, parse_samsung_rfq_pdf

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class BQMSService:
    """
    Orchestrates BQMS operations: PO sync, RFQ parsing, quotation generation,
    and submission workflows.
    """

    # -- PO Sync ----------------------------------------------------------

    async def sync_po_list(
        self,
        conn: asyncpg.Connection,
        date_from: date,
        date_to: date,
    ) -> dict[str, Any]:
        """
        Sync PO list from Samsung BQMS portal into bqms_samsung_po and bqms_records.

        Returns:
            Summary dict with inserted, updated, skipped counts and any errors.
        """
        logger.info(
            "BQMS sync bắt đầu: %s → %s",
            date_from.isoformat(),
            date_to.isoformat(),
        )

        # Create sync log entry
        sync_id = await conn.fetchval(
            """
            INSERT INTO etl_sync_log (sync_type, source_file, status)
            VALUES ('bqms_po', $1, 'running')
            RETURNING id
            """,
            f"Samsung API {date_from} - {date_to}",
        )

        inserted = 0
        updated = 0
        skipped = 0
        errors: list[str] = []

        try:
            async with SamsungBQMSClient() as client:
                await client.login()
                records = await client.get_po_list(date_from, date_to)

            logger.info("BQMS sync: nhận %d records từ Samsung", len(records))

            for record in records:
                try:
                    result = await self._upsert_po_record(conn, record)
                    if result == "inserted":
                        inserted += 1
                    elif result == "updated":
                        updated += 1
                    else:
                        skipped += 1
                except Exception as e:
                    po_no = record.get("poNo") or record.get("po_no") or "unknown"
                    logger.error("Lỗi xử lý PO %s: %s", po_no, e)
                    errors.append(f"PO {po_no}: {e}")
                    skipped += 1

            status = "success" if not errors else "error"

        except BQMSAuthError as e:
            logger.error("BQMS sync auth failed: %s", e)
            errors.append(f"Lỗi xác thực: {e}")
            status = "error"
        except BQMSAPIError as e:
            logger.error("BQMS sync API error: %s", e)
            errors.append(f"Lỗi API: {e}")
            status = "error"
        except Exception as e:
            logger.exception("BQMS sync unexpected error")
            errors.append(f"Lỗi không xác định: {e}")
            status = "error"

        # Update sync log
        await conn.execute(
            """
            UPDATE etl_sync_log
            SET completed_at = NOW(), status = $1,
                rows_inserted = $2, rows_updated = $3, rows_skipped = $4,
                error_message = $5
            WHERE id = $6
            """,
            status,
            inserted,
            updated,
            skipped,
            "\n".join(errors) if errors else None,
            sync_id,
        )

        summary = {
            "sync_id": sync_id,
            "status": status,
            "total_records": len(records) if "records" in dir() else 0,
            "inserted": inserted,
            "updated": updated,
            "skipped": skipped,
            "errors": errors,
        }

        logger.info("BQMS sync hoàn tất: %s", summary)
        return summary

    async def _upsert_po_record(
        self,
        conn: asyncpg.Connection,
        record: dict[str, Any],
    ) -> str:
        """
        Upsert a single PO record from Samsung API into bqms_samsung_po and bqms_records.

        Returns:
            "inserted", "updated", or "skipped".
        """
        # Samsung API field mapping (Samsung uses camelCase)
        po_no = (record.get("poNo") or record.get("po_no") or "").strip()
        if not po_no:
            return "skipped"

        po_date_str = record.get("poDate") or record.get("po_date")
        po_date = self._parse_api_date(po_date_str)

        # Upsert into bqms_samsung_po
        existing = await conn.fetchval(
            "SELECT id FROM bqms_samsung_po WHERE po_number = $1", po_no
        )

        import json

        if existing:
            await conn.execute(
                """
                UPDATE bqms_samsung_po
                SET po_date = COALESCE($2, po_date),
                    po_seq = COALESCE($3, po_seq),
                    request_no = COALESCE($4, request_no),
                    specification = COALESCE($5, specification),
                    maker = COALESCE($6, maker),
                    order_qty = COALESCE($7, order_qty),
                    unit_price = COALESCE($8, unit_price),
                    amount = COALESCE($9, amount),
                    buyer_name = COALESCE($10, buyer_name),
                    buyer_email = COALESCE($11, buyer_email),
                    company = COALESCE($12, company),
                    plant = COALESCE($13, plant),
                    bqms_code = COALESCE($14, bqms_code),
                    preferred_delivery_date = COALESCE($15, preferred_delivery_date),
                    raw_data = $16,
                    synced_at = NOW(),
                    updated_at = NOW()
                WHERE id = $17
                """,
                po_date,
                record.get("poSeq") or record.get("po_seq"),
                record.get("reqNo") or record.get("request_no"),
                record.get("spec") or record.get("specification"),
                record.get("maker"),
                self._parse_numeric(record.get("orderQty") or record.get("order_qty")),
                self._parse_numeric(record.get("unitPrice") or record.get("unit_price")),
                self._parse_numeric(record.get("amount")),
                record.get("buyerName") or record.get("buyer_name"),
                record.get("buyerEmail") or record.get("buyer_email"),
                record.get("company"),
                record.get("plant"),
                record.get("itemCode") or record.get("bqms_code"),
                self._parse_api_date(
                    record.get("deliveryDate") or record.get("preferred_delivery_date")
                ),
                json.dumps(record, ensure_ascii=False, default=str),
                existing,
            )
            result = "updated"
        else:
            await conn.execute(
                """
                INSERT INTO bqms_samsung_po (
                    po_number, po_date, po_seq, request_no, specification, maker,
                    order_qty, unit_price, amount, buyer_name, buyer_email,
                    company, plant, bqms_code, preferred_delivery_date,
                    raw_data, synced_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    $7, $8, $9, $10, $11,
                    $12, $13, $14, $15,
                    $16, NOW()
                )
                """,
                po_no,
                po_date,
                record.get("poSeq") or record.get("po_seq"),
                record.get("reqNo") or record.get("request_no"),
                record.get("spec") or record.get("specification"),
                record.get("maker"),
                self._parse_numeric(record.get("orderQty") or record.get("order_qty")),
                self._parse_numeric(record.get("unitPrice") or record.get("unit_price")),
                self._parse_numeric(record.get("amount")),
                record.get("buyerName") or record.get("buyer_name"),
                record.get("buyerEmail") or record.get("buyer_email"),
                record.get("company"),
                record.get("plant"),
                record.get("itemCode") or record.get("bqms_code"),
                self._parse_api_date(
                    record.get("deliveryDate") or record.get("preferred_delivery_date")
                ),
                json.dumps(record, ensure_ascii=False, default=str),
            )
            result = "inserted"

        # Also upsert into bqms_records (PO sync tracking)
        secure_key = record.get("secureKey") or record.get("secure_key") or ""
        req_no = record.get("reqNo") or record.get("request_no") or ""
        delivery_date = self._parse_api_date(
            record.get("deliveryDate") or record.get("preferred_delivery_date")
        )

        existing_rec = await conn.fetchval(
            "SELECT id FROM bqms_records WHERE po_no = $1", po_no
        )
        if not existing_rec:
            await conn.execute(
                """
                INSERT INTO bqms_records (
                    po_no, req_no, item_code, specification, manufacturer,
                    receiver_name, req_delivery_date, po_qty, secure_key,
                    raw_data, sync_status, synced_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', NOW())
                """,
                po_no,
                req_no,
                record.get("itemCode") or record.get("bqms_code") or "",
                record.get("spec") or record.get("specification") or "",
                record.get("maker") or "",
                record.get("recipientName") or record.get("recipient_name") or "",
                delivery_date,
                self._parse_int(record.get("orderQty") or record.get("order_qty")),
                secure_key,
                json.dumps(record, ensure_ascii=False, default=str),
            )

        return result

    # -- RFQ PDF Parsing --------------------------------------------------

    async def parse_rfq_pdf(
        self,
        conn: asyncpg.Connection,
        file_bytes: bytes,
        filename: str,
    ) -> dict[str, Any]:
        """
        Parse an uploaded RFQ PDF and return structured items.

        Does NOT persist to DB — that happens when the user confirms and submits.

        Returns:
            Dict with parsed items and metadata.
        """
        logger.info("Phân tích RFQ PDF: %s (%d bytes)", filename, len(file_bytes))

        try:
            result: RFQParseResult = parse_samsung_rfq_pdf(file_bytes)
        except ValueError as e:
            logger.warning("PDF parse failed for %s: %s", filename, e)
            return {
                "success": False,
                "error": str(e),
                "filename": filename,
            }

        # Convert items to dicts
        items_data: list[dict[str, Any]] = []
        for item in result.items:
            items_data.append({
                "line_number": item.line_number,
                "bqms_code": item.bqms_code,
                "product_name": item.product_name,
                "specification": item.specification,
                "maker": item.maker,
                "quantity": item.quantity,
                "unit": item.unit,
                "deadline": item.deadline.isoformat() if item.deadline else None,
                "part_no": item.part_no,
                "remark": item.remark,
            })

        # Attempt to match bqms_codes to existing products
        if items_data:
            codes = [it["bqms_code"] for it in items_data if it["bqms_code"]]
            if codes:
                existing = await conn.fetch(
                    """
                    SELECT bqms_code, id, product_name, specification
                    FROM products
                    WHERE bqms_code = ANY($1::text[])
                    """,
                    codes,
                )
                product_map = {r["bqms_code"]: dict(r) for r in existing}

                for item in items_data:
                    matched = product_map.get(item["bqms_code"])
                    if matched:
                        item["product_id"] = matched["id"]
                        item["matched"] = True
                    else:
                        item["product_id"] = None
                        item["matched"] = False

        return {
            "success": True,
            "filename": filename,
            "rfq_number": result.rfq_number,
            "req_no": result.req_no,
            "vendor_code": result.vendor_code,
            "submission_deadline": (
                result.submission_deadline.isoformat()
                if result.submission_deadline
                else None
            ),
            "page_count": result.page_count,
            "items_count": len(items_data),
            "items": items_data,
            "raw_text_preview": result.raw_text[:500] if result.raw_text else "",
        }

    # -- Quotation Generation ---------------------------------------------

    async def generate_quotation(
        self,
        conn: asyncpg.Connection,
        submission_id: int,
    ) -> dict[str, Any]:
        """
        Generate Excel quotation files (CAM_KET + QUOTATION) from a submission.

        Args:
            conn: Database connection.
            submission_id: bqms_rfq_submissions.id.

        Returns:
            Dict with file paths and status.
        """
        logger.info("Tạo báo giá cho submission #%d", submission_id)

        # Fetch submission metadata
        submission = await conn.fetchrow(
            "SELECT * FROM bqms_rfq_submissions WHERE id = $1",
            submission_id,
        )
        if not submission:
            raise ValueError(f"Không tìm thấy submission #{submission_id}")

        submission = dict(submission)

        if submission["status"] not in ("draft", "pending"):
            raise ValueError(
                f"Submission #{submission_id} đã ở trạng thái '{submission['status']}', "
                f"không thể tạo lại báo giá"
            )

        # Fetch line items
        rows = await conn.fetch(
            """
            SELECT qi.*, p.product_name, p.bqms_code AS product_bqms_code
            FROM bqms_quotation_items qi
            LEFT JOIN products p ON p.id = qi.product_id
            WHERE qi.submission_id = $1
            ORDER BY qi.line_number
            """,
            submission_id,
        )

        if not rows:
            raise ValueError(f"Submission #{submission_id} không có line items")

        items = [dict(r) for r in rows]

        # Build metadata for template
        metadata = {
            "rfq_number": submission["rfq_number"],
            "req_no": submission.get("req_no") or "",
            "submission_date": submission["submission_date"],
            "deadline": submission.get("deadline"),
            "vendor_name": submission.get("vendor_name") or "SONG CHAU TRADING CO., LTD",
            "vendor_tax_code": submission.get("vendor_tax_code") or "",
            "vendor_address": submission.get("vendor_address") or "",
            "currency": "VND",
        }

        # Generate files
        file_results = generate_quotation_files(
            submission_id=submission_id,
            items=items,
            metadata=metadata,
        )

        # Update submission with file paths
        cam_ket_path = file_results.get("cam_ket_path")
        commercial_path = file_results.get("commercial_path")

        await conn.execute(
            """
            UPDATE bqms_rfq_submissions
            SET excel_cam_ket = $1, excel_commercial = $2, updated_at = NOW()
            WHERE id = $3
            """,
            cam_ket_path,
            commercial_path,
            submission_id,
        )

        logger.info(
            "Báo giá đã tạo cho submission #%d: cam_ket=%s, commercial=%s",
            submission_id,
            cam_ket_path or "(failed)",
            commercial_path or "(failed)",
        )

        return {
            "submission_id": submission_id,
            "rfq_number": submission["rfq_number"],
            "cam_ket_path": cam_ket_path,
            "commercial_path": commercial_path,
            "errors": {
                k: v for k, v in file_results.items() if k.endswith("_error")
            },
        }

    # -- Quotation Submission (Workflow) ----------------------------------

    async def submit_quotation(
        self,
        conn: asyncpg.Connection,
        submission_id: int,
        user_id: str,
    ) -> dict[str, Any]:
        """
        Submit a quotation for approval — creates a workflow instance.

        Args:
            conn: Database connection.
            submission_id: bqms_rfq_submissions.id.
            user_id: UUID of the submitting user.

        Returns:
            Dict with workflow info and updated submission status.
        """
        logger.info("Submit báo giá #%d bởi user %s", submission_id, user_id)

        # Validate submission
        submission = await conn.fetchrow(
            "SELECT * FROM bqms_rfq_submissions WHERE id = $1",
            submission_id,
        )
        if not submission:
            raise ValueError(f"Không tìm thấy submission #{submission_id}")

        submission = dict(submission)

        if submission["status"] != "draft":
            raise ValueError(
                f"Chỉ có thể submit từ trạng thái 'draft', "
                f"hiện tại là '{submission['status']}'"
            )

        # Validate that quotation files exist
        if not submission.get("excel_cam_ket") and not submission.get("excel_commercial"):
            raise ValueError(
                "Chưa tạo file báo giá. Vui lòng tạo file trước khi submit."
            )

        # Calculate total amount for workflow threshold
        total_amount = await conn.fetchval(
            """
            SELECT COALESCE(SUM(amount), 0)
            FROM bqms_quotation_items
            WHERE submission_id = $1
            """,
            submission_id,
        )

        async with conn.transaction():
            # Create workflow instance
            workflow = await conn.fetchrow(
                """
                INSERT INTO workflow_instances (
                    workflow_type, current_status, title, description,
                    amount, currency, ref_type, ref_id, created_by
                ) VALUES (
                    'bqms_quotation', 'pending_l1',
                    $1, $2, $3, 'VND',
                    'bqms_rfq', $4, $5::uuid
                )
                RETURNING *
                """,
                f"Báo giá BQMS - {submission['rfq_number']}",
                f"Phê duyệt báo giá Samsung RFQ {submission['rfq_number']}",
                total_amount,
                submission_id,
                user_id,
            )

            # Record workflow history
            await conn.execute(
                """
                INSERT INTO workflow_history (
                    instance_id, from_status, to_status, action, acted_by, comment
                ) VALUES ($1, 'draft', 'pending_l1', 'submit', $2, NULL)
                """,
                workflow["id"],
                user_id,
            )

            # Update submission status
            await conn.execute(
                """
                UPDATE bqms_rfq_submissions
                SET status = 'pending',
                    workflow_id = $1,
                    submitted_by = $2::uuid,
                    submitted_at = NOW(),
                    updated_at = NOW()
                WHERE id = $3
                """,
                workflow["id"],
                user_id,
                submission_id,
            )

            # Notify managers
            await conn.execute(
                """
                INSERT INTO notifications (recipient_id, type, title, body, link)
                SELECT u.id, 'workflow_request',
                       'Phê duyệt báo giá BQMS',
                       $1,
                       '/bqms/submissions/' || $2::text
                FROM users u
                WHERE u.role IN ('manager', 'admin') AND u.is_active = true
                """,
                f"Báo giá {submission['rfq_number']} cần được phê duyệt",
                submission_id,
            )

        logger.info(
            "Báo giá #%d đã submit, workflow #%d created",
            submission_id,
            workflow["id"],
        )

        return {
            "submission_id": submission_id,
            "workflow_id": workflow["id"],
            "status": "pending",
            "rfq_number": submission["rfq_number"],
            "total_amount": float(total_amount),
            "message": f"Báo giá {submission['rfq_number']} đã được gửi để phê duyệt",
        }

    # -- Get Sync Status --------------------------------------------------

    async def get_sync_status(
        self,
        conn: asyncpg.Connection,
        sync_id: int,
    ) -> dict[str, Any] | None:
        """Get status of a sync job by ID."""
        row = await conn.fetchrow(
            "SELECT * FROM etl_sync_log WHERE id = $1",
            sync_id,
        )
        if not row:
            return None
        return dict(row)

    # -- Helpers ----------------------------------------------------------

    @staticmethod
    def _parse_api_date(value: Any) -> date | None:
        """Parse date from Samsung API (various formats)."""
        if not value:
            return None
        if isinstance(value, date):
            return value
        s = str(value).strip()
        for fmt in ("%Y%m%d", "%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y"):
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
        return None

    @staticmethod
    def _parse_numeric(value: Any) -> float | None:
        """Parse numeric value from Samsung API."""
        if value is None:
            return None
        try:
            return float(str(value).replace(",", ""))
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _parse_int(value: Any) -> int | None:
        """Parse integer value from Samsung API."""
        if value is None:
            return None
        try:
            return int(float(str(value).replace(",", "")))
        except (ValueError, TypeError):
            return None
