// Notification deep-link resolver for the VENDOR portal (Đợt 6 + Đợt 1 BE-4).
//
// IMPORTANT (matches app/services/procurement_notifications.py):
// every procurement notification stamps ref_type = the ENTITY TYPE
// ('award'|'quote'|'contract'|'po'|'delivery') and ref_id = the BATCH id (always
// detail.batch_id) — NOT the entity's own id.
//
// Đợt 1 (BE-4) upgrade: the producer now ALSO stamps the real entity id into
// `metadata` (contract_id / po_id). When present we deep-link to the actual
// entity (/contracts/{id}, /orders/{po_id}); otherwise we fall back to the
// legacy batch-centric routing (so a pre-BE-4 backend / older rows still work):
//   - batch-centric events (award/quote) → the RFQ round /rfq/{batch_id}
//   - contract/po/delivery events → the relevant portal SECTION LIST
// Anything unrecognised → null (row marks-read in place, no broken nav).
import type { VendorNotification } from '@/lib/types';

// Coerce a possibly-string/unknown metadata value into a finite positive id.
// asyncpg may hand jsonb back as a raw string if the backend didn't parse it;
// in that case metadata won't be an object and these lookups simply yield null.
function asId(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function notificationLink(
  n: Pick<VendorNotification, 'ref_type' | 'ref_id' | 'metadata'>,
): string | null {
  const id = n.ref_id;
  const rt = (n.ref_type ?? '').toLowerCase();
  // metadata may be missing, null, or (defensively) a non-object — guard it.
  const m = (n.metadata && typeof n.metadata === 'object' ? n.metadata : {}) as Record<string, unknown>;
  const contractId = asId(m.contract_id);
  const poId = asId(m.po_id);

  // Batch-centric → RFQ round (ref_id is the batch id). Accept defensive spellings.
  // (batch:cancel notif has ref_type='batch' → lands here → /rfq/{batch_id}.)
  if (
    rt === 'award' || rt === 'quote' || rt === 'batch' || rt === 'rfq' ||
    rt === 'invitation' || rt === 'invite' ||
    // Đợt 2a #12 — Q&A/phụ lục: producer stamps ref_type='rfq_message', ref_id=batch_id.
    // Land on the RFQ round so the vendor opens the thread/addendum directly.
    rt === 'rfq_message' || rt === 'procurement_rfq_message' ||
    rt === 'rfq_batch' || rt === 'procurement_award' || rt === 'procurement_quote' ||
    rt === 'procurement_batch' || rt === 'procurement_rfq_batch' || rt === 'procurement_rfq_batches'
  ) {
    return id == null ? '/rfq' : `/rfq/${id}`;
  }

  // Contract events → real contract if BE-4 stamped contract_id, else list.
  if (rt === 'contract' || rt === 'procurement_contract' || rt === 'procurement_contracts') {
    return contractId != null ? `/contracts/${contractId}` : '/contracts';
  }

  // PO / delivery events → real PO if BE-4 stamped po_id, else list.
  if (
    rt === 'po' || rt === 'order' || rt === 'delivery' ||
    rt === 'procurement_po' || rt === 'procurement_pos' || rt === 'procurement_delivery'
  ) {
    return poId != null ? `/orders/${poId}` : '/orders';
  }

  return null;
}
