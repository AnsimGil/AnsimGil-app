import type { Coordinate } from '../types/geo';

export type DemoFloodZone = {
  id: string;
  name: string;
  adminRegion: string;
  coordinates: Coordinate[];
};

// Deliberately labeled local demo data. Each zone is placed near one selectable
// demo origin and carries the same administrative region label used by the
// scenario explanation.
export const demoFloodZones: DemoFloodZone[] = [
  {
    id: 'demo-seoul-city-hall-flood-001',
    name: '서울 중구 시청 인근 시연용 침수 위험구역',
    adminRegion: '서울특별시 중구',
    coordinates: [
      { latitude: 37.5695, longitude: 126.9800 },
      { latitude: 37.5695, longitude: 126.9885 },
      { latitude: 37.5668, longitude: 126.9885 },
      { latitude: 37.5668, longitude: 126.9800 },
    ],
  },
  {
    id: 'demo-seoul-station-flood-001',
    name: '서울 용산구 서울역 인근 시연용 침수 위험구역',
    adminRegion: '서울특별시 용산구',
    coordinates: [
      { latitude: 37.5562, longitude: 126.9730 },
      { latitude: 37.5562, longitude: 126.9780 },
      { latitude: 37.5530, longitude: 126.9780 },
      { latitude: 37.5530, longitude: 126.9730 },
    ],
  },
  {
    id: 'demo-gwanghwamun-flood-001',
    name: '서울 종로구 광화문 인근 시연용 침수 위험구역',
    adminRegion: '서울특별시 종로구',
    coordinates: [
      { latitude: 37.5740, longitude: 126.9780 },
      { latitude: 37.5740, longitude: 126.9830 },
      { latitude: 37.5705, longitude: 126.9830 },
      { latitude: 37.5705, longitude: 126.9780 },
    ],
  },
  {
    id: 'demo-myeongdong-flood-001',
    name: '서울 중구 명동 인근 시연용 침수 위험구역',
    adminRegion: '서울특별시 중구',
    coordinates: [
      { latitude: 37.5620, longitude: 126.9890 },
      { latitude: 37.5620, longitude: 126.9930 },
      { latitude: 37.5580, longitude: 126.9930 },
      { latitude: 37.5580, longitude: 126.9890 },
    ],
  },
  {
    id: 'demo-dongdaemun-flood-001',
    name: '서울 중구 동대문 인근 시연용 침수 위험구역',
    adminRegion: '서울특별시 중구',
    coordinates: [
      { latitude: 37.5680, longitude: 127.0040 },
      { latitude: 37.5680, longitude: 127.0080 },
      { latitude: 37.5635, longitude: 127.0080 },
      { latitude: 37.5635, longitude: 127.0040 },
    ],
  },
  {
    id: 'demo-gangnam-flood-001',
    name: '서울 강남구 강남역 인근 시연용 침수 위험구역',
    adminRegion: '서울특별시 강남구',
    coordinates: [
      { latitude: 37.5010, longitude: 127.0300 },
      { latitude: 37.5010, longitude: 127.0350 },
      { latitude: 37.4960, longitude: 127.0350 },
      { latitude: 37.4960, longitude: 127.0300 },
    ],
  },
  {
    id: 'demo-jamsil-flood-001',
    name: '서울 송파구 잠실역 인근 시연용 침수 위험구역',
    adminRegion: '서울특별시 송파구',
    coordinates: [
      { latitude: 37.5160, longitude: 127.1050 },
      { latitude: 37.5160, longitude: 127.1100 },
      { latitude: 37.5110, longitude: 127.1100 },
      { latitude: 37.5110, longitude: 127.1050 },
    ],
  },
];

// Keep the original export for existing callers. It represents the default
// Seoul City Hall scenario.
export const demoFloodZone = demoFloodZones[0].coordinates;

export function getNearestDemoFloodZone(origin: Coordinate): DemoFloodZone {
  return demoFloodZones.reduce((nearest, zone) =>
    squaredDistance(origin, [getZoneCenter(zone)]) <
      squaredDistance(origin, [getZoneCenter(nearest)])
      ? zone
      : nearest,
  );
}

