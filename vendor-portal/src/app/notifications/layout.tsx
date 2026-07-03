import PortalNav from '@/components/PortalNav';

/**
 * NotificationsLayout — owns the global chrome for /notifications (Đợt 6 vendor
 * notifications feed), mirroring ContractsLayout / OrdersLayout so every
 * authenticated section stays identical.
 *
 * Chrome contract for sibling pages under /notifications:
 *  - This layout owns PortalNav + the `min-h-screen bg-slate-50` shell. Pages
 *    MUST NOT re-mount PortalNav or re-declare the shell.
 *  - Pages own their own <main> and standardize it to the shared width token
 *    `max-w-6xl mx-auto px-6 py-8`.
 */
export default function NotificationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <PortalNav />
      {children}
    </div>
  );
}
