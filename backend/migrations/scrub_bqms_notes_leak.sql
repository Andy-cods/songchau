-- Bảo mật (Thang 2026-06-28): importer BQMS từng ghi số RFQ Samsung nội bộ vào
-- procurement_rfq_items.notes ("Từ BQMS RFQ {rfq_number}") — cột này VENDOR-VISIBLE
-- (SELECT ở public_bid.py + vendor/batches.py) nên đã lộ ra cổng NCC. Code đã sửa
-- để ghi notes=NULL; câu lệnh này dọn các dòng CŨ đã lỡ ghi. Nguồn gốc vẫn còn ở
-- source_bqms_rfq_id (item) + source_bqms_rfq_number (batch), cả hai admin-only.
-- Idempotent.

UPDATE procurement_rfq_items
   SET notes = NULL
 WHERE source_kind = 'bqms'
   AND notes LIKE 'Từ BQMS RFQ%';
