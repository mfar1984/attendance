import type { LabelKey } from './labels.js';

/**
 * The domain a nav group and its permission section belong to.
 *
 * One layer above the groups. The sidebar was designed around six groups holding
 * twenty-two entries, and at that size a flat list of groups was scannable — the rail
 * closed to six rows and somebody found what they wanted by looking rather than reading.
 *
 * It is now ten groups holding forty-four entries, because the HR module added
 * Recruitment, KPI and Payroll after that decision. The original reasoning did not become
 * wrong; it expired. Ten rows is a list that has to be read.
 *
 * These headings are the partition, and they follow a real division of labour rather than
 * a wish for tidiness. Attendance, Staff and Schedule are the operations side. Requests,
 * Recruitment, KPI and Payroll are HR. An HR clerk never opens the raw scan log, and
 * whoever settles a disputed punch never sets a bonus rate.
 *
 * ## Why this lives in `shared`
 *
 * Two structures render it: `NAV_GROUPS` in the web builds the sidebar, and
 * `PERMISSION_SECTIONS` in the server builds the permission matrix. They already agree
 * one-to-one and already share the `nav.group.*` label keys.
 *
 * A second copy of the partition would drift, and the copy that drifted would be the one
 * somebody edited while looking at the other screen — leaving a role editor whose sections
 * disagree with the rail the role is granting access to. So the mapping is defined once and
 * both read it.
 */
export const NavDomain = {
  /** Recording and correcting what happened: attendance, people, schedules. */
  operations: 'operations',
  /** Deciding and paying: applications, hiring, appraisal, payroll. */
  humanResources: 'humanResources',
  /** Reading the result, and configuring the thing that produced it. */
  system: 'system',
} as const;
export type NavDomain = (typeof NavDomain)[keyof typeof NavDomain];

/**
 * Domains in the order they are rendered, top to bottom.
 *
 * Ordered here rather than taken from the order of `NAV_GROUPS` or `PERMISSION_SECTIONS`,
 * so the two cannot present the same partition in two sequences. Each consumer walks this
 * list and filters its own groups into it.
 *
 * The order follows the order the work happens in: attendance is recorded, requests are
 * decided, results are read. Configuration last, because it is a different activity from
 * using the system.
 */
export const NAV_DOMAINS: ReadonlyArray<{ key: NavDomain; labelKey: LabelKey }> = [
  { key: NavDomain.operations, labelKey: 'nav.domain.operations' },
  { key: NavDomain.humanResources, labelKey: 'nav.domain.humanResources' },
  { key: NavDomain.system, labelKey: 'nav.domain.system' },
];

/**
 * Which domain each group sits in, keyed by the label key both structures already carry.
 *
 * Keyed on `LabelKey` rather than a free string so a typo is a compile error rather than a
 * group that silently renders outside every heading.
 *
 * Deliberately not exhaustive over `LabelKey` — it maps group titles only, and a group whose
 * title is absent renders above the headings. That is the Dashboard case, which belongs to no
 * domain because it summarises all of them.
 */
export const GROUP_DOMAIN = {
  'nav.group.attendance': NavDomain.operations,
  'nav.group.staff': NavDomain.operations,
  'nav.group.schedule': NavDomain.operations,

  /**
   * A permission-matrix section rather than a sidebar group.
   *
   * The rail carries one group per request module — the four below — while the matrix keeps them
   * as four rows under this one heading, because each module is a single permission key and four
   * sections would be four headings introducing four rows. Both sit in the same domain, which is
   * what keeps the two screens aligned at the level that matters.
   */
  'nav.group.requests': NavDomain.humanResources,

  'nav.group.leave': NavDomain.humanResources,
  'nav.group.claims': NavDomain.humanResources,
  'nav.group.overtime': NavDomain.humanResources,
  'nav.group.expenses': NavDomain.humanResources,

  'nav.group.recruitment': NavDomain.humanResources,
  'nav.group.kpi': NavDomain.humanResources,
  'nav.group.payroll': NavDomain.humanResources,

  'nav.group.reports': NavDomain.system,
  /**
   * Last, and inside the same domain as Reports rather than separated by a rule.
   *
   * The rule that used to sit above it carried the reason "configuring the system is a different
   * activity from using it". The domain heading now carries that: Settings is neither Operations
   * nor HR, which is the same statement made once instead of twice. It stays last in its domain.
   */
  'nav.group.settings': NavDomain.system,
} as const satisfies Readonly<Record<string, NavDomain>>;

/**
 * Group titles that have a domain.
 *
 * Derived from the map rather than declared, so `NavGroup.titleKey` can be typed against it and
 * a group added without a mapping becomes a compile error instead of a group that silently
 * renders outside every heading.
 */
export type NavGroupTitleKey = keyof typeof GROUP_DOMAIN;

export function domainForGroup(titleKey: LabelKey | undefined): NavDomain | undefined {
  if (titleKey === undefined) return undefined;
  /**
   * Widened to index the map with any label key.
   *
   * The nav is typed so this cannot miss, but the permission matrix reads the same map with its
   * own section labels — and one of those, Dashboard, deliberately has no domain. So this has to
   * answer for keys outside the map rather than refusing them.
   */
  return (GROUP_DOMAIN as Readonly<Partial<Record<LabelKey, NavDomain>>>)[titleKey];
}

/**
 * Splits groups into domains, in domain order, dropping domains that came out empty.
 *
 * Shared so both screens partition identically. A domain can legitimately empty out: a role
 * with no HR permissions at all should see no HR heading rather than a heading with nothing
 * under it, which reads as a screen that failed to load its own contents.
 *
 * Anything whose title maps to no domain is returned separately rather than dropped. Losing a
 * group because somebody added it and forgot the mapping would be a screen quietly missing an
 * entry, which is the hardest kind of gap to notice.
 */
export function groupByDomain<T>(
  groups: readonly T[],
  titleKeyOf: (group: T) => LabelKey | undefined,
): {
  ungrouped: T[];
  domains: Array<{ key: NavDomain; labelKey: LabelKey; groups: T[] }>;
} {
  const ungrouped = groups.filter((group) => domainForGroup(titleKeyOf(group)) === undefined);

  const domains = NAV_DOMAINS.map((domain) => ({
    ...domain,
    groups: groups.filter((group) => domainForGroup(titleKeyOf(group)) === domain.key),
  })).filter((domain) => domain.groups.length > 0);

  return { ungrouped, domains };
}
