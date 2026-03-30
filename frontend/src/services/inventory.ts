import { api } from '@/lib/api';
import type { PaginatedResponse, InventoryItem } from '@/types/models';

export interface GetInventoryParams {
  page?: number;
  page_size?: number;
  search?: string;
  category?: string;
  low_stock?: boolean;
}

export async function getInventory(
  params?: GetInventoryParams
): Promise<PaginatedResponse<InventoryItem>> {
  const query = params
    ? '?' + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : '';
  return api.get<PaginatedResponse<InventoryItem>>(`/api/v1/inventory${query}`);
}

export async function getInventoryItem(id: string): Promise<InventoryItem> {
  return api.get<InventoryItem>(`/api/v1/inventory/${id}`);
}

export async function updateInventoryItem(
  id: string,
  data: Partial<InventoryItem>
): Promise<InventoryItem> {
  return api.put<InventoryItem>(`/api/v1/inventory/${id}`, data);
}

export async function adjustStock(
  id: string,
  adjustment: { quantity: number; reason: string }
): Promise<InventoryItem> {
  return api.post<InventoryItem>(`/api/v1/inventory/${id}/adjust`, adjustment);
}
