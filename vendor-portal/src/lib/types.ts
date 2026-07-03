// Shared vendor-portal domain types (mirror of contract vendor_endpoints).

export interface InvitedBatch {
  id: number;
  batch_code: string;
  title: string;
  description?: string | null;
  status: string;
  item_count: number;
  published_at?: string | null;
  created_at?: string | null;
  invited_at?: string | null;
  viewed_at?: string | null;
  quoted_at?: string | null;
  inv_status?: string | null;
  my_quote_count: number;
  bid_deadline?: string | null;
  current_round?: number | null;
  award_mode?: string | null; // M2 — cơ chế chốt (per_item / per_batch)
}

export interface BatchItem {
  id: number;
  item_no: number;
  specification: string;
  bqms_code?: string | null;
  quantity: number;
  unit?: string | null;
  required_material?: string | null;
  drawing_url?: string | null;
  drawing_filename?: string | null;
  dimension?: string | null;
  maker?: string | null;
  part_no?: string | null;
  moq?: string | null;
  // target_price (giá mục tiêu bên mua) KHÔNG bao giờ trả ra cổng NCC — đã xóa
  // khỏi SELECT ở batches.py (bảo mật đấu thầu).
  product_name?: string | null;
  model?: string | null;
  notes?: string | null;
  // File Song Châu CHIA SẺ cho mã này (admin tick). Chỉ tên + kind, KHÔNG rfq_number.
  shared_files?: { kind: string; file_name: string }[];
}

export interface MyQuoteItem {
  item_id: number;
  unit_price: number | string;
  quantity?: number | string | null;
  offered_qty?: number | string | null;
  moq?: string | null;
  lead_time_days?: number | null;
  currency?: string | null;
  notes?: string | null;
  can_do?: boolean | null;
  free_charge?: boolean | null;
  attachment_paths?: string[] | null;
}

export interface MyQuote {
  id: number;
  currency: string;
  total_amount?: number | null;
  status: string;
  round_number?: number | null;
  submitted_at?: string | null;
  lead_time_days?: number | null;
  moq_notes?: string | null;
  notes?: string | null;
  valid_until?: string | null;
  // Đợt sau-demo: link tham khảo (URL) + read-back file cấp-phiếu mình đã gửi.
  external_url?: string | null;
  has_attachment?: boolean;
  attachment_filename?: string | null;
  // #16-P2 — set khi NCC tự thu hồi báo giá (status='withdrawn').
  withdrawn_at?: string | null;
  withdraw_reason?: string | null;
  items?: MyQuoteItem[];
}

export interface BatchDetail {
  id: number;
  batch_code: string;
  title: string;
  description?: string | null;
  status: string;
  award_mode?: string | null;
  item_count: number;
  current_round?: number | null;
  bid_deadline?: string | null;
  deadline_round1?: string | null;
  deadline_round2?: string | null;
  deadline_round3?: string | null;
  req_name?: string | null;
  requester?: string | null;
  department?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  inv_status?: string | null;
  invited_at?: string | null;
  viewed_at?: string | null;
  declined_at?: string | null;
  decline_reason?: string | null;
  items: BatchItem[];
  my_quote: MyQuote | null;
}

// Previous-round prefill payload (GET /api/vendor/quotes/batches/{id}/prefill).
// Đợt-2 reverse auction: seeds the revise form with the vendor's prior-round prices.
export interface PrefillItem {
  item_id: number;
  unit_price: number | string | null;
  quantity?: number | string | null;
  offered_qty?: number | string | null;
  moq?: string | null;
  lead_time_days?: number | null;
  currency?: string | null;
  notes?: string | null;
  can_do?: boolean | null;
  free_charge?: boolean | null;
  attachment_paths?: string[] | null;
}

export interface PrefillData {
  round: number;
  prev_round: number;
  items: PrefillItem[];
}

