import PortalNav from '@/components/PortalNav';

export default function QuotesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <PortalNav />
      {children}
    </div>
  );
}
