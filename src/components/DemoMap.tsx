import { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Image,
  StyleSheet,
  Text,
  type LayoutChangeEvent,
  View,
} from 'react-native';

import type { DemoPlace } from '../data/demo-places';
import type { Coordinate } from '../types/geo';

type DemoMapProps = {
  route: Coordinate[];
  floodZone: Coordinate[][];
  currentLocation: Coordinate | null;
  destination: Coordinate | null;
  heading: number;
  routeColor: string;
  places: DemoPlace[];
  onLongPress?: (coordinate: Coordinate) => void;
};

type MapPoint = { x: number; y: number };
type MapBounds = { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number };
type MapSize = { width: number; height: number };

const EMPTY_SIZE: MapSize = { width: 0, height: 0 };
const SUBWAY_STATION_PLACE_IDS = new Set([
  'demo-jonggak-station',
  'demo-seoul-station',
  'demo-myeongdong-station',
  'demo-jamsil-station',
  'demo-gangnam-station',
]);
const CITY_HALL_PLACE_IDS = new Set(['demo-seoul-city-hall']);
const DONGDAEMUN_STATION_PLACE_IDS = new Set(['demo-dongdaemun-station']);
const GWANGHWAMUN_PLACE_IDS = new Set(['demo-gwanghwamun']);
const HIDDEN_PLACE_IDS = new Set(['demo-jonggak-station']);

function getBounds(points: Coordinate[]): MapBounds {
  const source = points.length > 0 ? points : [{ latitude: 37.5665, longitude: 126.978 }];
  const latitudes = source.map(({ latitude }) => latitude);
  const longitudes = source.map(({ longitude }) => longitude);
  const latitudeSpan = Math.max(Math.max(...latitudes) - Math.min(...latitudes), 0.001);
  const longitudeSpan = Math.max(Math.max(...longitudes) - Math.min(...longitudes), 0.001);
  const latitudePadding = latitudeSpan * 0.2;
  const longitudePadding = longitudeSpan * 0.2;

  return {
    minLatitude: Math.min(...latitudes) - latitudePadding,
    maxLatitude: Math.max(...latitudes) + latitudePadding,
    minLongitude: Math.min(...longitudes) - longitudePadding,
    maxLongitude: Math.max(...longitudes) + longitudePadding,
  };
}

function projectCoordinate(coordinate: Coordinate, bounds: MapBounds, size: MapSize): MapPoint {
  const longitudeSpan = bounds.maxLongitude - bounds.minLongitude;
  const latitudeSpan = bounds.maxLatitude - bounds.minLatitude;

  return {
    x: ((coordinate.longitude - bounds.minLongitude) / longitudeSpan) * size.width,
    y: ((bounds.maxLatitude - coordinate.latitude) / latitudeSpan) * size.height,
  };
}

function unprojectPoint(point: MapPoint, bounds: MapBounds, size: MapSize): Coordinate {
  const x = Math.min(Math.max(point.x, 0), size.width);
  const y = Math.min(Math.max(point.y, 0), size.height);
  const longitudeSpan = bounds.maxLongitude - bounds.minLongitude;
  const latitudeSpan = bounds.maxLatitude - bounds.minLatitude;

  return {
    latitude: bounds.maxLatitude - (y / size.height) * latitudeSpan,
    longitude: bounds.minLongitude + (x / size.width) * longitudeSpan,
  };
}

function getBoundingBox(points: MapPoint[]) {
  if (points.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return {
    minX: Math.min(...points.map(({ x }) => x)),
    maxX: Math.max(...points.map(({ x }) => x)),
    minY: Math.min(...points.map(({ y }) => y)),
    maxY: Math.max(...points.map(({ y }) => y)),
  };
}

function MapSegment({ from, to, color, width }: { from: MapPoint; to: MapPoint; color: string; width: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 1) return null;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.segment,
        {
          backgroundColor: color,
          height: width,
          left: (from.x + to.x) / 2 - length / 2,
          top: (from.y + to.y) / 2 - width / 2,
          transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
          width: length,
        },
      ]}
    />
  );
}

function handleDemoLongPress(
  point: MapPoint,
  size: MapSize,
  bounds: MapBounds,
  onLongPress?: (coordinate: Coordinate) => void,
  panOffset: MapPoint = { x: 0, y: 0 },
  zoomScale = 1,
) {
  if (!onLongPress || size.width === 0 || size.height === 0) return;
  const mapPoint = {
    x: (point.x - size.width / 2 - panOffset.x) / zoomScale + size.width / 2,
    y: (point.y - size.height / 2 - panOffset.y) / zoomScale + size.height / 2,
  };
  onLongPress(unprojectPoint(mapPoint, bounds, size));
}