export interface MyQuoteRow {
  id: number;
  batch_id: number;
  batch_code: string;
  title: string;
  currency: string;
  total_amount: number;
  status: string;
  round_number?: number | null;
  submitted_at: string;
  lead_time_days?: number | null;
  batch_status?: string | null;
  item_count?: number | null;
  inv_status?: string | null;
  bid_deadline?: string | null; // M2 — hạn nộp của đợt
  valid_until?: string | null;  // M2 — hiệu lực báo giá đến
}

// ── Scorecard / Năng lực (Wave D) ───────────────────────────────────────────
// Self-only vendor scorecard from GET /api/vendor/scorecard. SECURITY: this type
// declares ONLY the vendor's own ABSOLUTE metrics — there is intentionally NO
// price_score / lead / win_rate / rank / prev_rank / score / target_price /
// competitor field, so the FE has no path to ever render a competitive number
// (defense-in-depth). The backend mirrors this and never emits those keys.
export interface MyScorecardAward {
  award_id: number;
  batch_code: string;
  batch_title: string;
  bqms_code: string | null;
  awarded_price: number | null;
  currency: string;
  quantity: number | null;
  awarded_at: string;
}

export interface MyScorecard {
  // Letter grade only (no numeric score). null = chưa đủ dữ liệu / chưa xếp hạng.
  grade: 'A' | 'B' | 'C' | null;
  insufficient: boolean;
  on_time_rate: number | null;
  on_time_ok: number;
  on_time_n: number;
  quality_rate: number | null;
  quality_ok: number;
  quality_n: number;
  response_rate: number | null;
  response_submitted: number;
  response_n: number;
  months: number;
  recent_awards: MyScorecardAward[];
}

export interface MyScorecardResponse {
  data: MyScorecard;
}

// ── Notifications (Đợt 6) ───────────────────────────────────────────────────
// Row shape from GET /api/vendor/notifications. Mirrors the vendor-notif backend
// (app/api/vendor/notifications.py): SELECT id, type, title, body, ref_type,
// ref_id, is_read, read_at, created_at. `body` is the message text; `ref_type`
// + `ref_id` are the optional deep-link target (e.g. a batch -> /rfq/{ref_id}).
export interface VendorNotification {
  id: number;
  type?: string | null;
  title: string;
  body?: string | null;
  ref_type?: string | null;
  ref_id?: number | null;
  // Đợt 1 (BE-4): producer stamps the entity ids here (dispatch_procurement_event
  // detail → metadata jsonb). Lets the deep-link resolver jump to the real entity
  // (/contracts/{id}, /orders/{po_id}) instead of just the section list. Optional:
  // older rows / a pre-BE-4 backend won't have it, so notificationLink falls back.
  metadata?: {
    batch_id?: number;
    contract_id?: number;
    po_id?: number;
    [k: string]: unknown;
  } | null;
  is_read: boolean;
  read_at?: string | null;
  created_at?: string | null;
}

export interface NotificationsResponse {
  data: VendorNotification[];
  unread_count: number;
}

// ── Contracts (procurement_contracts / procurement_contract_items) ──────────
// status is TEXT+CHECK on the backend: draft|sent|signed|active|completed|cancelled.
// Drafts are never exposed to the vendor (backend filters them out).
export type ContractStatus =
  | 'draft'
  | 'sent'
  | 'signed'
  | 'active'
  | 'completed'
  | 'cancelled';

// Row shape from GET /api/vendor/contracts.
export interface ContractRow {
  id: number;
  contract_no: string;
  batch_code?: string | null;
  total_amount?: number | null;
  currency?: string | null;
  status: string;
  // sent timestamp column is sent_to_vendor_at (NOT sent_at) — honor the cross-agent contract.
  sent_to_vendor_at?: string | null;
  signed_at?: string | null;
  item_count?: number | null;
}

export interface ContractItem {
  id: number;
  item_no: number;
  bqms_code?: string | null;
  specification: string;
  quantity?: number | string | null;
  unit?: string | null;
  unit_price?: number | string | null;
  total_price?: number | string | null;
  lead_time_days?: number | null;
  notes?: string | null;
}

