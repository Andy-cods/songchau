'use client';

// Permission helpers — Thang 2026-05-20.
//
// Backend enforces authoritatively (require_role in rbac.py); these client
// helpers are for UX polish — disabling buttons + adding badges so the user
// understands their access level without having to trigger a 403 error.

import { useAuth } from '@/providers/auth-provider';

/**
 * Returns true when the current user is in a read-only role (guest viewer).
 *
 * Use to disable edit / delete / submit buttons:
 *   const readOnly = useIsReadOnly();
 *   <button disabled={readOnly || saving}>Lưu</button>
 *
 * Or render a badge:
 *   {readOnly && <span className="badge">CHỈ XEM</span>}
 */
export function useIsReadOnly(): boolean {
  const { user } = useAuth();
  return user?.role === 'viewer';
}

/**
 * Returns the user's role string (e.g. 'admin', 'viewer'). Empty string
 * when not authenticated yet.
 */
export function useUserRole(): string {
  const { user } = useAuth();
  return user?.role ?? '';
}
