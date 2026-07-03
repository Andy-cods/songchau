import { Badge } from '@/components/Badge';
import {
  quoteStatusCfg,
  contractStatusCfg,
  poStatusCfg,
  invStatusCfg,
  deliveryStatusCfg,
} from '@/lib/format';

// Which domain's status vocabulary to resolve against. Each maps to the
// matching *StatusCfg factory in lib/format (single source of status truth).
export type StatusKind = 'quote' | 'contract' | 'po' | 'inv' | 'delivery';

export interface StatusChipProps {
  kind: StatusKind;
  /** Raw backend status string; unknown values fall back to a neutral pill. */
  status?: string | null;
  withDot?: boolean;
}

const RESOLVER: Record<StatusKind, (s?: string | null) => { label: string; className: string }> = {
  quote: quoteStatusCfg,
  contract: contractStatusCfg,
  po: poStatusCfg,
  inv: invStatusCfg,
  delivery: deliveryStatusCfg,
};

/**
 * Domain-aware status pill. Thin wrapper over <Badge> that picks the right
 * *StatusCfg by `kind` so screen cooks never import five resolvers.
 */
export function StatusChip({ kind, status, withDot }: StatusChipProps): JSX.Element {
  return <Badge {...RESOLVER[kind](status)} withDot={withDot} />;
}

export default StatusChip;
