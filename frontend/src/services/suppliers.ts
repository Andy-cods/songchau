import { api } from '@/lib/api';
import type { PaginatedResponse, Supplier } from '@/types/models';

export interface GetSuppliersParams {
  page?: number;
  page_size?: number;
  search?: string;
  is_active?: boolean;
}

export async function getSuppliers(
  params?: GetSuppliersParams
): Promise<PaginatedResponse<Supplier>> {
  const query = params
    ? '?' + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : '';
  return api.get<PaginatedResponse<Supplier>>(`/api/v1/suppliers${query}`);
}

export async function getSupplier(id: string): Promise<Supplier> {
  return api.get<Supplier>(`/api/v1/suppliers/${id}`);
}

export async function createSupplier(
  data: Omit<Supplier, 'id' | 'created_at' | 'updated_at'>
): Promise<Supplier> {
  return api.post<Supplier>('/api/v1/suppliers', data);
}

export async function updateSupplier(
  id: string,
  data: Partial<Supplier>
): Promise<Supplier> {
  return api.put<Supplier>(`/api/v1/suppliers/${id}`, data);
}

export async function deleteSupplier(id: string): Promise<void> {
  return api.delete(`/api/v1/suppliers/${id}`);
}
