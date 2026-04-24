'use client';

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { connectSocket, disconnectSocket } from '@/lib/socket';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            gcTime: 5 * 60 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  // Connect Socket.IO when authenticated
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Try to connect (only succeeds if token is present)
    const socket = connectSocket(queryClient);

    // Reconnect on token change (e.g., after login)
    const onStorageChange = (e: StorageEvent) => {
      if (e.key === 'access_token') {
        disconnectSocket();
        if (e.newValue) {
          connectSocket(queryClient);
        }
      }
    };
    window.addEventListener('storage', onStorageChange);

    return () => {
      window.removeEventListener('storage', onStorageChange);
      // Don't disconnect on unmount — keep socket alive across navigation
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
