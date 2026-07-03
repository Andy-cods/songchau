import type { ApiError } from '@/types/models';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

function isAuthEndpoint(endpoint: string): boolean {
  return endpoint.includes('/api/v1/auth/login')
    || endpoint.includes('/api/v1/auth/refresh')
    || endpoint.includes('/api/v1/auth/logout');
}

/**
 * Get the stored JWT access token.
 */
function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

/**
 * Build request headers with JSON content type and JWT auth.
 */
function buildHeaders(endpoint: string, custom?: HeadersInit): Headers {
  const headers = new Headers(custom);

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const token = isAuthEndpoint(endpoint) ? null : getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return headers;
}

/**
 * Handle 401 by attempting a token refresh.
 * If refresh fails, redirect to login.
 */
async function handleUnauthorized(): Promise<boolean> {
  const refreshToken = localStorage.getItem('refresh_token');

  if (!refreshToken) {
    redirectToLogin();
    return false;
  }

  try {
    const res = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) {
      redirectToLogin();
      return false;
    }

    const data = await res.json();
    localStorage.setItem('access_token', data.access_token);
    if (data.refresh_token) {
      localStorage.setItem('refresh_token', data.refresh_token);
    }
    return true;
  } catch {
    redirectToLogin();
    return false;
  }
}

function redirectToLogin() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user');

  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
}

/**
 * Core fetch wrapper with auth, error handling, and retry on 401.
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  retried = false
): Promise<T> {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `${BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const headers = buildHeaders(endpoint, options.headers as HeadersInit | undefined);

  // Remove Content-Type for FormData (browser sets it with boundary)
  if (options.body instanceof FormData) {
    headers.delete('Content-Type');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  // Handle 401 — attempt token refresh and retry once
  if (res.status === 401 && !retried && !isAuthEndpoint(endpoint)) {
    const refreshed = await handleUnauthorized();
    if (refreshed) {
      return apiRequest<T>(endpoint, options, true);
    }
    throw createApiError('Phiên đăng nhập đã hết hạn', 401);
  }

  // Handle 429 Too Many Requests — friendly Vietnamese toast (server already
  // sends a localized detail, but fall back gracefully if it doesn't).
  if (res.status === 429) {
    let detail = 'Quá nhiều yêu cầu — đợi 1 phút rồi thử lại.';
    try {
      const errorData = await res.json();
      if (typeof errorData?.detail === 'string') detail = errorData.detail;
    } catch {
      // body not JSON — keep default Vietnamese message
    }
    throw createApiError(detail, 429);
  }

  // Handle non-OK responses
  if (!res.ok) {
    let detail = 'Có lỗi xảy ra';
    try {
      const errorData = await res.json();
      const ed = errorData?.detail;
      if (typeof ed === 'string') {
        detail = ed;
      } else if (ed && typeof ed === 'object') {
        // FastAPI/rbac structured detail, e.g. {error, message, required_roles}.
        // Extract the human message — never let the object reach the UI as
        // "[object Object]" (that made permission/session errors look silent).
        detail = ed.message || ed.error || JSON.stringify(ed);
      } else if (typeof errorData?.message === 'string') {
        detail = errorData.message;
      }
    } catch {
      // Response body is not JSON
    }
    throw createApiError(detail, res.status);
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

function createApiError(detail: string, status_code: number): ApiError {
  return { detail, status_code };
}

// ─── Public API Methods ─────────────────────────────────────────

export const api = {
  get<T>(endpoint: string): Promise<T> {
    return apiRequest<T>(endpoint, { method: 'GET' });
  },

  post<T>(endpoint: string, body?: unknown): Promise<T> {
    return apiRequest<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  put<T>(endpoint: string, body?: unknown): Promise<T> {
    return apiRequest<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  patch<T>(endpoint: string, body?: unknown): Promise<T> {
    return apiRequest<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  delete<T>(endpoint: string): Promise<T> {
    return apiRequest<T>(endpoint, { method: 'DELETE' });
  },

  upload<T>(endpoint: string, formData: FormData): Promise<T> {
    return apiRequest<T>(endpoint, {
      method: 'POST',
      body: formData,
    });
  },
};