/**
 * Returns every demo danger area in the administrative region nearest to the
 * supplied starting point. This is used before a destination is selected so
 * the notification demo can show the complete local danger context first.
 */
export function getDemoFloodZonesNearLocation(origin: Coordinate): DemoFloodZone[] {
  const nearestZone = getNearestDemoFloodZone(origin);
  const nearbyZones = demoFloodZones
    .filter((zone) => zone.adminRegion === nearestZone.adminRegion)
    .sort(
      (first, second) =>
        squaredDistance(origin, [getZoneCenter(first)]) -
        squaredDistance(origin, [getZoneCenter(second)]),
    );

  return nearbyZones.length > 0 ? nearbyZones : [nearestZone];
}

/**
 * Returns the demo danger areas that belong to the requested journey. The
 * nearest area to each endpoint is always retained; other areas are included
 * when their center lies close to the straight journey corridor.
 */
export function getDemoFloodZonesForRoute(
  origin: Coordinate,
  destination: Coordinate,
): DemoFloodZone[] {
  const originZone = getNearestDemoFloodZone(origin);
  const destinationZone = getNearestDemoFloodZone(destination);
  const endpointZoneIds = new Set([originZone.id, destinationZone.id]);
  const latitudeScale = Math.cos((origin.latitude * Math.PI) / 180);
  const deltaLatitude = destination.latitude - origin.latitude;
  const deltaLongitude = (destination.longitude - origin.longitude) * latitudeScale;
  const journeyLengthSquared = deltaLatitude * deltaLatitude + deltaLongitude * deltaLongitude;
  const corridorRadius = 0.009;

  const selected = demoFloodZones.filter((zone) => {
    if (endpointZoneIds.has(zone.id)) return true;

    const center = getZoneCenter(zone);
    const pointLatitude = center.latitude - origin.latitude;
    const pointLongitude = (center.longitude - origin.longitude) * latitudeScale;
    const progress = journeyLengthSquared === 0
      ? 0
      : (pointLatitude * deltaLatitude + pointLongitude * deltaLongitude) / journeyLengthSquared;
    const clampedProgress = Math.min(1, Math.max(0, progress));
    const closestLatitude = deltaLatitude * clampedProgress;
    const closestLongitude = deltaLongitude * clampedProgress;
    const distanceFromCorridor = Math.sqrt(
      (pointLatitude - closestLatitude) ** 2 +
      (pointLongitude - closestLongitude) ** 2,
    );

    return progress >= 0 && progress <= 1 && distanceFromCorridor <= corridorRadius;
  });

  return selected.sort((first, second) => {
    const firstProgress = routeProgress(origin, destination, getZoneCenter(first));
    const secondProgress = routeProgress(origin, destination, getZoneCenter(second));
    return firstProgress - secondProgress;
  });
}

function getZoneCenter(zone: DemoFloodZone): Coordinate {
  return zone.coordinates.reduce(
    (total, coordinate) => ({
      latitude: total.latitude + coordinate.latitude / zone.coordinates.length,
      longitude: total.longitude + coordinate.longitude / zone.coordinates.length,
    }),
    { latitude: 0, longitude: 0 },
  );
}

function squaredDistance(origin: Coordinate, points: Coordinate[]) {
  const latitudeScale = Math.cos((origin.latitude * Math.PI) / 180);
  return Math.min(
    ...points.map((point) => {
      const latitudeDelta = point.latitude - origin.latitude;
      const longitudeDelta = (point.longitude - origin.longitude) * latitudeScale;
      return latitudeDelta * latitudeDelta + longitudeDelta * longitudeDelta;
    }),
  );
}

function routeProgress(origin: Coordinate, destination: Coordinate, point: Coordinate) {
  const latitudeScale = Math.cos((origin.latitude * Math.PI) / 180);
  const deltaLatitude = destination.latitude - origin.latitude;
  const deltaLongitude = (destination.longitude - origin.longitude) * latitudeScale;
  const journeyLengthSquared = deltaLatitude * deltaLatitude + deltaLongitude * deltaLongitude;
  if (journeyLengthSquared === 0) return 0;

  return (
    (point.latitude - origin.latitude) * deltaLatitude +
    (point.longitude - origin.longitude) * latitudeScale * deltaLongitude
  ) / journeyLengthSquared;
}
