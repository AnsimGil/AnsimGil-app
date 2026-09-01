import type { Coordinate } from '../types/geo';

const DEGREE_TO_RADIAN = Math.PI / 180;
const RADIAN_TO_DEGREE = 180 / Math.PI;

export function calculateBearing(from: Coordinate, to: Coordinate): number {
  const fromLatitude = from.latitude * DEGREE_TO_RADIAN;
  const toLatitude = to.latitude * DEGREE_TO_RADIAN;
  const longitudeDelta = (to.longitude - from.longitude) * DEGREE_TO_RADIAN;

  const y = Math.sin(longitudeDelta) * Math.cos(toLatitude);
  const x =
    Math.cos(fromLatitude) * Math.sin(toLatitude) -
    Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(longitudeDelta);

  return (Math.atan2(y, x) * RADIAN_TO_DEGREE + 360) % 360;
}

export function calculateRouteDistance(route: Coordinate[]): number {
  return route.slice(1).reduce((total, coordinate, index) => {
    return total + calculateDistance(route[index], coordinate);
  }, 0);
}

export function findNearestRouteIndex(route: Coordinate[], target: Coordinate): number {
  if (route.length === 0) return 0;

  const latitudeScale = Math.cos(target.latitude * DEGREE_TO_RADIAN);
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  route.forEach((coordinate, index) => {
    const latitudeDelta = coordinate.latitude - target.latitude;
    const longitudeDelta = (coordinate.longitude - target.longitude) * latitudeScale;
    const distance = latitudeDelta * latitudeDelta + longitudeDelta * longitudeDelta;

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

export function routeReachesDestination(
  route: Coordinate[],
  destination: Coordinate,
  toleranceMeters = 500,
): boolean {
  if (route.length < 2) return false;
  return calculateDistance(route[route.length - 1], destination) <= toleranceMeters;
}

export function createFallbackRoute(
  origin: Coordinate,
  destination: Coordinate,
): Coordinate[] {
  const latitudeDelta = destination.latitude - origin.latitude;
  const longitudeDelta = destination.longitude - origin.longitude;
  return [
    origin,
    {
      latitude: origin.latitude + latitudeDelta * 0.33,
      longitude: origin.longitude + longitudeDelta * 0.33,
    },
    {
      latitude: origin.latitude + latitudeDelta * 0.67,
      longitude: origin.longitude + longitudeDelta * 0.67,
    },
    destination,
  ];
}

type Bounds = {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
};

const DEMO_ROUTE_MAX_SEGMENT_METERS = 70;
type FloodZonePolygon = Coordinate[];

/**
 * Builds a deterministic keyless-demo route around the supplied flood
 * polygon. Candidate paths follow the nearest side of the polygon's expanded
 * bounding box, then the shortest valid candidate is selected. This is a
 * geometric demo route, not a replacement for a road-network router.
 */
export function createSafeFallbackRoute(
  origin: Coordinate,
  destination: Coordinate,
  floodZones: FloodZonePolygon | FloodZonePolygon[],
): Coordinate[] {
  const polygons = normalizeFloodZones(floodZones);
  if (polygons.length === 0) return createFallbackRoute(origin, destination);

  const margin = 0.00045;
  const obstacleCorners = polygons.flatMap((polygon) => {
    const bounds = getBounds(polygon);
    return [
      { latitude: bounds.maxLatitude + margin, longitude: bounds.minLongitude - margin },
      { latitude: bounds.maxLatitude + margin, longitude: bounds.maxLongitude + margin },
      { latitude: bounds.minLatitude - margin, longitude: bounds.maxLongitude + margin },
      { latitude: bounds.minLatitude - margin, longitude: bounds.minLongitude - margin },
    ];
  });
  const nodes = [origin, destination, ...obstacleCorners];
  const route = findShortestVisibleRoute(nodes, polygons);

  return densifyRoute(removeConsecutivePoints(route ?? [origin, destination]));
}

function normalizeFloodZones(
  floodZones: FloodZonePolygon | FloodZonePolygon[],
): FloodZonePolygon[] {
  if (floodZones.length === 0) return [];
  if ('latitude' in floodZones[0]) return [floodZones as FloodZonePolygon];
  return (floodZones as FloodZonePolygon[]).filter((polygon) => polygon.length >= 3);
}

function findShortestVisibleRoute(nodes: Coordinate[], polygons: FloodZonePolygon[]) {
  const distances = nodes.map(() => Number.POSITIVE_INFINITY);
  const previous = nodes.map(() => -1);
  const visited = nodes.map(() => false);
  distances[0] = 0;

  for (let iteration = 0; iteration < nodes.length; iteration += 1) {
    let currentIndex = -1;
    for (let index = 0; index < nodes.length; index += 1) {
      if (!visited[index] && (currentIndex === -1 || distances[index] < distances[currentIndex])) {
        currentIndex = index;
      }
    }
    if (currentIndex === -1 || !Number.isFinite(distances[currentIndex])) break;
    visited[currentIndex] = true;
    if (currentIndex === 1) break;

    for (let nextIndex = 0; nextIndex < nodes.length; nextIndex += 1) {
      if (visited[nextIndex] || currentIndex === nextIndex) continue;
      if (segmentIntersectsAnyPolygon(nodes[currentIndex], nodes[nextIndex], polygons)) continue;

      const nextDistance = distances[currentIndex] + calculateDistance(nodes[currentIndex], nodes[nextIndex]);
      if (nextDistance < distances[nextIndex]) {
        distances[nextIndex] = nextDistance;
        previous[nextIndex] = currentIndex;
      }
    }
  }

  if (previous[1] === -1) return null;

  const route: Coordinate[] = [];
  let currentIndex = 1;
  while (currentIndex !== -1) {
    route.unshift(nodes[currentIndex]);
    currentIndex = previous[currentIndex];
  }
  return route;
}

function getBounds(points: Coordinate[]): Bounds {
  return {
    minLatitude: Math.min(...points.map((point) => point.latitude)),
    maxLatitude: Math.max(...points.map((point) => point.latitude)),
    minLongitude: Math.min(...points.map((point) => point.longitude)),
    maxLongitude: Math.max(...points.map((point) => point.longitude)),
  };
}

function segmentIntersectsPolygon(from: Coordinate, to: Coordinate, polygon: Coordinate[]) {
  if (isInsidePolygon(from, polygon) || isInsidePolygon(to, polygon)) return true;
  return polygon.some((point, index) => {
    const nextPoint = polygon[(index + 1) % polygon.length];
    return segmentsIntersect(from, to, point, nextPoint);
  });
}

function segmentIntersectsAnyPolygon(
  from: Coordinate,
  to: Coordinate,
  polygons: FloodZonePolygon[],
) {
  return polygons.some((polygon) => segmentIntersectsPolygon(from, to, polygon));
}

function isInsidePolygon(point: Coordinate, polygon: Coordinate[]) {
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index++) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    const intersects =
      current.longitude > point.longitude !== previous.longitude > point.longitude &&
      point.latitude <
        ((previous.latitude - current.latitude) * (point.longitude - current.longitude)) /
          (previous.longitude - current.longitude) +
          current.latitude;
    if (intersects) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(
  firstStart: Coordinate,
  firstEnd: Coordinate,
  secondStart: Coordinate,
  secondEnd: Coordinate,
) {
  const firstOrientation = orientation(firstStart, firstEnd, secondStart);
  const secondOrientation = orientation(firstStart, firstEnd, secondEnd);
  const thirdOrientation = orientation(secondStart, secondEnd, firstStart);
  const fourthOrientation = orientation(secondStart, secondEnd, firstEnd);

  if (firstOrientation === 0 && onSegment(firstStart, secondStart, firstEnd)) return true;
  if (secondOrientation === 0 && onSegment(firstStart, secondEnd, firstEnd)) return true;
  if (thirdOrientation === 0 && onSegment(secondStart, firstStart, secondEnd)) return true;
  if (fourthOrientation === 0 && onSegment(secondStart, firstEnd, secondEnd)) return true;

  return firstOrientation !== secondOrientation && thirdOrientation !== fourthOrientation;
}

function orientation(first: Coordinate, second: Coordinate, third: Coordinate) {
  const value =
    (second.longitude - first.longitude) * (third.latitude - first.latitude) -
    (second.latitude - first.latitude) * (third.longitude - first.longitude);
  if (Math.abs(value) < 1e-10) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(first: Coordinate, point: Coordinate, second: Coordinate) {
  return (
    point.longitude <= Math.max(first.longitude, second.longitude) &&
    point.longitude >= Math.min(first.longitude, second.longitude) &&
    point.latitude <= Math.max(first.latitude, second.latitude) &&
    point.latitude >= Math.min(first.latitude, second.latitude)
  );
}

function removeConsecutivePoints(route: Coordinate[]) {
  return route.filter((point, index) => {
    if (index === 0) return true;
    return point.latitude !== route[index - 1].latitude || point.longitude !== route[index - 1].longitude;
  });
}

function densifyRoute(route: Coordinate[]) {
  const densified: Coordinate[] = [route[0]];
  route.slice(1).forEach((point, index) => {
    const previous = route[index];
    const segmentDistance = calculateDistance(previous, point);
    const segmentCount = Math.max(1, Math.ceil(segmentDistance / DEMO_ROUTE_MAX_SEGMENT_METERS));
    for (let step = 1; step <= segmentCount; step += 1) {
      const progress = step / segmentCount;
      densified.push({
        latitude: previous.latitude + (point.latitude - previous.latitude) * progress,
        longitude: previous.longitude + (point.longitude - previous.longitude) * progress,
      });
    }
  });
  return densified;
}

function calculateDistance(from: Coordinate, to: Coordinate): number {
  const earthRadiusMeters = 6_371_000;
  const fromLatitude = from.latitude * DEGREE_TO_RADIAN;
  const toLatitude = to.latitude * DEGREE_TO_RADIAN;
  const latitudeDelta = (to.latitude - from.latitude) * DEGREE_TO_RADIAN;
  const longitudeDelta = (to.longitude - from.longitude) * DEGREE_TO_RADIAN;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}
