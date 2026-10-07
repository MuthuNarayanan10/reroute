/**
 * Loads PIN code -> lat/lng reference data used by the ReRoute geo matcher.
 *
 * Source: India Post "All India Pincode Directory with lat/long" (data.gov.in, Open Government Data License).
 * Download the CSV yourself and run:
 *   npm run db:seed-pincodes -- data/pincodes.csv
 *
 * Expected columns (case-insensitive): pincode, latitude, longitude, district, statename
 * Rows sharing a pincode (multiple post offices) are averaged into one point.
 */
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db, closeDb } from '../src/db/client.js';
import { pincodes } from '../src/db/schema.js';
import { isValidPincode } from '../src/lib/geo.js';
import { logger } from '../src/lib/logger.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run db:seed-pincodes -- <path-to-csv>');
  process.exit(1);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const [headerLine, ...lines] = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
const header = parseCsvLine(headerLine ?? '').map((h) => h.toLowerCase());
const col = (name: string) => header.findIndex((h) => h === name);
const iPin = col('pincode');
const iLat = col('latitude');
const iLng = col('longitude');
const iDist = col('district');
const iState = col('statename');
if (iPin < 0 || iLat < 0 || iLng < 0) throw new Error(`CSV must have pincode, latitude, longitude columns; got ${header.join(',')}`);

const agg = new Map<string, { lat: number; lng: number; n: number; district: string; state: string }>();
for (const line of lines) {
  const c = parseCsvLine(line);
  const pin = c[iPin] ?? '';
  const lat = Number(c[iLat]);
  const lng = Number(c[iLng]);
  // Skip junk rows: invalid pins or coordinates outside India's bounding box.
  if (!isValidPincode(pin) || !(lat > 6 && lat < 38) || !(lng > 68 && lng < 98)) continue;
  const a = agg.get(pin) ?? { lat: 0, lng: 0, n: 0, district: c[iDist] ?? '', state: c[iState] ?? '' };
  a.lat += lat;
  a.lng += lng;
  a.n += 1;
  agg.set(pin, a);
}

const rows = [...agg.entries()].map(([pincode, a]) => ({
  pincode,
  lat: a.lat / a.n,
  lng: a.lng / a.n,
  district: a.district || null,
  state: a.state || null,
}));

for (let i = 0; i < rows.length; i += 1000) {
  await db
    .insert(pincodes)
    .values(rows.slice(i, i + 1000))
    .onConflictDoUpdate({
      target: pincodes.pincode,
      set: { lat: sql`excluded.lat`, lng: sql`excluded.lng`, district: sql`excluded.district`, state: sql`excluded.state` },
    });
}
logger.info({ pincodes: rows.length }, 'pincodes loaded');
await closeDb();
