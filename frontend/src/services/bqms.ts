import { api } from '@/lib/api';
import type { PaginatedResponse, BQMSRecord, BQMSKpi } from '@/types/models';

export interface GetBQMSParams {
  page?: number;
  page_size?: number;
  search?: string;
  record_type?: 'bid' | 'quote' | 'contract';
  status?: 'draft' | 'submitted' | 'won' | 'lost' | 'cancelled';
}

export async function getBQMSRecords(
  params?: GetBQMSParams
): Promise<PaginatedResponse<BQMSRecord>> {
  const query = params
    ? '?' + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : '';
  return api.get<PaginatedResponse<BQMSRecord>>(`/api/v1/bqms${query}`);
}

export async function getBQMSRecord(id: string): Promise<BQMSRecord> {
  return api.get<BQMSRecord>(`/api/v1/bqms/${id}`);
}

export async function createBQMSRecord(
  data: Omit<BQMSRecord, 'id' | 'created_by' | 'created_at' | 'updated_at'>
): Promise<BQMSRecord> {
  return api.post<BQMSRecord>('/api/v1/bqms', data);
}

export async function updateBQMSRecord(
  id: string,
  data: Partial<BQMSRecord>
): Promise<BQMSRecord> {
  return api.put<BQMSRecord>(`/api/v1/bqms/${id}`, data);
}

export async function deleteBQMSRecord(id: string): Promise<void> {
  return api.delete(`/api/v1/bqms/${id}`);
}

export async function getBQMSKpis(period?: string): Promise<BQMSKpi> {
  const query = period ? `?period=${period}` : '';
  return api.get<BQMSKpi>(`/api/v1/bqms/kpis${query}`);
}