// ── Orders / Purchase orders (procurement_pos / procurement_po_items /
//    procurement_deliveries) ───────────────────────────────────────────────
// status is TEXT+CHECK on the backend:
//   draft|open|partially_delivered|delivered|closed|cancelled.
// Drafts may never reach the vendor, but kept here so an unexpected value still renders.
export type PoStatus =
  | 'draft'
  | 'open'
  | 'partially_delivered'
  | 'delivered'
  | 'closed'
  | 'cancelled';

// Delivery status (procurement_deliveries.status CHECK).
export type DeliveryStatus =
  | 'pending'
  | 'shipping'
  | 'arrived'
  | 'received'
  | 'rejected'
  | 'returned';

// Row shape from GET /api/vendor/pos.
export interface VendorPo {
  id: number;
  po_no: string;
  contract_no?: string | null;
  po_date?: string | null;
  requested_delivery_date?: string | null;
  total_amount?: number | null;
  currency?: string | null;
  status: string;
  item_count?: number | null;
  // 0–100 server-computed delivered percentage across all PO items.
  delivered_pct?: number | null;
}

export interface VendorPoItem {
  id: number;
  item_no: number;
  bqms_code?: string | null;
  specification: string;
  ordered_qty: number | string;
  delivered_qty: number | string;
  unit?: string | null;
  unit_price?: number | string | null;
  total_price?: number | string | null;
}

// Delivery row embedded in PO detail / GET /api/vendor/deliveries.
export interface VendorDeliveryDoc {
  name: string;
  path?: string;
  size?: number;
}

export interface VendorDelivery {
  id?: number;
  delivery_no: string;
  po_no?: string | null;
  delivered_at?: string | null;
  delivery_method?: string | null;
  tracking_no?: string | null;
  status: string;
  // Đợt 8 #6 — chứng từ CO/CQ NCC upload (JSONB; server có thể trả mảng hoặc chuỗi).
  documents?: VendorDeliveryDoc[] | string | null;
}

// Detail shape from GET /api/vendor/pos/{id}.
export interface VendorPoDetail {
  id: number;
  po_no: string;
  contract_no?: string | null;
  po_date?: string | null;
  requested_delivery_date?: string | null;
  actual_delivery_date?: string | null;
  total_amount?: number | null;
  currency?: string | null;
  status: string;
  payment_status?: string | null;
  delivery_address?: string | null;
  vendor_name?: string | null;
  created_at?: string | null;
  // Đợt 9 #3 — NCC xác nhận đã nhận đơn (cột timestamp riêng, KHÔNG phải status).
  acknowledged_at?: string | null;
  acknowledged_by?: number | null;
  ack_note?: string | null;
  items: VendorPoItem[];
  deliveries: VendorDelivery[];
}

// Detail shape from GET /api/vendor/contracts/{id}.
export interface ContractDetail {
  id: number;
  contract_no: string;
  batch_code?: string | null;
  vendor_name?: string | null;
  vendor_email?: string | null;
  vendor_phone?: string | null;
  vendor_tax_code?: string | null;
  vendor_address?: string | null;
  total_amount?: number | null;
  currency?: string | null;
  status: string;
  payment_terms?: string | null;
  delivery_terms?: string | null;
  warranty_terms?: string | null;
  contract_date?: string | null;
  effective_date?: string | null;
  expiry_date?: string | null;
  sent_to_vendor_at?: string | null;
  signed_at?: string | null;
  signed_by_vendor?: string | null;
  contract_file_path?: string | null;
  pdf_generated_at?: string | null;
  notes?: string | null;
  items: ContractItem[];
}

// Đợt 2a #12 — Hỏi đáp / Phụ lục. Một tin trong thread của CHÍNH NCC này (kind
// question|answer) hoặc một phụ lục broadcast của đợt (kind addendum). BE KHÔNG
// trả author_admin_id/giá/tên đối thủ — author chỉ là 'vendor' (bạn) | 'admin'
// (Song Châu).
export interface RfqMessage {
  id: number;
  kind: 'question' | 'answer' | 'addendum';
  author: 'vendor' | 'admin';
  body: string;
  attachments: string[];
  created_at: string;
}
