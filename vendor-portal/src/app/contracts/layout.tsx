import PortalNav from '@/components/PortalNav';

/**
 * ContractsLayout — the ONLY place PortalNav currently mounts.
 *
 * Chrome contract for sibling pages under /contracts:
 *  - This layout owns the global chrome: PortalNav + the `min-h-screen bg-slate-50`
 *    shell. Pages MUST NOT re-mount PortalNav or re-declare the shell.
 *  - Pages own their own content wrapper and MUST standardize it to the shared
 *    width token `max-w-6xl mx-auto px-6 py-8` (contracts/page.tsx already does;
 *    contracts/[id]/page.tsx is standardized to match — no more 5xl vs 6xl drift).
 *    Children are passed through untouched so each page keeps its own <main>.
 *
 * FLAG for Thang (structural, NOT done here): dashboard, quotes, and rfq do NOT
 * mount PortalNav (rfq ships a bespoke header). Truly unifying global chrome means
 * promoting PortalNav into a higher shared authenticated layout — a routing/file
 * move beyond this visual pass. Left as-is on purpose; raise before restructuring.
 */
export default function ContractsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <PortalNav />
      {children}
    </div>
  );
}
