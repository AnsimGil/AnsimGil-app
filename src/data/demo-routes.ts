import type { Coordinate } from '../types/geo';

// Deliberately local data for a repeatable two-day prototype demonstration.
export const demoNormalRoute: Coordinate[] = [
  { latitude: 37.5665, longitude: 126.9780 },
  { latitude: 37.5660, longitude: 126.9805 },
  { latitude: 37.5662, longitude: 126.9830 },
  { latitude: 37.5678, longitude: 126.9860 },
  { latitude: 37.5690, longitude: 126.9885 },
  { latitude: 37.5705, longitude: 126.9920 },
];

export const demoSafeRoute: Coordinate[] = [
  { latitude: 37.5665, longitude: 126.9780 },
  { latitude: 37.5630, longitude: 126.9790 },
  { latitude: 37.5615, longitude: 126.9835 },
  { latitude: 37.5615, longitude: 126.9890 },
  { latitude: 37.5650, longitude: 126.9910 },
  { latitude: 37.5705, longitude: 126.9920 },
];
