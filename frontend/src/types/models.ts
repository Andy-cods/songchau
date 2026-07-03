// ─── User & Auth ────────────────────────────────────────────────

export type UserRole =
  | 'admin'
  | 'director'
  | 'manager'
  | 'accountant'
  | 'warehouse'
  | 'sales'
  | 'viewer';

export interface User {
  id: string;
  email: string;
  full_name: string;
  display_name?: string;
  role: UserRole;
  department?: string;
  avatar_url?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  user: User;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

// ─── Supplier ───────────────────────────────────────────────────

export interface Supplier {
  id: string;
  name: string;
  code: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  address?: string;
  country: string;
  tax_id?: string;
  payment_terms?: string;
  rating?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Purchase Order ─────────────────────────────────────────────

export type POStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'ordered'
  | 'in_transit'
  | 'partial_received'
  | 'received'
  | 'completed'
  | 'cancelled';

export interface PurchaseOrderItem {
  id: string;
  product_name: string;
  product_code?: string;
  specification?: string;
  quantity: number;
  unit: string;
  unit_price: number;
  currency: 'VND' | 'USD' | 'RMB';
  total_price: number;
  notes?: string;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  supplier?: Supplier;
  status: POStatus;
  items: PurchaseOrderItem[];
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  currency: 'VND' | 'USD' | 'RMB';
  payment_terms?: string;
  expected_delivery?: string;
  notes?: string;
  created_by: string;
  created_by_user?: User;
  approved_by?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
}

// ─── Delivery ───────────────────────────────────────────────────

export type DeliveryStatus =
  | 'pending'
  | 'picked_up'
  | 'in_transit'
  | 'customs_clearance'
  | 'delivered'
  | 'completed';

export interface Delivery {
  id: string;
  delivery_number: string;
  purchase_order_id: string;
  purchase_order?: PurchaseOrder;
  status: DeliveryStatus;
  carrier?: string;
  tracking_number?: string;
  estimated_arrival?: string;
  actual_arrival?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// ─── Workflow / Approval ────────────────────────────────────────

export type WorkflowStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'escalated';

export type WorkflowType =
  | 'po_approval'
  | 'payment_approval'
  | 'price_change'
  | 'supplier_onboard';

export interface WorkflowStep {
  id: string;
  step_order: number;
  approver_id: string;
  approver?: User;
  status: WorkflowStatus;
  comment?: string;
  acted_at?: string;
}

export interface Workflow {
  id: string;
  workflow_type: WorkflowType;
  reference_id: string;
  reference_type: string;
  title: string;
  description?: string;
  status: WorkflowStatus;
  steps: WorkflowStep[];
  initiated_by: string;
  initiator?: User;
  created_at: string;
  updated_at: string;
}

// ─── BQMS (Business Quality Management System) ─────────────────

export interface BQMSRecord {
  id: string;
  record_type: 'bid' | 'quote' | 'contract';
  reference_number: string;
  client_name: string;
  project_name?: string;
  status: 'draft' | 'submitted' | 'won' | 'lost' | 'cancelled';
  value: number;
  currency: 'VND' | 'USD' | 'RMB';
  submitted_at?: string;
  result_at?: string;
  notes?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface BQMSKpi {
  total_bids: number;
  total_won: number;
  total_lost: number;
  win_rate: number;
  total_value: number;
  won_value: number;
  period: string;
}

// ─── Notification ───────────────────────────────────────────────

// Real DB enum values (backend `notification_type`): init_v3.sql + migrations
// (m41 leave_*, procurement_v2_004 procurement_*).
export type NotificationType =
  | 'workflow_request'
  | 'workflow_approved'
  | 'workflow_rejected'
  | 'deadline_reminder'
  | 'stock_alert'
  | 'po_received'
  | 'bqms_rfq_new'
  | 'report_ready'
  | 'leave_request'
  | 'leave_approved'
  | 'leave_rejected'
  | 'leave_cancelled'
  | 'procurement_award'
  | 'procurement_quote'
  | 'procurement_contract'
  | 'procurement_po'
  | 'procurement_delivery';

export interface Notification {
  id: string;
  // API returns `recipient_id`; `user_id` kept as a back-compat alias.
  recipient_id: string;
  user_id?: string;
  type: NotificationType;
  title: string;
  // `message` is the backend alias for `body` (api injects it in _enrich).
  message: string;
  body?: string;
  link?: string;
  ref_type?: string | null;
  ref_id?: number | string | null;
  is_read: boolean;
  created_at: string;
}

// ─── Inventory ──────────────────────────────────────────────────

export interface InventoryItem {
  id: string;
  product_code: string;
  product_name: string;
  category?: string;
  unit: string;
  current_stock: number;
  min_stock: number;
  max_stock?: number;
  warehouse_location?: string;
  last_received_at?: string;
  created_at: string;
  updated_at: string;
}

// ─── Generic API Types ──────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ApiError {
  detail: string;
  status_code: number;
  errors?: Record<string, string[]>;
}
