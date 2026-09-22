import type { ReactNode } from 'react';

import { LOAN_COPY, LendingPanel } from '../components/LendingPanel';

/**
 * Staff loans.
 *
 * Shares `LendingPanel` with salary advances. The difference is only the instalment: a loan carries
 * an agreed figure that need not divide the principal evenly, an advance derives one from the
 * months. Separate screens because a loan is a contract and an advance is a favour, and the
 * permission registry grants them separately — somebody preparing an advance has no reason to read
 * what a colleague still owes.
 */
export function LoansPage(): ReactNode {
  return <LendingPanel copy={LOAN_COPY} />;
}
