import type { Metadata, Viewport } from 'next';
import './globals.css';
import { QueryProvider } from '@/providers/query-provider';
import { AuthProvider } from '@/providers/auth-provider';
import { ThemeProvider, NO_FLASH_SCRIPT } from '@/providers/theme-provider';

export const metadata: Metadata = {
  title: 'Song Châu ERP',
  description: 'Hệ thống quản lý doanh nghiệp Song Châu',
};

// FIX (Thang 2026-06-15): chuyển viewport sang export riêng theo Next.js 14+ API
// và set initialScale=1 + viewportFit=cover để khắc phục cảm giác "zoom in sát quá"
// trên mobile/iOS Safari (mặc định trước đây dùng default scale của UA).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
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
        {/* Apply dark class BEFORE React hydrates to prevent flash-of-light */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      {/* FIX (Thang 2026-06-21): bỏ `dark:bg-slate-950 dark:text-slate-100` khỏi body.
          NO_FLASH_SCRIPT có thể set html.dark từ localStorage cũ → body paint slate-950.
          Kết hợp `body { zoom: 0.8 }` trong globals.css, `min-h-screen` (100vh) tính theo
          viewport chưa scale rồi scale DOWN, để hở ~20% viewport thật → lộ vạch đen đáy
          dashboard / đỉnh login. Theme-provider hiện đang lock light-only cho đến khi Phase 2
          dark-mode codemod ship; tái-thêm dark classes khi đó. */}
      <body className="font-sans antialiased bg-slate-100 text-slate-900">
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>{children}</AuthProvider>
          </QueryProvider>
        </ThemeProvider>
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
