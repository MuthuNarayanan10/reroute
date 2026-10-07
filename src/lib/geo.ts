export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in km (Haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Indian PIN codes are 6 digits, first digit 1-9. */
export function isValidPincode(pin: string | null | undefined): pin is string {
  return !!pin && /^[1-9]\d{5}$/.test(pin.trim());
}

/** Bounding box used to pre-filter candidates in SQL before exact distance. */
export function boundingBox(center: LatLng, radiusKm: number) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((center.lat * Math.PI) / 180));
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLng: center.lng - lngDelta,
    maxLng: center.lng + lngDelta,
  };
}
