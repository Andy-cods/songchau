import { BP } from './base-path';

const BASE = '';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('vendor_token');
}

async function request<T>(endpoint: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (!headers.has('Content-Type') && !(opts.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${BASE}${endpoint}`, { ...opts, headers });

  if (res.status === 401) {
    localStorage.removeItem('vendor_token');
    localStorage.removeItem('vendor_user');
    if (typeof window !== 'undefined') window.location.href = `${BP}/login`;
    throw { detail: 'Phiên đăng nhập hết hạn', status_code: 401 };
  }

  if (!res.ok) {
    let detail = 'Có lỗi xảy ra';
    try { const d = await res.json(); detail = d.detail || d.message || detail; } catch {}
    throw { detail, status_code: res.status };
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// Fetch a binary response (e.g. application/pdf) WITH the Bearer token. A plain
// <a href> can't carry the Authorization header, so PDF downloads go through here
// and are handed to the browser via an object URL.
async function requestBlob(endpoint: string): Promise<Blob> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${BASE}${endpoint}`, { method: 'GET', headers });

  if (res.status === 401) {
    localStorage.removeItem('vendor_token');
    localStorage.removeItem('vendor_user');
    if (typeof window !== 'undefined') window.location.href = `${BP}/login`;
    throw { detail: 'Phiên đăng nhập hết hạn', status_code: 401 };
  }

  if (!res.ok) {
    let detail = 'Có lỗi xảy ra';
    try { const d = await res.json(); detail = d.detail || d.message || detail; } catch {}
    throw { detail, status_code: res.status };
  }

  return res.blob();
}

export const api = {
  get: <T>(url: string) => request<T>(url, { method: 'GET' }),
  post: <T>(url: string, body?: unknown) => request<T>(url, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(url: string, body?: unknown) => request<T>(url, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(url: string, body?: unknown) => request<T>(url, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  upload: <T>(url: string, formData: FormData) => request<T>(url, { method: 'POST', body: formData }),
  blob: (url: string) => requestBlob(url),
};
