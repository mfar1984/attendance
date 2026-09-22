import type { ReactNode } from 'react';

import { AwardsPanel, COMMISSION_COPY } from '../components/AwardsPanel';

/**
 * Commissions.
 *
 * Shares `AwardsPanel` with bonuses. Separate screen and separate permission key because they are
 * granted by different people for different reasons; the reasoning is in `AwardsPanel`.
 */
export function CommissionsPage(): ReactNode {
  return <AwardsPanel copy={COMMISSION_COPY} />;
}
