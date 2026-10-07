import { shiprocketAdapter } from './shiprocket.js';
import type { CourierAdapter } from './types.js';

const adapters: Record<string, CourierAdapter> = {
  [shiprocketAdapter.name]: shiprocketAdapter,
};

export function courierAdapter(name: string): CourierAdapter {
  const a = adapters[name];
  if (!a) throw new Error(`Unknown courier adapter: ${name}`);
  return a;
}

export function hasCourier(name: string): boolean {
  return name in adapters;
}
