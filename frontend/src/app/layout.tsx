import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from '@/providers/query-provider';
import { AuthProvider } from '@/providers/auth-provider';

export const metadata: Metadata = {
  title: 'Song Châu ERP',
  description: 'Hệ thống quản lý doanh nghiệp Song Châu',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <head>
        <meta name="theme-color" content="#1e40af" />
      </head>
      <body className="font-sans antialiased bg-slate-100 text-slate-900">
        <QueryProvider>
          <AuthProvider>{children}</AuthProvider>
        </QueryProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.getRegistrations()
                    .then(function(registrations) {
                      return Promise.all(registrations.map(function(registration) {
                        return registration.unregister();
                      }));
                    })
                    .catch(function() {});

                  if ('caches' in window) {
                    caches.keys()
                      .then(function(keys) {
                        return Promise.all(
                          keys
                            .filter(function(key) { return key.indexOf('sc-erp-') === 0; })
                            .map(function(key) { return caches.delete(key); })
                        );
                      })
                      .catch(function() {});
                  }
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
