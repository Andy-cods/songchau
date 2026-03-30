import { api } from '@/lib/api';
import type {
  PaginatedResponse,
  PurchaseOrder,
  PurchaseOrderItem,
  POStatus,
} from '@/types/models';

export interface GetPurchaseOrdersParams {
  page?: number;
  page_size?: number;
  search?: string;
  status?: POStatus;
  supplier_id?: string;
}

export interface CreatePOPayload {
  supplier_id: string;
  items: Omit<PurchaseOrderItem, 'id'>[];
  currency: 'VND' | 'USD' | 'RMB';
  payment_terms?: string;
  expected_delivery?: string;
  notes?: string;
}

export async function getPurchaseOrders(
  params?: GetPurchaseOrdersParams
): Promise<PaginatedResponse<PurchaseOrder>> {
  const query = params
    ? '?' + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : '';
  return api.get<PaginatedResponse<PurchaseOrder>>(
    `/api/v1/purchase-orders${query}`
  );
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return api.get<PurchaseOrder>(`/api/v1/purchase-orders/${id}`);
}

export async function createPurchaseOrder(
  data: CreatePOPayload
): Promise<PurchaseOrder> {
  return api.post<PurchaseOrder>('/api/v1/purchase-orders', data);
}

export async function updatePurchaseOrder(
  id: string,
  data: Partial<CreatePOPayload>
): Promise<PurchaseOrder> {
  return api.put<PurchaseOrder>(`/api/v1/purchase-orders/${id}`, data);
}

export async function deletePurchaseOrder(id: string): Promise<void> {
  return api.delete(`/api/v1/purchase-orders/${id}`);
}

export async function submitForApproval(id: string): Promise<PurchaseOrder> {
  return api.post<PurchaseOrder>(
    `/api/v1/purchase-orders/${id}/submit`
  );
}