export function DemoMap({
  route,
  floodZone,
  currentLocation,
  destination,
  heading,
  routeColor,
  places,
  onLongPress,
}: DemoMapProps) {
  const [size, setSize] = useState<MapSize>(EMPTY_SIZE);
  const [zoomStep, setZoomStep] = useState(0);
  const [panOffset, setPanOffset] = useState<MapPoint>({ x: 0, y: 0 });
  const lastTapAtRef = useRef(0);
  const panOffsetRef = useRef<MapPoint>({ x: 0, y: 0 });
  const gestureStartRef = useRef({ localX: 0, localY: 0, startedAt: 0, moved: false, panX: 0, panY: 0 });
  const allCoordinates = useMemo(
    () => [
      ...route,
      ...floodZone.flat(),
      ...places.filter((place) => !HIDDEN_PLACE_IDS.has(place.placeId)).map((place) => place.location),
      ...(currentLocation ? [currentLocation] : []),
      ...(destination ? [destination] : []),
    ],
    [currentLocation, destination, floodZone, places, route],
  );
  const bounds = useMemo(() => getBounds(allCoordinates), [allCoordinates]);
  const routePoints = useMemo(
    () => route.map((coordinate) => projectCoordinate(coordinate, bounds, size)),
    [bounds, route, size],
  );
  const floodPoints = useMemo(
    () => floodZone.map((polygon) => polygon.map((coordinate) => projectCoordinate(coordinate, bounds, size))),
    [bounds, floodZone, size],
  );
  const currentPoint = currentLocation ? projectCoordinate(currentLocation, bounds, size) : null;
  const destinationPoint = destination ? projectCoordinate(destination, bounds, size) : null;
  const placePoints = useMemo(
    () => places
      .filter((place) => !HIDDEN_PLACE_IDS.has(place.placeId))
      .map((place) => ({ place, point: projectCoordinate(place.location, bounds, size) })),
    [bounds, places, size],
  );
  const zoomScale = [1, 1.35, 1.8, 2.4][zoomStep];

  function clampPanOffset(offset: MapPoint, scale: number): MapPoint {
    const maxX = Math.max(0, (size.width * scale - size.width) / 2);
    const maxY = Math.max(0, (size.height * scale - size.height) / 2);
    return {
      x: Math.min(Math.max(offset.x, -maxX), maxX),
      y: Math.min(Math.max(offset.y, -maxY), maxY),
    };
  }

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          gestureStartRef.current = {
            localX: event.nativeEvent.locationX,
            localY: event.nativeEvent.locationY,
            startedAt: Date.now(),
            moved: false,
            panX: panOffsetRef.current.x,
            panY: panOffsetRef.current.y,
          };
        },
        onPanResponderMove: (_, gestureState) => {
          if (Math.abs(gestureState.dx) > 3 || Math.abs(gestureState.dy) > 3) {
            gestureStartRef.current.moved = true;
          }

          if (zoomStep === 0) return;

          const nextOffset = clampPanOffset(
            {
              x: gestureStartRef.current.panX + gestureState.dx,
              y: gestureStartRef.current.panY + gestureState.dy,
            },
            zoomScale,
          );
          panOffsetRef.current = nextOffset;
          setPanOffset(nextOffset);
        },
        onPanResponderRelease: () => {
          const gesture = gestureStartRef.current;
          const duration = Date.now() - gesture.startedAt;
          if (!gesture.moved && duration >= 450) {
            handleDemoLongPress(
              { x: gesture.localX, y: gesture.localY },
              size,
              bounds,
              onLongPress,
              panOffsetRef.current,
              zoomScale,
            );
            return;
          }

          if (gesture.moved || duration >= 450) {
            lastTapAtRef.current = 0;
            return;
          }

          const now = Date.now();
          if (now - lastTapAtRef.current < 320) {
            const nextZoomStep = zoomStep >= 3 ? 0 : zoomStep + 1;
            setZoomStep(nextZoomStep);
            const centeredOffset = { x: 0, y: 0 };
            panOffsetRef.current = centeredOffset;
            setPanOffset(centeredOffset);
            lastTapAtRef.current = 0;
          } else {
            lastTapAtRef.current = now;
          }
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [bounds, onLongPress, size, zoomScale, zoomStep],
  );

  return (
    <View style={[StyleSheet.absoluteFill, styles.mapContainer]} onLayout={handleLayout} {...panResponder.panHandlers}>
      <View
        pointerEvents="none"
        style={[styles.surface, { transform: [{ translateX: panOffset.x }, { translateY: panOffset.y }, { scale: zoomScale }] }]}
      >
          <Image
            source={require('../../assets/demo-map-background.png')}
            resizeMode="cover"
            style={styles.backgroundImage}
          />

          {floodPoints.map((points, index) => {
            if (points.length < 3) return null;
            const floodBox = getBoundingBox(points);
            return (
              <View
                key={`flood-zone-${index}`}
                style={[
                  styles.floodZone,
                  {
                    height: Math.max(floodBox.maxY - floodBox.minY, 12),
                    left: floodBox.minX,
                    top: floodBox.minY,
                    width: Math.max(floodBox.maxX - floodBox.minX, 12),
                  },
                ]}
              />
            );
          })}

          {routePoints.slice(1).map((point, index) => (
            <MapSegment
              key={`route-${index}`}
              from={routePoints[index]}
              to={point}
              color={routeColor}
              width={6}
            />
          ))}

          {placePoints.map(({ place, point }) => {
            const isSubwayStation = SUBWAY_STATION_PLACE_IDS.has(place.placeId);
            const isCityHall = CITY_HALL_PLACE_IDS.has(place.placeId);
            const isDongdaemunStation = DONGDAEMUN_STATION_PLACE_IDS.has(place.placeId);
            const isGwanghwamun = GWANGHWAMUN_PLACE_IDS.has(place.placeId);
            const hasCustomIcon = isSubwayStation || isCityHall || isDongdaemunStation || isGwanghwamun;
            return (
              <View
                key={place.placeId}
                pointerEvents="none"
                style={[styles.placeMarker, { left: point.x - 60, top: point.y - (isCityHall || isGwanghwamun ? 17 : isDongdaemunStation ? 14 : hasCustomIcon ? 14 : 8) }]}
              >
                {isCityHall ? (
                  <Image
                    source={require('../../assets/demo-city-hall-icon.png')}
                    resizeMode="contain"
                    style={styles.cityHallIcon}
                  />
                ) : isGwanghwamun ? (
                  <Image
                    source={require('../../assets/demo-gwanghwamun-icon.png')}
                    resizeMode="contain"
                    style={styles.gwanghwamunIcon}
                  />
                ) : isDongdaemunStation ? (
                  <Image
                    source={require('../../assets/demo-dongdaemun-icon.png')}
                    resizeMode="contain"
                    style={styles.dongdaemunIcon}
                  />
                ) : isSubwayStation ? (
                  <Image
                    source={require('../../assets/demo-subway-icon.png')}
                    resizeMode="contain"
                    style={styles.subwayIcon}
                  />
                ) : (
                  <View style={styles.placeNode}>
                    <View style={styles.placeNodeInner} />
                  </View>
                )}
                <Text style={styles.placeLabel} numberOfLines={1}>
                  {place.name}
                </Text>
              </View>
            );
          })}

          {destinationPoint ? (
            <View style={[styles.destinationMarker, { left: destinationPoint.x - 8, top: destinationPoint.y - 8 }]}>
              <View style={styles.destinationMarkerInner} />
            </View>
          ) : null}

          {currentPoint ? (
            <View
              style={[
                styles.currentMarker,
                {
                  left: currentPoint.x - 15,
                  top: currentPoint.y - 15,
                  transform: [{ rotate: `${heading}deg` }],
                },
              ]}
            >
              <View style={styles.currentArrow} />
              <View style={styles.currentMarkerDot} />
            </View>
          ) : null}

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mapContainer: { backgroundColor: '#DCEEEB', overflow: 'hidden' },
  surface: { backgroundColor: '#DCEEEB', flex: 1, overflow: 'hidden' },
  backgroundImage: { height: '100%', position: 'absolute', width: '100%' },
  floodZone: { backgroundColor: 'rgba(239,68,68,0.24)', borderColor: '#DC2626', borderRadius: 6, borderWidth: 2, position: 'absolute' },
  segment: { borderRadius: 20, position: 'absolute' },
  placeMarker: { alignItems: 'center', position: 'absolute', width: 120 },
  placeNode: { alignItems: 'center', backgroundColor: '#0F766E', borderColor: '#FFFFFF', borderRadius: 9, borderWidth: 2, height: 18, justifyContent: 'center', width: 18 },
  placeNodeInner: { backgroundColor: '#CCFBF1', borderRadius: 3, height: 5, width: 5 },
  subwayIcon: { height: 26, width: 26 },
  cityHallIcon: { height: 34, width: 34 },
  gwanghwamunIcon: { height: 34, width: 34 },
  dongdaemunIcon: { height: 28, width: 78 },
  placeLabel: { backgroundColor: 'rgba(255,255,255,0.88)', borderRadius: 5, color: '#115E59', fontSize: 9, fontWeight: '800', marginTop: 3, maxWidth: 120, paddingHorizontal: 4, textAlign: 'center' },
  destinationMarker: { alignItems: 'center', backgroundColor: '#7C3AED', borderColor: '#FFFFFF', borderRadius: 9, borderWidth: 2, height: 16, justifyContent: 'center', position: 'absolute', width: 16 },
  destinationMarkerInner: { backgroundColor: '#FFFFFF', borderRadius: 3, height: 5, width: 5 },
  currentMarker: { alignItems: 'center', height: 30, justifyContent: 'center', position: 'absolute', width: 30 },
  currentArrow: { borderBottomColor: '#0F766E', borderBottomWidth: 13, borderLeftColor: 'transparent', borderLeftWidth: 7, borderRightColor: 'transparent', borderRightWidth: 7, height: 0, position: 'absolute', top: 1, width: 0 },
  currentMarkerDot: { backgroundColor: '#FFFFFF', borderColor: '#0F766E', borderRadius: 8, borderWidth: 3, height: 16, width: 16 },
});
