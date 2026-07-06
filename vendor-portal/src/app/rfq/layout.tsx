import PortalShell from '@/components/PortalShell';

/**
 * RfqLayout — mounts the shared authenticated chrome (PortalShell: fixed left
 * sidebar + mobile drawer). Pages under /rfq keep their own
 * `<main className="mx-auto max-w-[1400px] px-6 …">`; the shell only supplies the
 * `lg:pl-60` content offset.
 */
export default function RfqLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
