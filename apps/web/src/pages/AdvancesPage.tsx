import type { ReactNode } from 'react';

import { ADVANCE_COPY, LendingPanel } from '../components/LendingPanel';

/**
 * Salary advances.
 *
 * Shares `LendingPanel` with loans; the reasoning for keeping them apart is there.
 *
 * The monthly recovery is derived from the amount and the months chosen, and shown before saving —
 * seeing it is what stops somebody picking three months for a figure they meant to spread over
 * twelve.
 */
export function AdvancesPage(): ReactNode {
  return <LendingPanel copy={ADVANCE_COPY} />;
}
