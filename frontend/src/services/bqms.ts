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

// ─── Scraper Settings (admin-only) ──────────────────────────────

/** The six Samsung scraper flags. All currently default OFF (paused). */
export type ScraperFlagKey =
  | 'periodic_scrape'
  | 'smart_sync'
  | 'smart_rescan'
  | 'code_track'
  | 'state_tick'
  | 'won_sync';

export type ScraperFlags = Record<ScraperFlagKey, boolean>;

export interface ScraperCredentials {
  username: string | null;
  password_set: boolean;
  source: 'db' | 'env';
  updated_at: string | null;
}

export interface ScraperSettings {
  flags: ScraperFlags;
  credentials: ScraperCredentials;
}

export interface TestLoginResult {
  ok: boolean;
  message: string;
}

export async function getScraperSettings(): Promise<ScraperSettings> {
  return api.get<ScraperSettings>('/api/v1/bqms/scraper-settings');
}

/** Toggle a single flag. Returns the new flags map. */
export async function updateScraperFlag(
  key: ScraperFlagKey,
  value: boolean
): Promise<{ flags: ScraperFlags }> {
  return api.put<{ flags: ScraperFlags }>(
    '/api/v1/bqms/scraper-settings/flags',
    { key, value }
  );
}

/** Bulk-set all flags (used by master toggle). Returns the new flags map. */
export async function updateScraperFlags(
  flags: Partial<ScraperFlags>
): Promise<{ flags: ScraperFlags }> {
  return api.put<{ flags: ScraperFlags }>(
    '/api/v1/bqms/scraper-settings/flags',
    { flags }
  );
}

/** Save Samsung username and/or password override. Password is never returned. */
export async function updateScraperCredentials(body: {
  username?: string;
  password?: string;
}): Promise<{ username: string | null; password_set: boolean; updated_at: string | null }> {
  return api.put('/api/v1/bqms/scraper-settings/credentials', body);
}

/** Run ONE Samsung login with current resolved creds. Does NOT enable anything. */
export async function testScraperLogin(): Promise<TestLoginResult> {
  return api.post<TestLoginResult>('/api/v1/bqms/scraper-settings/test-login');
}
