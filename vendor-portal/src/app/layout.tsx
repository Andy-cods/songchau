import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Song Châu — Cổng Nhà Cung Cấp',
  description: 'Hệ thống báo giá và đấu thầu cho nhà cung cấp Song Châu',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="bg-slate-50 text-slate-900 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
