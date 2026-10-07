import type { NormalizedShipmentStatus } from './types.js';

/** Map free-text courier statuses into our normalized set. Order matters: most specific first. */
const RULES: Array<[RegExp, NormalizedShipmentStatus]> = [
  [/rto.*(delivered|received)/i, 'rto_delivered'],
  [/(rto|return to origin|returned)/i, 'rto_initiated'],
  [/(undelivered|ndr|delivery (failed|attempted)|customer (refused|not available|unreachable)|door ?lock)/i, 'ndr'],
  [/out for delivery|ofd/i, 'out_for_delivery'],
  [/^delivered$|\bdelivered\b/i, 'delivered'],
  [/(picked|in transit|shipped|reached|dispatched|manifested)/i, 'in_transit'],
  [/(created|pickup scheduled|awb assigned|new)/i, 'created'],
];

export function normalizeStatus(raw: string): NormalizedShipmentStatus {
  for (const [re, status] of RULES) if (re.test(raw)) return status;
  return 'in_transit';
}
