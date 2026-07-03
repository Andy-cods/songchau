import PortalNav from '@/components/PortalNav';

/**
 * OrdersLayout — owns the global chrome for /orders (Đợt 4 PO + deliveries),
 * mirroring ContractsLayout so the two authenticated sections stay identical.
 *
 * Chrome contract for sibling pages under /orders:
 *  - This layout owns PortalNav + the `min-h-screen bg-slate-50` shell. Pages
 *    MUST NOT re-mount PortalNav or re-declare the shell.
 *  - Pages own their own <main> and standardize it to the shared width token
 *    `max-w-6xl mx-auto px-6 py-8`.
 */
export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <PortalNav />
      {children}
    </div>
  );
}
