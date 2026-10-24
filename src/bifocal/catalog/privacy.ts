/** ct 23 October 2026: named owner consent and protected aggregate cohorts. */
export const usagePrivacy = {
 disclosureVersion: 2,
 fields: ['event id', 'content item id', 'reader id', 'tenant', 'opened time'],
 minimumGroupSize: 5,
 detail: 'owner-only',
 automaticErasure: false,
 disclosure: 'Collect only authorized content-open events: event id, content item id, reader id, tenant and opened time. Identifiable detail is owner-only. Aggregate groups below five distinct readers are suppressed. Withdrawing consent stops collection; stored usage follows installation retention and explicit erasure. No automatic destructive action or agent mutation.'
} as const
