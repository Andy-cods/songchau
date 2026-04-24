/**
 * Socket.IO client for real-time updates.
 *
 * Pattern:
 * - Connect once on app mount with JWT auth
 * - Listen for 'record_changed' events
 * - Auto-invalidate matching TanStack Query cache
 */

import { io, Socket } from 'socket.io-client';
import { QueryClient } from '@tanstack/react-query';

let socket: Socket | null = null;

interface RecordChangedPayload {
  entity_type: string;
  record_id: number;
  action: string;
  user_id?: string;
  metadata?: Record<string, any>;
}

// Map entity_type → query keys to invalidate
const ENTITY_QUERY_MAP: Record<string, string[][]> = {
  bqms_delivery: [
    ['deliveries'],
    ['deliveries-kpi'],
  ],
  crm_pipeline_card: [
    ['crm-board'],
  ],
  invoice_sale: [
    ['sales-q'],
  ],
  invoice_purchase: [
    ['purchases-q'],
  ],
  customer: [
    ['crm-customers'],
    ['crm-overview'],
  ],
  vendor_quote: [
    ['vendor-quotes'],
    ['procurement-batches'],
  ],
};

export function connectSocket(queryClient: QueryClient): Socket | null {
  if (socket?.connected) return socket;
  if (typeof window === 'undefined') return null;

  const token = localStorage.getItem('access_token');
  if (!token) return null;

  socket = io({
    path: '/ws/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
  });

  socket.on('connect', () => {
    console.log('[Socket] Connected:', socket?.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
  });

  socket.on('connect_error', (err) => {
    console.warn('[Socket] Connect error:', err.message);
  });

  // ── Real-time invalidation ──
  socket.on('record_changed', (payload: RecordChangedPayload) => {
    const { entity_type, record_id, action, user_id } = payload;

    // Skip self-triggered events
    const myUserId = JSON.parse(localStorage.getItem('user') || '{}')?.id;
    if (user_id && myUserId && user_id === myUserId) return;

    // Invalidate matching queries
    const queryKeys = ENTITY_QUERY_MAP[entity_type] || [];
    queryKeys.forEach(key => {
      queryClient.invalidateQueries({ queryKey: key });
    });

    console.log(`[Socket] ${entity_type} #${record_id} ${action} → invalidated ${queryKeys.length} queries`);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket(): Socket | null {
  return socket;
}
