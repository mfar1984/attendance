import type { ReactNode } from 'react';

import { AwardsPanel, BONUS_COPY } from '../components/AwardsPanel';

/**
 * Bonuses.
 *
 * The screen is `AwardsPanel`, shared with commissions: they are the same list with different
 * words on it. Two routes rather than one because they carry separate permission keys — one screen
 * would have to pick a key to check, and whichever it picked would grant the other for free.
 *
 * The one thing bonuses have that commissions do not is generation from KPI grades, which is why
 * `BONUS_COPY` carries `generate`.
 */
export function BonusesPage(): ReactNode {
  return <AwardsPanel copy={BONUS_COPY} />;
}
