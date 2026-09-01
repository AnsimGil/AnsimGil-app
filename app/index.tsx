import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, Polygon, Polyline, PROVIDER_GOOGLE, WMSTile } from 'react-native-maps';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as Clipboard from 'expo-clipboard';
import * as Notifications from 'expo-notifications';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  demoFloodZone,
  getDemoFloodZonesForRoute,
  getDemoFloodZonesNearLocation,
} from '../src/data/demo-flood-zones';
import { demoPlaces, findDemoPlace, searchDemoPlaces, type DemoPlace } from '../src/data/demo-places';
import { DemoMap } from '../src/components/DemoMap';
import { requestedFloodMapMode } from '../src/config/flood-map';
import { isGoogleMapEnabled, isGoogleMapRequestedWithoutKey } from '../src/config/map';
import {
  API_BASE_URL,
  extractRouteCoordinates,
  extractFloodZoneCoordinates,
  requestFloodZones,
  requestNormalRoute,
  requestPlaceAutocomplete,
  requestPlaceDetails,
  requestSafeRoute,
  requestShortTermWeather,
  requestTrigger,
} from '../src/lib/api';
import {
  calculateBearing,
  calculateRouteDistance,
  createFallbackRoute,
  createSafeFallbackRoute,
  findNearestRouteIndex,
  routeReachesDestination,
} from '../src/lib/navigation';
import {
  registerForPushNotificationsAsync,
  scheduleDemoFloodNotificationAsync,
  type PushRegistrationResult,
} from '../src/services/notifications';
import type { Coordinate, PlaceDetailsResponse, PlaceSuggestion, WeatherResponse } from '../src/types/geo';

type RouteMode = 'normal' | 'safe';
type AppMode = 'demo' | 'live';
type DemoScenario = 'normal' | 'triggered';
type RouteEndpoint = 'destination';
type NotificationDataMode = 'demo' | 'live' | 'test';

const SEOUL: Coordinate = { latitude: 37.5665, longitude: 126.978 };
const SEOUL_CITY_HALL: Coordinate = { latitude: 37.5663, longitude: 126.9779 };
const INITIAL_REGION = { ...SEOUL, latitudeDelta: 0.035, longitudeDelta: 0.035 };
const CAMERA_PITCH = 55;
const CAMERA_ZOOM = 18;
const FLOOD_ZONE_LABEL: Coordinate = { latitude: 37.5655, longitude: 126.984 };
const SHEET_HANDLE_HEIGHT = 46;
const DEMO_SIMULATION_TARGET_STEPS = 12;
const DEMO_SIMULATION_INTERVAL_MS = 650;
const DEMO_ORIGIN_PLACE_IDS = [
  'demo-seoul-city-hall',
  'demo-seoul-station',
  'demo-gwanghwamun',
  'demo-myeongdong-station',
  'demo-dongdaemun-station',
  'demo-gangnam-station',
  'demo-jamsil-station',
] as const;
const DEMO_ORIGIN_PLACES = DEMO_ORIGIN_PLACE_IDS
  .map((placeId) => findDemoPlace(placeId))
  .filter((place): place is DemoPlace => Boolean(place));

// A notification tap can create another Home route instance while the app
// process is still alive. Keep the navigation position at module scope so a
// new screen instance does not fall back to the emulator's initial GPS fix.
const navigationSessionStore: {
  currentLocation: Coordinate | null;
  guidanceLocation: Coordinate | null;
} = {
  currentLocation: null,
  guidanceLocation: null,
};

function formatCoordinate({ latitude, longitude }: Coordinate) {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function parseCoordinate(value: string): Coordinate | null {
  const [latitudeText, longitudeText] = value.split(',').map((part) => part.trim());
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function parseNotificationCoordinate(
  url: unknown,
  latitudeKey: string,
  longitudeKey: string,
): Coordinate | null {
  if (typeof url !== 'string') return null;

  const latitudeMatch = new RegExp(`[?&]${latitudeKey}=([^&]+)`).exec(url);
  const longitudeMatch = new RegExp(`[?&]${longitudeKey}=([^&]+)`).exec(url);
  if (!latitudeMatch || !longitudeMatch) return null;

  let latitude: number;
  let longitude: number;
  try {
    latitude = Number(decodeURIComponent(latitudeMatch[1]));
    longitude = Number(decodeURIComponent(longitudeMatch[1]));
  } catch {
    return null;
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function parseNotificationDestination(url: unknown): Coordinate | null {
  return parseNotificationCoordinate(url, 'destinationLatitude', 'destinationLongitude');
}

function parseCoordinateParams(latitudeText?: string, longitudeText?: string): Coordinate | null {
  if (!latitudeText || !longitudeText) return null;
  return parseCoordinate(`${latitudeText}, ${longitudeText}`);
}

function formatDistance(distanceMeters: number) {
  if (distanceMeters < 1000) return `${Math.max(1, Math.round(distanceMeters))}m`;
  return `${(distanceMeters / 1000).toFixed(1)}km`;
}

function formatEta(distanceMeters: number) {
  return `${Math.max(1, Math.ceil(distanceMeters / 250))}분`;
}

function floodRiskLabel(riskLevel: WeatherResponse['riskLevel']) {
  return riskLevel === 'EXPECTED'
    ? '높음'
    : riskLevel === 'POSSIBLE'
      ? '주의'
      : '강수 신호 없음';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

export default function HomeScreen() {
  const {
    floodAlert,
    dataMode: notificationDataModeParam,
    originLatitude,
    originLongitude,
    destinationLatitude,
    destinationLongitude,
  } = useLocalSearchParams<{
    floodAlert?: string;
    dataMode?: string;
    originLatitude?: string;
    originLongitude?: string;
    destinationLatitude?: string;
    destinationLongitude?: string;
  }>();
  const mapRef = useRef<MapView | null>(null);
  const previousRouteModeRef = useRef<RouteMode>('normal');
  const notificationRouteRequestedRef = useRef(false);
  const sheetTranslateY = useRef(new Animated.Value(0)).current;
  const sheetOffsetRef = useRef(0);
  const sheetHeightRef = useRef(0);
  const [originText, setOriginText] = useState(formatCoordinate(SEOUL_CITY_HALL));
  const [destinationText, setDestinationText] = useState('');
  const [destinationQuery, setDestinationQuery] = useState('');
  const [destinationSuggestions, setDestinationSuggestions] = useState<PlaceSuggestion[]>([]);
  const [placeSearchingEndpoint, setPlaceSearchingEndpoint] = useState<RouteEndpoint | null>(null);
  const [placeSearchMessage, setPlaceSearchMessage] = useState<string | null>(null);
  const placeSearchRequestIdRef = useRef(0);
  const routeRequestIdRef = useRef(0);
  const currentLocationRef = useRef<Coordinate | null>(navigationSessionStore.currentLocation);
  const guidanceLocationRef = useRef<Coordinate | null>(navigationSessionStore.guidanceLocation);
  const [routeRenderKey, setRouteRenderKey] = useState(0);
  const [destinationCoordinate, setDestinationCoordinate] = useState<Coordinate | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Coordinate | null>(
    navigationSessionStore.currentLocation,
  );
  const [normalRouteCoordinates, setNormalRouteCoordinates] = useState<Coordinate[]>([]);
  const [safeRouteCoordinates, setSafeRouteCoordinates] = useState<Coordinate[]>([]);
  const [floodZoneCoordinates, setFloodZoneCoordinates] = useState<Coordinate[][]>([]);
  const [floodMapIsLive, setFloodMapIsLive] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>('demo');
  const [demoScenario, setDemoScenario] = useState<DemoScenario>('normal');
  const [routeMode, setRouteMode] = useState<RouteMode>('normal');
  const [floodAlertActive, setFloodAlertActive] = useState(false);
  const [simulationIndex, setSimulationIndex] = useState(0);
  const [movementHeading, setMovementHeading] = useState(0);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isGuidancePaused, setIsGuidancePaused] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [routeMessage, setRouteMessage] = useState('목적지를 입력하고 경로 안내를 시작하세요.');
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);
  const [weatherForecast, setWeatherForecast] = useState<WeatherResponse | null>(null);
  const [pushStatus, setPushStatus] = useState<PushRegistrationResult | null>(null);
  const [pushCopyStatus, setPushCopyStatus] = useState<string | null>(null);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [isSheetCollapsed, setIsSheetCollapsed] = useState(true);
  const [liveCommandCopyStatus, setLiveCommandCopyStatus] = useState<string | null>(null);
  const [demoOriginCoordinate, setDemoOriginCoordinate] = useState<Coordinate>(SEOUL_CITY_HALL);
  const [demoNotificationStatus, setDemoNotificationStatus] = useState<string | null>(null);
  const [foregroundFloodAlert, setForegroundFloodAlert] = useState<{
    dataMode: NotificationDataMode | null;
    notificationId: string;
    origin: Coordinate | null;
    destination: Coordinate | null;
  } | null>(null);
  const foregroundNotificationIdRef = useRef<string | null>(null);
  const [foregroundAlertDataMode, setForegroundAlertDataMode] = useState<NotificationDataMode | null>(null);
  const floodAlertRequested = floodAlert === 'true';
  const notificationDataMode =
    notificationDataModeParam === 'test' ||
    notificationDataModeParam === 'live' ||
    notificationDataModeParam === 'demo'
      ? notificationDataModeParam
      : null;
  const notificationDestination = useMemo(() => {
    const latitude = Number(destinationLatitude);
    const longitude = Number(destinationLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    return { latitude, longitude };
  }, [destinationLatitude, destinationLongitude]);
  const notificationOrigin = useMemo(
    () => parseCoordinateParams(originLatitude, originLongitude),
    [originLatitude, originLongitude],
  );
  const isTestFixtureAlert =
    (floodAlertRequested && notificationDataMode === 'test') ||
    foregroundAlertDataMode === 'test';

  const collapsedSheetOffset = Math.max(sheetHeight - SHEET_HANDLE_HEIGHT, 0);
  const sheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 5,
        onPanResponderGrant: () => {
          sheetTranslateY.stopAnimation((value) => {
            sheetOffsetRef.current = value;
          });
        },
        onPanResponderMove: (_, gestureState) => {
          const nextOffset = Math.min(
            collapsedSheetOffset,
            Math.max(0, sheetOffsetRef.current + gestureState.dy),
          );
          sheetTranslateY.setValue(nextOffset);
        },
        onPanResponderRelease: (_, gestureState) => {
          const currentOffset = sheetOffsetRef.current + gestureState.dy;
          const shouldCollapse =
            gestureState.vy > 0.35 ||
            (gestureState.vy >= -0.35 && currentOffset > collapsedSheetOffset / 2);
          const nextOffset = shouldCollapse ? collapsedSheetOffset : 0;
          sheetOffsetRef.current = nextOffset;
          setIsSheetCollapsed(shouldCollapse && collapsedSheetOffset > 0);
          Animated.spring(sheetTranslateY, {
            damping: 22,
            mass: 0.8,
            stiffness: 180,
            toValue: nextOffset,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          const nextOffset = isSheetCollapsed ? collapsedSheetOffset : 0;
          sheetOffsetRef.current = nextOffset;
          Animated.spring(sheetTranslateY, {
            damping: 22,
            mass: 0.8,
            stiffness: 180,
            toValue: nextOffset,
            useNativeDriver: true,
          }).start();
        },
      }),
    [collapsedSheetOffset, isSheetCollapsed, sheetTranslateY],
  );

  function handleSheetLayout(event: { nativeEvent: { layout: { height: number } } }) {
    const nextHeight = event.nativeEvent.layout.height;
    if (nextHeight <= 0 || nextHeight === sheetHeightRef.current) return;

    sheetHeightRef.current = nextHeight;
    setSheetHeight(nextHeight);
    const nextOffset = isSheetCollapsed ? Math.max(nextHeight - SHEET_HANDLE_HEIGHT, 0) : 0;
    sheetOffsetRef.current = nextOffset;
    sheetTranslateY.setValue(nextOffset);
  }

  const activeRouteCoordinates = useMemo(
    () => (routeMode === 'safe' ? safeRouteCoordinates : normalRouteCoordinates),
    [normalRouteCoordinates, routeMode, safeRouteCoordinates],
  );
  const isFloodAlertActive = floodAlertActive || routeMode === 'safe';
  const isSafeRouteActive = routeMode === 'safe';

  function updateCurrentLocation(location: Coordinate | null) {
    navigationSessionStore.currentLocation = location;
    currentLocationRef.current = location;
    setCurrentLocation(location);
  }

  function updateGuidanceLocation(location: Coordinate | null) {
    navigationSessionStore.guidanceLocation = location;
    guidanceLocationRef.current = location;
  }

  function getLatestDisplayedLocation() {
    return currentLocationRef.current ?? currentLocation;
  }

  function hasInAppGuidancePosition() {
    const location = getLatestDisplayedLocation();
    return Boolean(location) && (
      Boolean(guidanceLocationRef.current) ||
      (activeRouteCoordinates.length > 1 && (
        isSimulating ||
        isGuidancePaused ||
        simulationIndex >= activeRouteCoordinates.length - 1
      ))
    );
  }

  useEffect(() => {
    if (appMode === 'demo') {
      setFloodMapIsLive(false);
      const demoZones =
        demoScenario === 'triggered' && isFloodAlertActive
          ? destinationCoordinate
            ? getDemoFloodZonesForRoute(demoOriginCoordinate, destinationCoordinate)
            : getDemoFloodZonesNearLocation(demoOriginCoordinate)
          : [];
      setFloodZoneCoordinates(demoZones.map((zone) => zone.coordinates));
      return;
    }

    if (isTestFixtureAlert) {
      setFloodMapIsLive(false);
      // 테스트 fixture 푸시는 WMS가 아니라 로컬 Polygon을 복원합니다.
      // routeMode가 safe가 된 뒤에만 실제 지도에 표시됩니다.
      setFloodZoneCoordinates(isFloodAlertActive ? [demoFloodZone] : []);
      return;
    }

    if (appMode !== 'live' || requestedFloodMapMode !== 'live') {
      setFloodMapIsLive(false);
      setFloodZoneCoordinates([]);
      return;
    }

    let cancelled = false;
    requestFloodZones()
      .then((response) => {
        const coordinates = extractFloodZoneCoordinates(response);
        if (cancelled) return;
        setFloodMapIsLive(response.live);
        setFloodZoneCoordinates(
          response.live && isFloodAlertActive && coordinates.length >= 3 ? [coordinates] : [],
        );
      })
      .catch(() => {
        if (!cancelled) {
          setFloodMapIsLive(false);
          setFloodZoneCoordinates([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    appMode,
    destinationCoordinate,
    demoOriginCoordinate,
    demoScenario,
    isFloodAlertActive,
    isTestFixtureAlert,
    requestedFloodMapMode,
    routeMode,
  ]);

  function resetModePresentation(message: string) {
    setIsSimulating(false);
    setIsGuidancePaused(false);
    setRouteMode('normal');
    setFloodAlertActive(false);
    setNormalRouteCoordinates([]);
    setSafeRouteCoordinates([]);
    setFloodZoneCoordinates([]);
    setFloodMapIsLive(false);
    setForegroundAlertDataMode(null);
    setDemoNotificationStatus(null);
    setSimulationIndex(0);
    updateGuidanceLocation(null);
    updateCurrentLocation(null);
    setDestinationCoordinate(null);
    setTriggerMessage(null);
    setWeatherForecast(null);
    setRouteMessage(message);
  }

  function handleSelectAppMode(nextMode: AppMode) {
    if (nextMode === appMode) return;

    placeSearchRequestIdRef.current += 1;
    routeRequestIdRef.current += 1;
    setAppMode(nextMode);
    setDemoScenario('normal');
    updateGuidanceLocation(null);
    updateCurrentLocation(null);
    setDemoOriginCoordinate(SEOUL_CITY_HALL);
    setDemoNotificationStatus(null);
    setOriginText(formatCoordinate(SEOUL_CITY_HALL));
    setDestinationText('');
    setDestinationQuery('');
    setDestinationSuggestions([]);
    setPlaceSearchingEndpoint(null);
    setPlaceSearchMessage(null);
    resetModePresentation(
      nextMode === 'demo'
        ? '무키 Demo 위험 발생 시연을 준비했습니다.'
        : 'LIVE 실제 API를 준비했습니다. 출발지는 현재 GPS를 사용합니다.',
    );
  }

  function handleSelectDemoScenario(nextScenario: DemoScenario) {
    routeRequestIdRef.current += 1;
    setRouteRenderKey((key) => key + 1);
    setDemoScenario(nextScenario);
    setIsSimulating(false);
    setIsGuidancePaused(false);
    setRouteMode('normal');
    setFloodAlertActive(nextScenario === 'triggered');
    setFloodZoneCoordinates(
      nextScenario === 'triggered'
        ? (destinationCoordinate
            ? getDemoFloodZonesForRoute(demoOriginCoordinate, destinationCoordinate)
            : getDemoFloodZonesNearLocation(demoOriginCoordinate)
          ).map((zone) => zone.coordinates)
        : [],
    );
    setForegroundAlertDataMode(null);
    setDemoNotificationStatus(null);
    setTriggerMessage(null);
    setRouteMessage(
      nextScenario === 'triggered'
        ? '침수 발생 시연을 선택했습니다. 실행하면 위험구역과 우회경로가 표시됩니다.'
        : '정상 상태 시연을 선택했습니다. 실행하면 침수 위험구역이 표시되지 않습니다.',
    );
  }

  function handleSelectDemoOrigin(place: DemoPlace) {
    if (appMode !== 'demo') return;

    routeRequestIdRef.current += 1;
    setDemoOriginCoordinate(place.location);
    setOriginText(formatCoordinate(place.location));
    updateGuidanceLocation(null);
    updateCurrentLocation(null);
    setNormalRouteCoordinates([]);
    setSafeRouteCoordinates([]);
    setFloodZoneCoordinates(
      demoScenario === 'triggered'
        ? (destinationCoordinate
            ? getDemoFloodZonesForRoute(place.location, destinationCoordinate)
            : getDemoFloodZonesNearLocation(place.location)
          ).map((zone) => zone.coordinates)
        : [],
    );
    setFloodMapIsLive(false);
    setRouteMode('normal');
    setFloodAlertActive(demoScenario === 'triggered');
    setSimulationIndex(0);
    setIsSimulating(false);
    setIsGuidancePaused(false);
    setTriggerMessage(null);
    setDemoNotificationStatus(null);
    setRouteMessage(`시연 출발지를 ${place.name}(으)로 설정했습니다. 목적지를 선택하세요.`);
  }

  function setPlaceSuggestions(endpoint: RouteEndpoint, suggestions: PlaceSuggestion[]) {
    if (endpoint === 'destination') setDestinationSuggestions(suggestions);
  }

  function handlePlaceQueryChange(endpoint: RouteEndpoint, value: string) {
    const requestId = ++placeSearchRequestIdRef.current;
    if (endpoint === 'destination') routeRequestIdRef.current += 1;
    const coordinate = parseCoordinate(value);

    if (endpoint === 'destination') {
      setDestinationQuery(value);
      setDestinationText(coordinate ? value : '');
      setDestinationCoordinate(coordinate);
    }
    setPlaceSuggestions(endpoint, []);
    setPlaceSearchMessage(null);

    const normalizedInput = value.trim();
    if (coordinate || normalizedInput.length < 2) {
      setPlaceSearchingEndpoint(null);
      return;
    }

    if (appMode === 'demo') {
      setPlaceSuggestions(endpoint, searchDemoPlaces(normalizedInput));
      setPlaceSearchingEndpoint(null);
      return;
    }

    setPlaceSearchingEndpoint(endpoint);
    setTimeout(() => {
      if (requestId !== placeSearchRequestIdRef.current) return;

      void requestPlaceAutocomplete(normalizedInput)
        .then((response) => {
          if (requestId !== placeSearchRequestIdRef.current) return;
          setPlaceSuggestions(endpoint, response.suggestions);
          if (response.suggestions.length === 0) {
            setPlaceSearchMessage('검색 결과가 없습니다. 건물명이나 지하철역을 더 구체적으로 입력하세요.');
          }
        })
        .catch((error) => {
          if (requestId !== placeSearchRequestIdRef.current) return;
          setPlaceSuggestions(endpoint, []);
          setPlaceSearchMessage(
            error instanceof Error
              ? error.message
              : 'LIVE 장소 검색에 실패했습니다. 백엔드와 장소 키 설정을 확인하세요.',
          );
        })
        .finally(() => {
          if (requestId === placeSearchRequestIdRef.current) {
            setPlaceSearchingEndpoint(null);
          }
        });
    }, 280);
  }

  async function handleSelectPlace(endpoint: RouteEndpoint, suggestion: PlaceSuggestion) {
    placeSearchRequestIdRef.current += 1;
    routeRequestIdRef.current += 1;
    setPlaceSearchingEndpoint(endpoint);
    setPlaceSearchMessage(null);

    try {
      let details: PlaceDetailsResponse;
      if (appMode === 'demo') {
        const place = findDemoPlace(suggestion.placeId);
        if (!place) throw new Error('Demo 장소 좌표를 찾지 못했습니다.');
        details = {
          source: 'LOCAL_DEMO',
          live: false,
          placeId: place.placeId,
          name: place.name,
          address: place.address,
          location: place.location,
        };
      } else {
        details = await requestPlaceDetails(suggestion.placeId);
      }

      const coordinateText = formatCoordinate(details.location);
      if (endpoint === 'destination') {
        setDestinationQuery(details.name);
        setDestinationText(coordinateText);
        setDestinationCoordinate(details.location);
        await handleDestinationSelection(details.location);
      }
      setPlaceSuggestions(endpoint, []);
      setPlaceSearchMessage(`${details.name} 위치를 선택했습니다.`);
    } catch (error) {
      setPlaceSearchMessage(
        error instanceof Error ? error.message : '장소 좌표를 확인하지 못했습니다.',
      );
    } finally {
      setPlaceSearchingEndpoint(null);
    }
  }

  async function handleDestinationSelection(nextDestination: Coordinate) {
    // A new destination starts a new route context. Clear the previous lines
    // immediately so an old route cannot remain visible while the new request
    // is waiting for the current location or routing responses.
    setNormalRouteCoordinates([]);
    setSafeRouteCoordinates([]);
    setRouteRenderKey((key) => key + 1);
    setSimulationIndex(0);
    setIsSimulating(false);
    setIsGuidancePaused(false);

    const routeContextId = routeRequestIdRef.current;
    const guidanceLocation = getLatestDisplayedLocation();
    const hasGuidancePosition = hasInAppGuidancePosition();
    const origin =
      appMode === 'demo'
        ? demoOriginCoordinate
        : appMode === 'live' && !hasGuidancePosition
          ? await handleUseCurrentLocation()
          : guidanceLocation;
    if (appMode === 'live' && !origin) return;
    if (routeContextId !== routeRequestIdRef.current) return;

    const routeReady = await handleRequestRoute(
      origin ?? undefined,
      false,
      nextDestination,
      hasGuidancePosition,
    );
    if (routeReady) {
      await handleRequestWeather(origin ?? parseCoordinate(originText) ?? SEOUL);
    }
  }

  function animateNavigationCamera(coordinate: Coordinate, heading: number) {
    mapRef.current?.animateCamera(
      {
        center: coordinate,
        heading,
        pitch: CAMERA_PITCH,
        zoom: CAMERA_ZOOM,
      },
      { duration: 650 },
    );
  }

  useEffect(() => {
    if (!isSimulating || activeRouteCoordinates.length < 2) return;

    // Long demo routes may contain hundreds of points after densification.
    // Only the keyless Demo advances by a larger index stride and shorter
    // interval. LIVE keeps the original one-point-per-900ms behavior.
    const simulationStep = Math.max(
      appMode === 'demo'
        ? Math.ceil((activeRouteCoordinates.length - 1) / DEMO_SIMULATION_TARGET_STEPS)
        : 1,
    );
    const simulationInterval = appMode === 'demo' ? DEMO_SIMULATION_INTERVAL_MS : 900;
    const simulationTimer = setInterval(() => {
      setSimulationIndex((index) => {
        const lastIndex = activeRouteCoordinates.length - 1;
        if (index >= lastIndex) {
          setIsSimulating(false);
          setIsGuidancePaused(false);
          setRouteMessage(
            isSafeRouteActive
              ? '안전 경로 시뮬레이션을 완료했습니다.'
              : '정상 경로 시뮬레이션을 완료했습니다.',
          );
          return index;
        }
        return Math.min(index + simulationStep, lastIndex);
      });
    }, simulationInterval);

    return () => clearInterval(simulationTimer);
  }, [activeRouteCoordinates.length, appMode, isSafeRouteActive, isSimulating, routeRenderKey]);

  useEffect(() => {
    if (!isSimulating || activeRouteCoordinates.length < 2) return;

    const routeModeChanged = previousRouteModeRef.current !== routeMode;
    previousRouteModeRef.current = routeMode;

    // Flood Alert swaps only the line. Keep the current marker and camera in place
    // until the next simulation tick moves it along the new route.
    if (routeModeChanged) return;

    const lastIndex = activeRouteCoordinates.length - 1;
    const currentIndex = Math.min(simulationIndex, lastIndex);
    const nextIndex = Math.min(currentIndex + 1, lastIndex);
    const nextLocation = activeRouteCoordinates[currentIndex];
    const nextPoint = activeRouteCoordinates[nextIndex] ?? nextLocation;
    const nextHeading =
      currentIndex < nextIndex
        ? calculateBearing(nextLocation, nextPoint)
        : currentIndex > 0
          ? calculateBearing(activeRouteCoordinates[currentIndex - 1], nextLocation)
          : 0;

    updateCurrentLocation(nextLocation);
    updateGuidanceLocation(nextLocation);
    setOriginText(formatCoordinate(nextLocation));
    setMovementHeading(nextHeading);
    animateNavigationCamera(nextLocation, nextHeading);
  }, [activeRouteCoordinates, isSimulating, routeMode, routeRenderKey, simulationIndex]);

  async function readCurrentLocation(): Promise<{
    coordinate: Coordinate;
    heading: number;
    usedLastKnown: boolean;
  }> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('LOCATION_PERMISSION_DENIED');
    }

    let servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled && Platform.OS === 'android') {
      try {
        await Location.enableNetworkProviderAsync();
        servicesEnabled = await Location.hasServicesEnabledAsync();
      } catch {
        // Continue to the explicit status message below if the system dialog is denied.
      }
    }
    if (!servicesEnabled) {
      throw new Error('LOCATION_SERVICES_DISABLED');
    }

    let position: Location.LocationObject;
    let usedLastKnown = false;
    try {
      position = await withTimeout(
        Location.getCurrentPositionAsync({
          // Android Emulator의 Extended Controls에서 주입한 위치는 GPS provider로
          // 전달됩니다. Balanced는 network provider만 기다리며 첫 fix가 지연될 수
          // 있으므로, LIVE 경로 시작은 실제 GPS를 요청해야 합니다.
          accuracy: Location.Accuracy.High,
          mayShowUserSettingsDialog: true,
          timeInterval: 1000,
          distanceInterval: 0,
        }),
        20000,
        'LOCATION_FIX_TIMEOUT',
      );
    } catch (currentError) {
      const lastKnown = await Location.getLastKnownPositionAsync({
        // A manually injected emulator location may be held by Android as the
        // last known fix even when a fresh request times out.
        maxAge: 24 * 60 * 60 * 1000,
        requiredAccuracy: 100_000,
      });
      if (!lastKnown) throw currentError;
      position = lastKnown;
      usedLastKnown = true;
      console.warn('[AnsimGil] current location fix failed; using last known location', currentError);
    }

    const coordinate = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
    const heading =
      typeof position.coords.heading === 'number' && position.coords.heading >= 0
        ? position.coords.heading
        : movementHeading;

    return { coordinate, heading, usedLastKnown };
  }

  async function handleUseCurrentLocation(): Promise<Coordinate | null> {
    setIsLocating(true);
    try {
      const { coordinate: nextLocation, heading: nextHeading, usedLastKnown } =
        await readCurrentLocation();

      setIsSimulating(false);
      setIsGuidancePaused(false);
      updateGuidanceLocation(null);
      updateCurrentLocation(nextLocation);
      setMovementHeading(nextHeading);
      setOriginText(formatCoordinate(nextLocation));
      animateNavigationCamera(nextLocation, nextHeading);
      setRouteMessage(
        usedLastKnown
          ? '현재 GPS 응답이 늦어 최근 위치를 출발지로 설정했습니다. 경로를 요청하세요.'
          : '현재 위치를 출발지로 설정했습니다. 경로를 다시 요청하세요.',
      );
      return nextLocation;
    } catch (error) {
      console.warn('[AnsimGil] unable to read current location', error);
      const reason = error instanceof Error ? error.message : '';
      setRouteMessage(
        reason === 'LOCATION_PERMISSION_DENIED'
          ? '현재 위치 권한이 필요합니다.'
          : reason === 'LOCATION_SERVICES_DISABLED'
            ? '에뮬레이터의 위치 서비스가 꺼져 있습니다. Android 설정에서 위치를 켜세요.'
            : '현재 위치를 가져오지 못했습니다. Android Emulator 위치 화면에서 SET LOCATION을 누른 뒤 다시 시도하세요.',
      );
      return null;
    } finally {
      setIsLocating(false);
    }
  }

  async function handleRequestRoute(
    originOverride?: Coordinate,
    startSimulation = false,
    destinationOverride?: Coordinate,
    preserveGuidanceLocation = false,
    forceFloodAlert = false,
  ): Promise<boolean> {
    Keyboard.dismiss();
    const shouldKeepFloodAlert =
      forceFloodAlert ||
      isFloodAlertActive ||
      (appMode === 'demo' && demoScenario === 'triggered');
    const origin =
      originOverride ??
      (appMode === 'demo'
        ? demoOriginCoordinate
        : currentLocationRef.current ?? currentLocation ?? parseCoordinate(originText));
    const destination = destinationOverride ?? destinationCoordinate ?? parseCoordinate(destinationText);

    if (!origin || !destination) {
      setRouteMessage('장소 검색 결과를 선택하거나 좌표를 입력하세요. 예: 37.5665, 126.9780');
      return false;
    }

    const demoFloodZonesForRoute =
      appMode === 'demo' ? getDemoFloodZonesForRoute(origin, destination) : [];

    const requestId = ++routeRequestIdRef.current;
    setRouteRenderKey((key) => key + 1);
    setIsRouting(true);
    setIsSimulating(false);
    setIsGuidancePaused(false);
    setRouteMode('normal');
    setNormalRouteCoordinates([]);
    setSafeRouteCoordinates([]);
    setSimulationIndex(0);
    if (appMode === 'demo') {
      setFloodZoneCoordinates(
        shouldKeepFloodAlert
          ? demoFloodZonesForRoute.map((zone) => zone.coordinates)
          : [],
      );
    } else if (!shouldKeepFloodAlert) {
      setFloodZoneCoordinates([]);
    }
    setTriggerMessage(null);
    setRouteMessage('정상 경로와 안전 경로를 계산 중입니다…');

    const [normalResult, safeResult] = await Promise.allSettled([
      requestNormalRoute({ origin, destination }),
      requestSafeRoute({ origin, destination }),
    ]);
    if (requestId !== routeRequestIdRef.current) return false;

    const normalCoordinates =
      normalResult.status === 'fulfilled'
        ? extractRouteCoordinates(normalResult.value)
        : [];
    const safeCoordinates =
      safeResult.status === 'fulfilled' ? extractRouteCoordinates(safeResult.value) : [];
    const normalRouteIsUsable = routeReachesDestination(normalCoordinates, destination);
    const safeRouteIsUsable = routeReachesDestination(safeCoordinates, destination);
    const allowDemoFallback = appMode === 'demo';

    // A straight-line fallback is acceptable only for the keyless demo map.
    // In LIVE mode it can cross buildings, rivers, or restricted roads, so do
    // not present it as a real navigation route when ORS failed or returned an
    // incomplete geometry.
    if (!allowDemoFallback && !normalRouteIsUsable) {
      setNormalRouteCoordinates([]);
      setSafeRouteCoordinates([]);
      setIsRouting(false);
      setRouteMessage(
        normalResult.status === 'rejected'
          ? '실제 도로 경로를 받지 못했습니다. 백엔드와 ORS API 연결을 확인하세요.'
          : '실제 도로 경로가 목적지에 도달하지 않아 표시하지 않았습니다.',
      );
      return false;
    }

    const nextNormalRoute = allowDemoFallback
      ? createFallbackRoute(origin, destination)
      : normalRouteIsUsable
        ? normalCoordinates
        : [];
    const nextSafeRoute = allowDemoFallback
      ? createSafeFallbackRoute(
          origin,
          destination,
          demoFloodZonesForRoute.map((zone) => zone.coordinates),
        )
      : safeRouteIsUsable
        ? safeCoordinates
        : [];
    const usedDemoFallback = allowDemoFallback;

    setNormalRouteCoordinates(nextNormalRoute);
    setSafeRouteCoordinates(nextSafeRoute);
    setSimulationIndex(0);
    const routeStartLocation = nextNormalRoute[0] ?? origin;
    updateCurrentLocation(routeStartLocation);
    updateGuidanceLocation(
      startSimulation || preserveGuidanceLocation ? routeStartLocation : null,
    );
    setDestinationCoordinate(destination);
    const nextRouteMode: RouteMode =
      shouldKeepFloodAlert && nextSafeRoute.length > 1 ? 'safe' : 'normal';
    setFloodAlertActive(shouldKeepFloodAlert);
    setRouteMode(nextRouteMode);
    const initialHeading =
      (nextRouteMode === 'safe' ? nextSafeRoute : nextNormalRoute).length > 1
        ? calculateBearing(
            (nextRouteMode === 'safe' ? nextSafeRoute : nextNormalRoute)[0],
            (nextRouteMode === 'safe' ? nextSafeRoute : nextNormalRoute)[1],
          )
        : calculateBearing(origin, destination);
    const initialRoute = nextRouteMode === 'safe' ? nextSafeRoute : nextNormalRoute;
    setMovementHeading(initialHeading);
    animateNavigationCamera(initialRoute[0] ?? origin, initialHeading);

    if (startSimulation) {
      setIsSimulating(true);
      setIsGuidancePaused(false);
      setRouteMessage(
        nextRouteMode === 'safe'
          ? '안전 경로 안내를 시작했습니다. 침수 위험을 피해 이동합니다.'
          : '경로 안내를 시작했습니다. 현재 경로를 따라 이동합니다.',
      );
    } else if (normalRouteIsUsable && safeRouteIsUsable) {
      setRouteMessage(
        nextRouteMode === 'safe'
          ? `침수 회피 안전경로를 표시했습니다. 예상 소요 ${formatEta(calculateRouteDistance(nextSafeRoute))}입니다.`
          : `정상 경로를 표시했습니다. 예상 소요 ${formatEta(calculateRouteDistance(nextNormalRoute))}입니다.`,
      );
    } else if (!allowDemoFallback && !safeRouteIsUsable) {
      setRouteMessage(
        `정상 도로 경로를 표시했습니다. 안전 경로는 실제 ORS 응답을 받지 못했습니다. 예상 소요 ${formatEta(calculateRouteDistance(nextNormalRoute))}입니다.`,
      );
    } else if (usedDemoFallback) {
      setRouteMessage(
        `서버 경로 일부를 사용할 수 없어 시연용 경로를 표시했습니다. 예상 소요 ${formatEta(calculateRouteDistance(nextNormalRoute))}입니다.`,
      );
    } else {
      setRouteMessage('경로를 표시했습니다.');
    }
    setIsRouting(false);
    return true;
  }

  async function handleStartRouteGuidance() {
    if (isGuidancePaused && activeRouteCoordinates.length > 1) {
      setIsGuidancePaused(false);
      setIsSimulating(true);
      setRouteMessage('경로 안내를 재개했습니다. 현재 위치부터 계속 안내합니다.');
      return;
    }

    if (routeMode === 'safe' && activeRouteCoordinates.length > 1) {
      const guidanceOrigin = getLatestDisplayedLocation();
      if (!guidanceOrigin) {
        setRouteMessage('현재 안내 위치를 확인하지 못했습니다. 경로를 다시 요청하세요.');
        return;
      }

      const currentIndex = findNearestRouteIndex(activeRouteCoordinates, guidanceOrigin);
      const nextIndex = Math.min(currentIndex + 1, activeRouteCoordinates.length - 1);
      const nextPoint = activeRouteCoordinates[nextIndex] ?? guidanceOrigin;
      const nextHeading =
        nextIndex > currentIndex
          ? calculateBearing(guidanceOrigin, nextPoint)
          : movementHeading;

      updateCurrentLocation(guidanceOrigin);
      updateGuidanceLocation(guidanceOrigin);
      setSimulationIndex(currentIndex);
      setMovementHeading(nextHeading);
      animateNavigationCamera(guidanceOrigin, nextHeading);
      setIsGuidancePaused(false);
      setIsSimulating(true);
      setRouteMessage('안전 경로 안내를 시작했습니다. 침수 위험을 피해 이동합니다.');
      return;
    }

    if (appMode === 'live') {
      const guidanceOrigin = getLatestDisplayedLocation();
      const canContinueFromGuidanceLocation = hasInAppGuidancePosition();
      const nextLocation = canContinueFromGuidanceLocation
        ? guidanceOrigin
        : await handleUseCurrentLocation();
      if (!nextLocation) return;

      const routeReady = await handleRequestRoute(nextLocation, true);
      if (routeReady) await handleRequestWeather(nextLocation);
      return;
    }

    if (appMode === 'demo' && demoScenario === 'triggered') {
      await handleRunTrigger('demo', true);
      return;
    }

    const routeReady = await handleRequestRoute(undefined, true);
    if (routeReady) await handleRequestWeather(parseCoordinate(originText) ?? SEOUL);
  }

  function handlePauseRouteGuidance() {
    if (!isSimulating) return;

    setIsSimulating(false);
    setIsGuidancePaused(true);
    setRouteMessage('경로 안내를 중단했습니다. 경로 안내 재개를 누르면 이어서 안내합니다.');
  }

  function handleResetToNormal() {
    routeRequestIdRef.current += 1;
    setRouteRenderKey((key) => key + 1);
    setIsSimulating(false);
    setIsGuidancePaused(false);
    if (appMode === 'demo') setDemoScenario('normal');
    setRouteMode('normal');
    setFloodAlertActive(false);
    setFloodZoneCoordinates([]);
    setForegroundAlertDataMode(null);
    setTriggerMessage('정상 상태로 초기화했습니다. 침수 위험구역은 표시되지 않습니다.');
    setRouteMessage('정상 상태입니다. LIVE Trigger는 터미널에서만 실행하세요.');
  }

  const liveTriggerLocation = currentLocation ?? parseCoordinate(originText) ?? SEOUL;
  const liveTriggerLocationPayload = `"location": { "latitude": ${liveTriggerLocation.latitude.toFixed(6)}, "longitude": ${liveTriggerLocation.longitude.toFixed(6)} },`;

  const liveTriggerCommand = `curl -sS -X POST http://localhost:8080/api/v1/demo/trigger \\
  -H 'Content-Type: application/json' \\
  -d '{
    ${liveTriggerLocationPayload}
    "dataMode": "live",
    "routeMode": "ors",
    "pushMode": "live",
    "sendPush": true,
    "pushToken": "여기에_Expo_Push_Token_입력"
  }'`;

  const liveLocationCommand = 'adb emu geo fix 126.9780 37.5665';

  const liveTestTriggerCommand = `curl -sS -X POST http://localhost:8080/api/v1/demo/trigger \\
  -H 'Content-Type: application/json' \\
  -d '{
    ${liveTriggerLocationPayload}
    "dataMode": "test",
    "routeMode": "ors",
    "pushMode": "live",
    "sendPush": true,
    "pushToken": "여기에_Expo_Push_Token_입력"
  }'`;

  async function handleCopyLiveTriggerCommand() {
    try {
      await Clipboard.setStringAsync(liveTriggerCommand);
      setLiveCommandCopyStatus('목적지와 무관한 LIVE Trigger 명령을 복사했습니다. Push Token만 입력한 뒤 실행하세요.');
    } catch {
      setLiveCommandCopyStatus('명령 복사에 실패했습니다. 다시 시도하세요.');
    }
  }

  async function handleCopyLiveTestTriggerCommand() {
    try {
      await Clipboard.setStringAsync(liveTestTriggerCommand);
      setLiveCommandCopyStatus('목적지와 무관한 위험 대상자 테스트 명령을 복사했습니다. Push Token만 입력한 뒤 실행하세요.');
    } catch {
      setLiveCommandCopyStatus('명령 복사에 실패했습니다. 다시 시도하세요.');
    }
  }

  async function handleCopyLiveLocationCommand() {
    try {
      await Clipboard.setStringAsync(liveLocationCommand);
      setLiveCommandCopyStatus('에뮬레이터 위치 명령을 복사했습니다. 터미널에서 실행한 뒤 경로 안내를 시작하세요.');
    } catch {
      setLiveCommandCopyStatus('위치 명령 복사에 실패했습니다. 다시 시도하세요.');
    }
  }

  async function handleRunTrigger(
    dataMode: 'demo' | 'live',
    startSimulation = false,
    destinationOverride?: Coordinate,
    originOverride?: Coordinate,
  ): Promise<boolean> {
    const origin =
      originOverride ??
      (appMode === 'demo'
        ? demoOriginCoordinate
        : currentLocationRef.current ?? currentLocation ?? parseCoordinate(originText));
    const destination = destinationOverride ?? destinationCoordinate ?? parseCoordinate(destinationText);

    if (!origin) {
      setTriggerMessage('현재 위치를 확인하지 못해 재난 Trigger를 실행할 수 없습니다.');
      return false;
    }

    const demoFloodZonesForRoute =
      dataMode === 'demo'
        ? destination
          ? getDemoFloodZonesForRoute(origin, destination)
          : getDemoFloodZonesNearLocation(origin)
        : [];

    setIsTriggering(true);
    const requestId = ++routeRequestIdRef.current;
    setRouteRenderKey((key) => key + 1);
    setTriggerMessage(`${dataMode === 'live' ? 'LIVE' : 'Demo'} 재난 Trigger를 실행하는 중입니다…`);

    try {
      const response = await requestTrigger({
        location: origin,
        ...(destination ? { destination } : {}),
        limit: 20,
        dataMode,
        routeMode: dataMode === 'live' ? 'ors' : 'demo',
        pushMode: 'demo',
        sendPush: false,
      });

      if (requestId !== routeRequestIdRef.current) return false;

      if (response.floodZone?.live) setFloodMapIsLive(true);

      if (response.triggerStatus !== 'TRIGGERED' || !response.decision.locationRelevant) {
        setFloodAlertActive(false);
        setRouteMode('normal');
        setFloodZoneCoordinates([]);
        setForegroundAlertDataMode(null);
        setTriggerMessage(
          dataMode === 'live'
            ? 'LIVE 재난문자는 확인했지만 현재 위치와 관련된 서울 재난이 없어 다음 단계가 실행되지 않았습니다.'
            : 'Demo Trigger가 위치 관련성 단계에서 중단되었습니다. 응답을 확인하세요.',
        );
        return false;
      }

      if (!destination) {
        setFloodAlertActive(true);
        setRouteMode('normal');
        setNormalRouteCoordinates([]);
        setSafeRouteCoordinates([]);
        setSimulationIndex(0);
        updateCurrentLocation(origin);
        updateGuidanceLocation(null);
        setWeatherForecast(response.weather);
        if (dataMode === 'demo') {
          setFloodZoneCoordinates(demoFloodZonesForRoute.map((zone) => zone.coordinates));
        } else if (response.floodZone?.live) {
          setFloodMapIsLive(true);
          setFloodZoneCoordinates([]);
        } else {
          setFloodZoneCoordinates([demoFloodZone]);
        }
        setRouteMessage('재난 Trigger를 확인했습니다. 목적지를 선택하면 침수 회피 경로를 계산합니다.');
        setTriggerMessage(
          `${dataMode === 'live' ? 'LIVE' : 'Demo'} Trigger 성공 · 목적지와 무관하게 재난·위치 판정만 완료했습니다.`,
        );
        return true;
      }

      const safeCoordinates = response.route.geoJson
        ? extractRouteCoordinates(response.route.geoJson)
        : [];
      const normalRouteIsUsable = routeReachesDestination(normalRouteCoordinates, destination);
      const safeRouteIsUsable = routeReachesDestination(safeCoordinates, destination);

      if (dataMode === 'live' && !safeRouteIsUsable) {
        setRouteMode('normal');
        setNormalRouteCoordinates(normalRouteIsUsable ? normalRouteCoordinates : []);
        setSafeRouteCoordinates([]);
        setFloodZoneCoordinates([]);
        setForegroundAlertDataMode(null);
        setRouteMessage(
          '실제 안전 경로를 받지 못해 경로를 표시하지 않았습니다. ORS 응답과 백엔드 연결을 확인하세요.',
        );
        setTriggerMessage('LIVE 재난은 확인했지만 실제 안전 경로가 없어 안내를 시작하지 않았습니다.');
        return false;
      }

      const normalRoute =
        dataMode === 'demo'
          ? createFallbackRoute(origin, destination)
          : routeReachesDestination(normalRouteCoordinates, destination)
            ? normalRouteCoordinates
            : [];
      const safeRoute =
        dataMode === 'demo'
          ? createSafeFallbackRoute(
              origin,
              destination,
              demoFloodZonesForRoute.map((zone) => zone.coordinates),
            )
          : safeRouteIsUsable
            ? safeCoordinates
            : [];
      const usedRouteFallback = dataMode === 'demo';

      setNormalRouteCoordinates(normalRoute);
      setSafeRouteCoordinates(safeRoute);
      if (dataMode === 'demo') {
        setFloodZoneCoordinates(demoFloodZonesForRoute.map((zone) => zone.coordinates));
      } else if (response.floodZone?.live) {
        const liveFloodZone = extractFloodZoneCoordinates(response.floodZone);
        setFloodZoneCoordinates(liveFloodZone.length >= 3 ? [liveFloodZone] : []);
      } else {
        setFloodZoneCoordinates([demoFloodZone]);
      }
      setWeatherForecast(response.weather);
      setFloodAlertActive(true);
      setRouteMode('safe');
      setSimulationIndex(0);
      updateCurrentLocation(origin);
      updateGuidanceLocation(startSimulation ? origin : null);
      setDestinationCoordinate(destination);
      const heading = calculateBearing(safeRoute[0], safeRoute[1]);
      setMovementHeading(heading);
      animateNavigationCamera(origin, heading);
      setIsSimulating(startSimulation);
      setIsGuidancePaused(false);
      setRouteMessage(
        startSimulation
          ? '안전 경로 안내를 시작했습니다. 침수 위험을 피해 이동합니다.'
          : '재난 Trigger를 확인했습니다. 침수 위험을 피해 안전 경로를 표시합니다.',
      );
      setTriggerMessage(
        `${dataMode === 'live' ? 'LIVE' : 'Demo'} Trigger 성공 · ${
          response.weather?.live ? '기상청 LIVE' : '기상예보 Demo'
        } · ${response.floodZone?.live ? 'FloodMap LIVE' : 'FloodZone Demo'} · ${
          response.route.source ?? '경로 없음'
        }${usedRouteFallback ? ' · 목적지 보정 경로' : ''}`,
      );
      return true;
    } catch (error) {
      setTriggerMessage(error instanceof Error ? error.message : '재난 Trigger 실행에 실패했습니다.');
      return false;
    } finally {
      setIsTriggering(false);
    }
  }

  async function handleRequestWeather(locationOverride?: Coordinate) {
    try {
      const location =
        locationOverride ??
        (appMode === 'demo'
          ? demoOriginCoordinate
          : currentLocationRef.current ?? currentLocation ?? await handleUseCurrentLocation());
      if (!location) {
        setWeatherForecast(null);
        return;
      }
      const response = await requestShortTermWeather(location);
      setWeatherForecast(response);
    } catch {
      setWeatherForecast(null);
    }
  }

  async function resolveNotificationOrigin(): Promise<Coordinate | null> {
    const guidanceOrigin = getLatestDisplayedLocation();
    if (guidanceOrigin && hasInAppGuidancePosition()) {
      // When the app was already guiding before the push arrived, the
      // emulator GPS may still contain the route's initial injected point.
      // Continue from the last in-app guidance position instead of rewinding
      // the user to that stale emulator fix.
      updateCurrentLocation(guidanceOrigin);
      setOriginText(formatCoordinate(guidanceOrigin));
      animateNavigationCamera(guidanceOrigin, movementHeading);
      return guidanceOrigin;
    }

    return handleUseCurrentLocation();
  }

  useEffect(() => {
    if (!floodAlertRequested || notificationRouteRequestedRef.current) return;

    notificationRouteRequestedRef.current = true;
    const isDemoNotification = notificationDataMode === 'demo';
    setAppMode(isDemoNotification ? 'demo' : 'live');
    void (async () => {
      const continueFromGuidanceLocation = hasInAppGuidancePosition();
      if (isDemoNotification && notificationOrigin) {
        setDemoOriginCoordinate(notificationOrigin);
        setOriginText(formatCoordinate(notificationOrigin));
      }
      if (notificationDestination) {
        setDestinationCoordinate(notificationDestination);
        setDestinationText(formatCoordinate(notificationDestination));
        setDestinationQuery(formatCoordinate(notificationDestination));
      }

      if (isDemoNotification) {
        setDemoScenario('triggered');
        setDemoNotificationStatus(null);
        const demoTriggerSucceeded = await handleRunTrigger(
          'demo',
          false,
          notificationDestination ?? undefined,
          notificationOrigin ?? undefined,
        );
        if (demoTriggerSucceeded) {
          setRouteMessage('Demo 알림을 확인했습니다. 침수 위험을 피해 안전경로를 표시합니다.');
        }
        return;
      }

      const liveOrigin = await resolveNotificationOrigin();
      if (!liveOrigin) return;
      const liveDestination =
        notificationDestination ?? destinationCoordinate ?? parseCoordinate(destinationText);
      setFloodAlertActive(true);
      setForegroundAlertDataMode(notificationDataMode);
      if (!liveDestination) {
        setRouteMode('normal');
        setNormalRouteCoordinates([]);
        setSafeRouteCoordinates([]);
        setSimulationIndex(0);
        setRouteMessage('침수 위험을 확인했습니다. 원하는 목적지를 입력하면 안전경로를 계산합니다.');
        await handleRequestWeather(liveOrigin);
        return;
      }
      await handleRequestRoute(
        liveOrigin,
        false,
        liveDestination,
        continueFromGuidanceLocation,
        true,
      );
      await handleRequestWeather(liveOrigin);
    })();
  }, [
    floodAlertRequested,
    notificationDataMode,
    notificationDestination,
    notificationOrigin,
  ]);

  useEffect(() => {
    if (
      !floodAlertRequested ||
      normalRouteCoordinates.length < 2 ||
      safeRouteCoordinates.length < 2 ||
      routeMode === 'safe'
    ) {
      return;
    }

    const latestLocation = currentLocationRef.current ?? currentLocation;
    if (latestLocation) {
      setSimulationIndex(findNearestRouteIndex(safeRouteCoordinates, latestLocation));
    }
    setRouteRenderKey((key) => key + 1);
    setRouteMode('safe');
    setRouteMessage('알림을 확인했습니다. 침수 위험을 피해 안전 경로로 전환했습니다.');
  }, [
    currentLocation,
    floodAlertRequested,
    normalRouteCoordinates.length,
    routeMode,
    safeRouteCoordinates,
    safeRouteCoordinates.length,
  ]);

  function handleToggleFloodAlert() {
    if (safeRouteCoordinates.length < 2 || normalRouteCoordinates.length < 2) {
      setRouteMessage('먼저 정상·안전 경로를 요청하세요.');
      return;
    }

    const nextMode: RouteMode = routeMode === 'normal' ? 'safe' : 'normal';
    const nextRoute = nextMode === 'safe' ? safeRouteCoordinates : normalRouteCoordinates;
    const latestLocation = currentLocationRef.current ?? currentLocation;
    if (latestLocation) {
      setSimulationIndex(findNearestRouteIndex(nextRoute, latestLocation));
    }
    setRouteRenderKey((key) => key + 1);
    setRouteMode(nextMode);
    setFloodAlertActive(nextMode === 'safe');
    setRouteMessage(
      nextMode === 'safe'
        ? 'FLOOD ALERT: 카메라는 유지하고 안전 경로로 교체했습니다.'
        : '정상 상황으로 복귀했습니다. 정상 경로를 표시합니다.',
    );
  }

  async function handleAcceptForegroundFloodAlert(
    dataMode: NotificationDataMode | null,
    destinationOverride?: Coordinate | null,
  ) {
    const destination = destinationOverride ?? destinationCoordinate ?? parseCoordinate(destinationText);
    if (!destination) {
      setRouteMessage('목적지를 먼저 선택한 뒤 안전경로를 계산하세요.');
      return;
    }

    const resumeSimulation = isSimulating;
    const continueFromGuidanceLocation = hasInAppGuidancePosition();
    const origin = await resolveNotificationOrigin();
    if (!origin) return;

    setIsRouting(true);
    setRouteRenderKey((key) => key + 1);
    setIsSimulating(false);
    setRouteMode('normal');
    setFloodAlertActive(true);
    setTriggerMessage(null);
    setRouteMessage('현재 위치에서 침수 회피 안전경로를 다시 계산하는 중입니다…');

    try {
      const [normalResult, safeResult] = await Promise.allSettled([
        requestNormalRoute({ origin, destination }),
        requestSafeRoute({ origin, destination }),
      ]);
      const normalCoordinates =
        normalResult.status === 'fulfilled' ? extractRouteCoordinates(normalResult.value) : [];
      const safeCoordinates =
        safeResult.status === 'fulfilled' ? extractRouteCoordinates(safeResult.value) : [];
      const normalRouteIsUsable = routeReachesDestination(normalCoordinates, destination);
      const safeRouteIsUsable = routeReachesDestination(safeCoordinates, destination);

      if (!safeRouteIsUsable) {
        setNormalRouteCoordinates(normalRouteIsUsable ? normalCoordinates : []);
        setSafeRouteCoordinates([]);
        setRouteMode('normal');
        setRouteMessage(
          '실제 안전 경로를 받지 못해 침수 우회 안내를 시작하지 않았습니다. ORS 응답과 백엔드 연결을 확인하세요.',
        );
        return;
      }

      const nextNormalRoute = normalRouteIsUsable
        ? normalCoordinates
        : routeReachesDestination(normalRouteCoordinates, destination)
          ? normalRouteCoordinates
          : [];
      const nextSafeRoute = safeCoordinates;

      setNormalRouteCoordinates(nextNormalRoute);
      setSafeRouteCoordinates(nextSafeRoute);
      setForegroundAlertDataMode(dataMode);
      setSimulationIndex(0);
      updateCurrentLocation(origin);
      updateGuidanceLocation(
        resumeSimulation || continueFromGuidanceLocation ? origin : null,
      );
      setDestinationCoordinate(destination);
      const heading = calculateBearing(nextSafeRoute[0], nextSafeRoute[1]);
      setMovementHeading(heading);
      animateNavigationCamera(origin, heading);
      setRouteMode('safe');
      setIsSimulating(resumeSimulation);
      setIsGuidancePaused(false);
      setDestinationText(formatCoordinate(destination));
      setDestinationQuery(formatCoordinate(destination));
      await handleRequestWeather(origin);
      setRouteMessage('침수 위험 알림을 확인했습니다. 현재 위치에서 안전경로로 전환했습니다.');
    } catch (error) {
      setRouteMessage(error instanceof Error ? error.message : '안전경로 재계산에 실패했습니다.');
    } finally {
      setIsRouting(false);
    }
  }

  function handleOpenWeatherDetails() {
    const location = currentLocationRef.current ?? currentLocation ?? parseCoordinate(originText) ?? SEOUL;
    router.push({
      pathname: '/weather',
      params: {
        appMode,
        latitude: String(location.latitude),
        longitude: String(location.longitude),
      },
    });
  }

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as
        | { url?: unknown; dataMode?: unknown }
        | undefined;
      const title = notification.request.content.title ?? '';
      const url = data?.url;
      const isFloodNotification =
        (typeof url === 'string' && url.includes('floodAlert=true')) ||
        title.includes('침수') ||
        title.includes('홍수');
      if (!isFloodNotification) return;

      const notificationId = notification.request.identifier || `foreground-${Date.now()}`;
      if (foregroundNotificationIdRef.current === notificationId) return;
      foregroundNotificationIdRef.current = notificationId;

      const notificationDataMode =
        data?.dataMode === 'demo' || data?.dataMode === 'live' || data?.dataMode === 'test'
          ? data.dataMode
          : null;
      const notificationOrigin = parseNotificationCoordinate(url, 'originLatitude', 'originLongitude');
      const notificationDestination = parseNotificationDestination(url);
      setForegroundAlertDataMode(notificationDataMode);
      setForegroundFloodAlert({
        dataMode: notificationDataMode,
        notificationId,
        origin: notificationOrigin,
        destination: notificationDestination,
      });
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!foregroundFloodAlert || isRouting || isTriggering) return;

    const alert = foregroundFloodAlert;
    const alertDestination = alert.destination ?? destinationCoordinate;
    if (alert.dataMode === 'demo') {
      setForegroundFloodAlert(null);
      if (!alertDestination) {
        setRouteMessage('Demo 알림의 목적지를 확인하지 못했습니다. 목적지를 다시 선택하세요.');
        return;
      }

      Alert.alert(
        'Demo 침수 위험 감지',
        '로컬 재난문자 Fixture가 감지되었습니다. 침수 회피 안전경로를 표시할까요?',
        [
          {
            text: '아니오',
            style: 'cancel',
            onPress: () => setRouteMessage('Demo 현재 경로를 유지합니다.'),
          },
          {
            text: '예',
            onPress: () => void handleRunTrigger(
              'demo',
              false,
              alertDestination,
              alert.origin ?? undefined,
            ),
          },
        ],
      );
      return;
    }

    setFloodAlertActive(true);
    if (!alertDestination) {
      setForegroundFloodAlert(null);
      Alert.alert(
        '침수 위험 감지',
        '현재 위치와 관련된 침수 위험이 감지되었습니다. 목적지를 선택하면 안전경로를 계산합니다.',
        [{ text: '확인' }],
      );
      return;
    }

    if (routeMode !== 'normal' || normalRouteCoordinates.length < 2) {
      setForegroundFloodAlert(null);
      return;
    }

    setForegroundFloodAlert(null);
    Alert.alert(
      '침수 위험 감지',
      '현재 경로를 침수로부터 안전한 경로로 변경할까요?',
      [
        {
          text: '아니오',
          style: 'cancel',
          onPress: () => setRouteMessage('현재 경로를 유지합니다.'),
        },
        {
          text: '예',
          onPress: () => void handleAcceptForegroundFloodAlert(alert.dataMode, alert.destination),
        },
      ],
    );
  }, [
    destinationCoordinate,
    foregroundFloodAlert,
    isRouting,
    isTriggering,
    normalRouteCoordinates.length,
    routeMode,
  ]);

  async function handlePreparePush() {
    setPushCopyStatus(null);
    setPushStatus({ state: 'error', message: '알림 권한과 푸시 토큰을 준비하는 중입니다…' });
    try {
      setPushStatus(await registerForPushNotificationsAsync());
    } catch {
      setPushStatus({ state: 'error', message: '알림 설정 중 오류가 발생했습니다.' });
    }
  }

  async function handleCopyPushToken() {
    if (pushStatus?.state !== 'granted') return;

    try {
      await Clipboard.setStringAsync(pushStatus.token);
      setPushCopyStatus('토큰을 클립보드에 복사했습니다. Expo 테스트 도구에 직접 입력하세요.');
    } catch {
      setPushCopyStatus('토큰 복사에 실패했습니다. 다시 시도하세요.');
    }
  }

  async function handleScheduleDemoNotification() {
    const destination = destinationCoordinate ?? parseCoordinate(destinationText);
    const notificationUrlParts = [
      '/?floodAlert=true',
      `originLatitude=${demoOriginCoordinate.latitude.toFixed(6)}`,
      `originLongitude=${demoOriginCoordinate.longitude.toFixed(6)}`,
      ...(destination
        ? [
            `destinationLatitude=${destination.latitude.toFixed(6)}`,
            `destinationLongitude=${destination.longitude.toFixed(6)}`,
          ]
        : []),
    ];

    setDemoNotificationStatus('Demo 로컬 알림을 예약하는 중입니다…');
    const result = await scheduleDemoFloodNotificationAsync(notificationUrlParts.join('&'));
    setDemoNotificationStatus(result.message);
  }

  async function setDestinationFromMap(nextDestination: Coordinate) {
    routeRequestIdRef.current += 1;
    setDestinationCoordinate(nextDestination);
    setDestinationText(formatCoordinate(nextDestination));
    setDestinationQuery(formatCoordinate(nextDestination));
    setDestinationSuggestions([]);
    setPlaceSearchMessage(null);
    await handleDestinationSelection(nextDestination);
  }

  function handleMapLongPress(event: { nativeEvent: { coordinate: Coordinate } }) {
    void setDestinationFromMap(event.nativeEvent.coordinate);
  }

  const useGoogleMap = appMode === 'live' && isGoogleMapEnabled;
  const routeColor = isSafeRouteActive ? '#0F766E' : '#2563EB';
  const mapModeMessage =
    appMode === 'demo'
      ? 'Demo 지도 · 키 불필요'
      : useGoogleMap
        ? 'Google Maps · LIVE'
        : isGoogleMapRequestedWithoutKey
          ? 'LIVE · Demo 지도(키 없음)'
          : 'LIVE · Demo 지도';
  const floodMapMessage = isTestFixtureAlert
    ? '침수 데이터 TEST fixture'
    : floodMapIsLive
    ? '침수 데이터 LIVE'
    : requestedFloodMapMode === 'live'
      ? '침수 데이터 DEMO fallback'
      : '침수 데이터 DEMO';
  const floodRiskText = weatherForecast ? floodRiskLabel(weatherForecast.riskLevel) : null;
  const floodMapWmsTileUrl = `${API_BASE_URL}/flood-zones/wms-tile?minX={minX}&maxX={maxX}&minY={minY}&maxY={maxY}&width={width}&height={height}`;
  const activeRouteIndex = Math.min(
    simulationIndex,
    Math.max(0, activeRouteCoordinates.length - 1),
  );
  const remainingDistance = calculateRouteDistance(activeRouteCoordinates.slice(activeRouteIndex));
  async function handleRecenter() {
    if (isLocating) return;

    const latestGuidanceLocation = getLatestDisplayedLocation();
    const hasGuidancePosition = hasInAppGuidancePosition();

    if (hasGuidancePosition && latestGuidanceLocation) {
      animateNavigationCamera(latestGuidanceLocation, movementHeading);
      updateCurrentLocation(latestGuidanceLocation);
      setRouteMessage('현재 안내 위치로 지도를 이동했습니다.');
      return;
    }

    setIsLocating(true);
    try {
      const { coordinate, heading } = await readCurrentLocation();
      animateNavigationCamera(coordinate, heading);
      updateGuidanceLocation(null);
      updateCurrentLocation(coordinate);
      setMovementHeading(heading);
      setOriginText(formatCoordinate(coordinate));
      setRouteMessage('에뮬레이터의 현재 위치로 지도를 이동했습니다.');
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      setRouteMessage(
        reason === 'LOCATION_PERMISSION_DENIED'
          ? '현재 위치 권한이 필요합니다.'
          : reason === 'LOCATION_SERVICES_DISABLED'
            ? '에뮬레이터의 위치 서비스가 꺼져 있습니다. Android 설정에서 위치를 켜세요.'
            : '현재 위치를 가져오지 못했습니다. Android Emulator 위치 화면에서 SET LOCATION을 누른 뒤 다시 시도하세요.',
      );
    } finally {
      setIsLocating(false);
    }
  }

  function renderPlaceSuggestions() {
    const isSearching = placeSearchingEndpoint === 'destination';
    const suggestions = destinationSuggestions;
    if (!isSearching && suggestions.length === 0) return null;

    return (
      <View style={styles.placeSuggestions}>
        {isSearching && suggestions.length === 0 ? (
          <View style={styles.placeSearchingRow}>
            <ActivityIndicator color="#0F766E" size="small" />
            <Text style={styles.placeSearchingText}>장소를 검색하는 중입니다…</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.placeSuggestionsList}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {suggestions.map((suggestion) => (
              <Pressable
                key={suggestion.placeId}
                style={styles.placeSuggestionButton}
                onPress={() => void handleSelectPlace('destination', suggestion)}
              >
                <Text style={styles.placeSuggestionMain}>{suggestion.primaryText}</Text>
                <Text style={styles.placeSuggestionSecondary} numberOfLines={1}>
                  {suggestion.secondaryText || suggestion.fullText}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    );
  }

  function renderRouteInputs() {
    return (
      <>
        <View style={styles.currentLocationRow}>
          <View style={styles.inputMarker}>
            <View style={styles.originDot} />
          </View>
          <View style={styles.currentLocationCopy}>
            <Text style={styles.currentLocationLabel}>출발지 · 현재 위치</Text>
            <Text style={styles.currentLocationValue}>
              {currentLocation
                ? formatCoordinate(currentLocation)
                : appMode === 'live'
                ? '경로 안내 시작 시 GPS를 자동으로 확인합니다.'
                  : `Demo 기준 위치 · ${formatCoordinate(demoOriginCoordinate)}`}
            </Text>
          </View>
        </View>
        <View style={styles.connector} />
        <View style={styles.inputRow}>
          <View style={styles.inputMarker}>
            <View style={styles.destinationPin} />
          </View>
          <TextInput
            value={destinationQuery}
            onChangeText={(value) => handlePlaceQueryChange('destination', value)}
            placeholder="목적지 검색 (예: 명동역)"
            placeholderTextColor="#94A3B8"
            style={styles.input}
            autoCapitalize="none"
            keyboardType="default"
          />
        </View>
        {renderPlaceSuggestions()}
        {placeSearchMessage ? <Text style={styles.placeSearchMessage}>{placeSearchMessage}</Text> : null}
      </>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>ANSIMGIL MVP</Text>
          <Text style={styles.title}>안심길</Text>
        </View>
        {floodRiskText ? (
          <View style={styles.headerWeatherSlot}>
            <Pressable
              style={[
                styles.floodRiskBadge,
                weatherForecast?.riskLevel === 'EXPECTED'
                  ? styles.floodRiskBadgeHigh
                  : weatherForecast?.riskLevel === 'POSSIBLE'
                    ? styles.floodRiskBadgePossible
                    : styles.floodRiskBadgeNone,
              ]}
              onPress={handleOpenWeatherDetails}
              accessibilityRole="button"
              accessibilityLabel="강수 기반 위험도 상세 보기"
            >
              <Text style={styles.floodRiskBadgeTitle}>강수 기반 위험도</Text>
              <Text style={styles.floodRiskBadgeValue}>{floodRiskText}</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={[styles.liveBadge, isFloodAlertActive && styles.alertBadge]}>
          <View style={[styles.liveDot, isFloodAlertActive && styles.alertDot]} />
          <Text style={[styles.liveText, isFloodAlertActive && styles.alertText]}>
            {isFloodAlertActive ? 'FLOOD ALERT' : 'NORMAL'}
          </Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.mapCard}>
        {useGoogleMap ? (
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            initialRegion={INITIAL_REGION}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            rotateEnabled
            pitchEnabled
            showsCompass={false}
            showsMyLocationButton={false}
            showsUserLocation={false}
            toolbarEnabled={false}
            onLongPress={handleMapLongPress}
          >
            {useGoogleMap && floodMapIsLive && isFloodAlertActive ? (
              <WMSTile
                urlTemplate={floodMapWmsTileUrl}
                opacity={0.62}
                tileSize={256}
                minimumZ={8}
                maximumZ={20}
                zIndex={1}
              />
            ) : null}
            {isFloodAlertActive
              ? floodZoneCoordinates.map((coordinates, index) =>
                  coordinates.length >= 3 ? (
                    <Fragment key={`flood-zone-${index}`}>
                      <Polygon
                        coordinates={coordinates}
                        fillColor="rgba(239, 68, 68, 0.20)"
                        strokeColor="#DC2626"
                        strokeWidth={2}
                      />
                      <Marker
                        coordinate={coordinates[0] ?? FLOOD_ZONE_LABEL}
                        title={floodMapIsLive ? '홍수위험지도 침수구역' : '시연용 침수 위험구역'}
                        pinColor="#DC2626"
                      />
                    </Fragment>
                  ) : null,
                )
              : null}
            {destinationCoordinate ? (
              <Marker coordinate={destinationCoordinate} title="목적지" pinColor="#7C3AED" />
            ) : null}
            {currentLocation ? (
              <Marker
                coordinate={currentLocation}
                title="현재 위치"
                anchor={{ x: 0.5, y: 0.5 }}
                flat
                rotation={movementHeading}
              >
                <View style={styles.navigationMarker}>
                  <View style={styles.navigationArrow} />
                  <View style={styles.navigationMarkerDot} />
                </View>
              </Marker>
            ) : null}
            {activeRouteCoordinates.length > 1 ? (
              <Polyline
                key={`route-${routeRenderKey}-${routeMode}`}
                coordinates={activeRouteCoordinates}
                strokeColor={routeColor}
                strokeWidth={5}
              />
            ) : null}
          </MapView>
        ) : (
          <DemoMap
            key={`demo-map-${routeRenderKey}-${routeMode}`}
            route={activeRouteCoordinates}
            floodZone={floodZoneCoordinates}
            currentLocation={currentLocation}
            destination={destinationCoordinate}
            heading={movementHeading}
            routeColor={routeColor}
            places={demoPlaces}
            onLongPress={setDestinationFromMap}
          />
        )}
        <View style={styles.mapModeBadge}>
          <Text style={styles.mapModeBadgeText}>{mapModeMessage}</Text>
          <Text style={styles.floodMapModeBadgeText}>{floodMapMessage}</Text>
        </View>
        {activeRouteCoordinates.length > 1 ? (
          <View style={[styles.navigationHud, appMode === 'demo' && styles.navigationHudDemo]}>
            <View style={[styles.hudDirection, appMode === 'demo' && styles.hudDirectionDemo, isFloodAlertActive && styles.hudDirectionAlert]}>
              <Text style={[styles.hudDirectionText, appMode === 'demo' && styles.hudDirectionTextDemo]}>↑</Text>
            </View>
            <View style={styles.hudCopy}>
              <Text style={[styles.hudEyebrow, appMode === 'demo' && styles.hudEyebrowDemo]}>{isSafeRouteActive ? '안전 경로 안내' : '경로 안내'}</Text>
              <Text style={[styles.hudTitle, appMode === 'demo' && styles.hudTitleDemo]}>{isSimulating ? '목적지로 이동 중' : '출발 준비'}</Text>
              <Text style={[styles.hudMeta, appMode === 'demo' && styles.hudMetaDemo]}>
                {formatDistance(remainingDistance)} · 예상 {formatEta(remainingDistance)}
              </Text>
            </View>
          </View>
        ) : null}
        {useGoogleMap ? (
          <Pressable style={styles.recenterButton} onPress={handleRecenter} accessibilityLabel="현재 위치로 지도 재정렬">
            <Text style={styles.recenterButtonText}>◎</Text>
          </Pressable>
        ) : null}
        <View style={styles.mapLegend}>
          <View style={styles.legendRow}>
            <View style={[styles.legendSwatch, styles.legendRoute, { backgroundColor: routeColor }]} />
            <Text style={styles.legendText}>{isSafeRouteActive ? '안전 경로' : '정상 경로'}</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendSwatch, styles.legendFlood]} />
            <Text style={styles.legendText}>침수 위험구역</Text>
          </View>
        </View>
        </View>

        <Animated.View
          style={[styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}
          onLayout={handleSheetLayout}
        >
          <View style={styles.sheetHandleArea} {...sheetPanResponder.panHandlers}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetHandleText}>
              {isSheetCollapsed ? '시연 메뉴 열기' : '시연 메뉴 · 아래로 내려 접기'}
            </Text>
          </View>
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.sheetIntro}>
              <View style={styles.sheetIntroCopy}>
                <Text style={styles.sectionTitle}>{appMode === 'demo' ? '무키 Demo 시연' : 'LIVE API 테스트'}</Text>
                <Text style={styles.sectionCaption}>
                  {appMode === 'demo'
                    ? 'API 키 없이 정상·침수 발생 전환과 우회경로를 확인합니다.'
                    : '실제 GPS를 출발지로 사용합니다. 재난 Trigger는 터미널에서 실행합니다.'}
                </Text>
              </View>
              <View style={styles.modePill}>
                <Text style={styles.modePillText}>{appMode === 'demo' ? 'KEYLESS' : 'LIVE'}</Text>
              </View>
            </View>

            <View style={styles.modeSwitch}>
              <Pressable
                style={[styles.modeOption, appMode === 'demo' && styles.modeOptionDemoActive]}
                onPress={() => handleSelectAppMode('demo')}
                accessibilityRole="tab"
                accessibilityState={{ selected: appMode === 'demo' }}
              >
                <Text style={[styles.modeOptionText, appMode === 'demo' && styles.modeOptionTextActive]}>DEMO · 무키</Text>
              </Pressable>
              <Pressable
                style={[styles.modeOption, appMode === 'live' && styles.modeOptionLiveActive]}
                onPress={() => handleSelectAppMode('live')}
                accessibilityRole="tab"
                accessibilityState={{ selected: appMode === 'live' }}
              >
                <Text style={[styles.modeOptionText, appMode === 'live' && styles.modeOptionTextActive]}>LIVE · 실제 API</Text>
              </Pressable>
            </View>

            {appMode === 'demo' ? (
              <View style={styles.primaryCard}>
                <View style={styles.primaryCardHeader}>
                  <View style={styles.primaryCardCopy}>
                    <Text style={styles.primaryCardTitle}>위험 발생 시연</Text>
                    <Text style={styles.primaryCardCaption}>출발지와 목적지를 바꾸어도 위험구역 회피 결과를 확인할 수 있습니다. 모든 장소는 로컬 Fixture로 재현됩니다.</Text>
                  </View>
                  <View style={styles.demoStatusPill}>
                    <View style={[styles.demoStatusDot, demoScenario === 'triggered' && styles.demoStatusDotAlert]} />
                    <Text style={[styles.demoStatusText, demoScenario === 'triggered' && styles.demoStatusTextAlert]}>
                      {demoScenario === 'triggered' ? 'FLOOD ALERT' : 'NORMAL'}
                    </Text>
                  </View>
                </View>
                <View style={styles.choiceRow}>
                  <Pressable
                    style={[styles.choiceButton, demoScenario === 'normal' && styles.choiceButtonNormalActive]}
                    onPress={() => handleSelectDemoScenario('normal')}
                  >
                    <Text style={[styles.choiceButtonText, demoScenario === 'normal' && styles.choiceButtonTextActive]}>정상 상태</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.choiceButton, demoScenario === 'triggered' && styles.choiceButtonAlertActive]}
                    onPress={() => handleSelectDemoScenario('triggered')}
                  >
                    <Text style={[styles.choiceButtonText, demoScenario === 'triggered' && styles.choiceButtonAlertTextActive]}>침수 위험 발생</Text>
                  </Pressable>
                </View>
                <Text style={styles.demoFieldLabel}>출발지 선택</Text>
                <ScrollView
                  horizontal
                  contentContainerStyle={styles.demoOriginList}
                  showsHorizontalScrollIndicator={false}
                >
                  {DEMO_ORIGIN_PLACES.map((place) => {
                    const isSelected =
                      demoOriginCoordinate.latitude === place.location.latitude &&
                      demoOriginCoordinate.longitude === place.location.longitude;
                    return (
                      <Pressable
                        key={place.placeId}
                        style={[styles.demoOriginChip, isSelected && styles.demoOriginChipActive]}
                        onPress={() => handleSelectDemoOrigin(place)}
                      >
                        <Text style={[styles.demoOriginChipText, isSelected && styles.demoOriginChipTextActive]}>
                          {place.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Pressable
                  style={[styles.demoNotificationButton, demoNotificationStatus?.includes('예약하는 중') && styles.disabledButton]}
                  onPress={() => void handleScheduleDemoNotification()}
                  disabled={demoNotificationStatus?.includes('예약하는 중')}
                >
                  <Text style={styles.demoNotificationButtonText}>Demo 백그라운드 알림 테스트</Text>
                </Pressable>
                <Text style={styles.demoNotificationNote}>
                  알림을 예약한 뒤 앱을 백그라운드로 보내고, Android 알림을 터치하면 출발지 인접 위험구역이 표시됩니다. 목적지를 선택하면 출발지·목적지 주변 위험구역을 반영한 안전경로가 표시됩니다.
                </Text>
                {demoNotificationStatus ? (
                  <Text style={styles.triggerMessage}>{demoNotificationStatus}</Text>
                ) : null}
              </View>
            ) : (
              <View style={styles.primaryCard}>
                <View style={styles.primaryCardHeader}>
                  <View style={styles.primaryCardCopy}>
                    <Text style={styles.primaryCardTitle}>LIVE 실제 API</Text>
                    <Text style={styles.primaryCardCaption}>현재 GPS를 자동으로 출발지로 사용합니다. 시뮬레이터에서 Location 지정해주세요.</Text>
                  </View>
                  <View style={styles.gpsPill}>
                    <View style={styles.gpsDot} />
                    <Text style={styles.gpsPillText}>{currentLocation ? 'GPS 연결됨' : 'GPS 대기'}</Text>
                  </View>
                </View>
                <Text style={styles.locationPreview}>
                  {currentLocation ? `출발지 · ${formatCoordinate(currentLocation)}` : '경로 안내 시작을 누르면 현재 위치를 읽습니다.'}
                </Text>
              </View>
            )}

            <View style={styles.detailCard}>
              <Text style={styles.detailCardTitle}>{appMode === 'demo' ? '목적지 선택' : '목적지 입력'}</Text>
              {renderRouteInputs()}
              <View style={styles.navigationActions}>
                <Pressable
                  style={[
                    styles.primaryButton,
                    (isRouting || isTriggering || (appMode === 'live' && isLocating) || isSimulating) &&
                      styles.disabledButton,
                  ]}
                  onPress={() => void handleStartRouteGuidance()}
                  disabled={isRouting || isTriggering || (appMode === 'live' && isLocating) || isSimulating}
                >
                  <Text style={styles.primaryButtonText}>
                    {isGuidancePaused ? '경로 안내 재개' : '경로 안내 시작'}
                  </Text>
                </Pressable>
                {isSimulating ? (
                  <Pressable style={styles.pauseButton} onPress={handlePauseRouteGuidance}>
                    <Text style={styles.pauseButtonText}>경로 안내 중단</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.routeMessage}>{routeMessage}</Text>
            </View>

            {appMode === 'live' ? (
              <View style={styles.primaryCard}>
                <View style={styles.primaryCardHeader}>
                  <View style={styles.primaryCardCopy}>
                    <Text style={styles.primaryCardTitle}>LIVE API 시연 가이드</Text>
                  </View>
                  <View style={styles.waitingPill}>
                    <View style={styles.waitingDot} />
                    <Text style={styles.waitingPillText}>{isFloodAlertActive ? '수신 완료' : '대기 중'}</Text>
                  </View>
                </View>
                <Text style={styles.commandLabel}>1. 행정안전부 재난문자</Text>
                <Text selectable style={styles.terminalCommand}>{liveTriggerCommand}</Text>
                <View style={styles.terminalActions}>
                  <Pressable style={styles.secondaryActionButton} onPress={handleCopyLiveTriggerCommand}>
                    <Text style={styles.secondaryActionButtonText}>LIVE 명령 복사</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryActionButton} onPress={handleResetToNormal}>
                    <Text style={styles.secondaryActionButtonText}>정상 상태로 초기화</Text>
                  </Pressable>
                </View>
                <Pressable style={[styles.secondaryActionButton, styles.fixtureCommandButton]} onPress={handleCopyLiveTestTriggerCommand}>
                  <Text style={styles.secondaryActionButtonText}>위험 대상자 테스트 fixture 명령 복사</Text>
                </Pressable>
                <Text style={styles.liveGuideNote}>
                  실시간 재난문자로 Trigger하려면 LIVE 명령 복사를, 서울시 중구 기준으로 실제 위험 상황을 테스트하려면 위험 대상자 테스트 명령 복사를 이용하세요.
                </Text>
                <Text style={styles.liveGuideAudienceNote}>
                  📱실시간 재난문자에서 위험 대상자가 아닌 경우, 앱 무반응이 정상입니다.
                </Text>
                <Text style={styles.commandLabel}>2. AnsimGil-backend를 터미널에서 열고, 명령어를 붙여넣으세요.</Text>
                <Text style={styles.commandLabel}>3. Expo Push Token</Text>
                  <Text style={styles.pushTokenStatus}>
                    {pushStatus?.state === 'granted'
                      ? '토큰 준비 완료 · 아래 버튼으로 로컬 클립보드에 복사할 수 있습니다.'
                      : '푸시 시연 전에 권한을 확인하고 토큰을 준비하세요.'}
                  </Text>
                  <View style={styles.pushTokenActions}>
                    <Pressable style={styles.pushPrepareButton} onPress={handlePreparePush}>
                      <Text style={styles.pushPrepareButtonText}>권한 확인</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.pushTokenButton, pushStatus?.state !== 'granted' && styles.disabledButton]}
                      onPress={handleCopyPushToken}
                      disabled={pushStatus?.state !== 'granted'}
                      accessibilityLabel="Expo Push Token 복사"
                    >
                      <Text style={styles.pushTokenButtonText}>Expo Push Token 복사</Text>
                    </Pressable>
                  </View>
                  {pushCopyStatus ? <Text style={styles.triggerMessage}>{pushCopyStatus}</Text> : null}
                {liveCommandCopyStatus ? <Text style={styles.triggerMessage}>{liveCommandCopyStatus}</Text> : null}
                {triggerMessage ? <Text style={styles.triggerMessage}>{triggerMessage}</Text> : null}
              </View>
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F2FBFA' },
  content: { flex: 1, position: 'relative' },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerWeatherSlot: { alignItems: 'center', bottom: 14, left: 0, position: 'absolute', right: 0, zIndex: 1 },
  eyebrow: { color: '#0F766E', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: '#0F172A', fontSize: 28, fontWeight: '800', marginTop: 2 },
  liveBadge: {
    alignItems: 'center',
    backgroundColor: '#DDF7F1',
    borderRadius: 20,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  alertBadge: { backgroundColor: '#FEE2E2' },
  liveDot: { backgroundColor: '#10B981', borderRadius: 5, height: 9, marginRight: 7, width: 9 },
  alertDot: { backgroundColor: '#DC2626' },
  liveText: { color: '#047857', fontSize: 12, fontWeight: '700' },
  alertText: { color: '#B91C1C' },
  mapCard: {
    backgroundColor: '#DCEEEB',
    borderRadius: 0,
    flex: 1,
    marginBottom: 0,
    marginHorizontal: 0,
    marginTop: 8,
    overflow: 'hidden',
  },
  mapLegend: {
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: 14,
    bottom: 104,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    position: 'absolute',
  },
  mapModeBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 6,
    position: 'absolute',
    right: 12,
    top: 12,
  },
  mapModeBadgeText: { color: '#0F766E', fontSize: 10, fontWeight: '800' },
  floodMapModeBadgeText: { color: '#B91C1C', fontSize: 10, fontWeight: '800', marginTop: 2 },
  floodRiskBadge: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    width: 112,
  },
  floodRiskBadgeHigh: { backgroundColor: '#FEE2E2', borderColor: '#FECACA' },
  floodRiskBadgePossible: { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
  floodRiskBadgeNone: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  floodRiskBadgeTitle: { color: '#64748B', fontSize: 9, fontWeight: '800' },
  floodRiskBadgeValue: { color: '#0F172A', fontSize: 13, fontWeight: '900', marginTop: 1 },
  navigationHud: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: 22,
    flexDirection: 'row',
    left: 12,
    maxWidth: '84%',
    paddingHorizontal: 18,
    paddingVertical: 16,
    position: 'absolute',
    top: 12,
  },
  navigationHudDemo: {
    borderRadius: 15,
    maxWidth: '72%',
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  hudDirection: { alignItems: 'center', backgroundColor: '#DDF7F1', borderRadius: 24, height: 62, justifyContent: 'center', marginRight: 16, width: 62 },
  hudDirectionDemo: { borderRadius: 12, height: 31, marginRight: 8, width: 31 },
  hudDirectionTextDemo: { fontSize: 21, lineHeight: 24 },
  hudDirectionAlert: { backgroundColor: '#FEE2E2' },
  hudDirectionText: { color: '#0F766E', fontSize: 42, fontWeight: '900', lineHeight: 48 },
  hudCopy: { minWidth: 0 },
  hudEyebrow: { color: '#64748B', fontSize: 18, fontWeight: '800', letterSpacing: 0.4 },
  hudEyebrowDemo: { fontSize: 9 },
  hudTitle: { color: '#0F172A', fontSize: 24, fontWeight: '800', marginTop: 2 },
  hudTitleDemo: { fontSize: 12, marginTop: 1 },
  hudMeta: { color: '#0F766E', fontSize: 20, fontWeight: '700', marginTop: 2 },
  hudMetaDemo: { fontSize: 10, marginTop: 1 },
  recenterButton: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 19, bottom: 82, elevation: 2, height: 38, justifyContent: 'center', position: 'absolute', right: 12, shadowColor: '#0F172A', shadowOpacity: 0.12, shadowRadius: 4, width: 38 },
  recenterButtonText: { color: '#0F766E', fontSize: 24, fontWeight: '700', lineHeight: 27 },
  legendRow: { alignItems: 'center', flexDirection: 'row' },
  legendSwatch: { borderRadius: 3, height: 10, marginRight: 6, width: 10 },
  legendRoute: { backgroundColor: '#2563EB' },
  legendFlood: { backgroundColor: '#DC2626' },
  legendText: { color: '#334155', fontSize: 11, fontWeight: '700' },
  mapHint: { color: '#64748B', fontSize: 10, marginTop: 3 },
  navigationMarker: { alignItems: 'center', height: 30, justifyContent: 'center', width: 30 },
  navigationArrow: {
    borderBottomColor: '#0F766E',
    borderBottomWidth: 13,
    borderLeftColor: 'transparent',
    borderLeftWidth: 7,
    borderRightColor: 'transparent',
    borderRightWidth: 7,
    height: 0,
    position: 'absolute',
    top: 1,
    width: 0,
  },
  navigationMarkerDot: { backgroundColor: '#FFFFFF', borderColor: '#0F766E', borderRadius: 8, borderWidth: 3, height: 16, width: 16 },
  sheet: {
    backgroundColor: '#F2FBFA',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    bottom: 0,
    elevation: 10,
    height: '58%',
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    zIndex: 10,
  },
  sheetHandleArea: { alignItems: 'center', height: SHEET_HANDLE_HEIGHT, justifyContent: 'center', paddingTop: 6 },
  sheetHandle: { backgroundColor: '#94A3B8', borderRadius: 3, height: 5, width: 42 },
  sheetHandleText: { color: '#64748B', fontSize: 10, fontWeight: '700', marginTop: 5 },
  sheetContent: { paddingBottom: 28, paddingHorizontal: 20 },
  sheetIntro: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  sheetIntroCopy: { flex: 1, paddingRight: 10 },
  modePill: { backgroundColor: '#E0F2FE', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 6 },
  modePillText: { color: '#0369A1', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  sectionTitle: { color: '#0F172A', fontSize: 19, fontWeight: '800' },
  sectionCaption: { color: '#64748B', fontSize: 12, marginTop: 4 },
  modeSwitch: { backgroundColor: '#E2E8F0', borderRadius: 13, flexDirection: 'row', padding: 3 },
  modeOption: { alignItems: 'center', borderRadius: 10, flex: 1, justifyContent: 'center', paddingVertical: 10 },
  modeOptionDemoActive: { backgroundColor: '#FFFFFF', shadowColor: '#0F172A', shadowOpacity: 0.08, shadowRadius: 3 },
  modeOptionLiveActive: { backgroundColor: '#FFFFFF', shadowColor: '#0F172A', shadowOpacity: 0.08, shadowRadius: 3 },
  modeOptionText: { color: '#64748B', fontSize: 12, fontWeight: '800' },
  modeOptionTextActive: { color: '#0F766E' },
  primaryCard: { backgroundColor: '#FFFFFF', borderColor: '#DCE7E5', borderRadius: 17, borderWidth: 1, marginTop: 12, padding: 13 },
  primaryCardHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  primaryCardCopy: { flex: 1, paddingRight: 8 },
  primaryCardTitle: { color: '#0F172A', fontSize: 15, fontWeight: '900' },
  primaryCardCaption: { color: '#64748B', fontSize: 11, lineHeight: 16, marginTop: 4 },
  demoStatusPill: { alignItems: 'center', backgroundColor: '#ECFDF5', borderRadius: 12, flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 6 },
  demoStatusDot: { backgroundColor: '#10B981', borderRadius: 4, height: 8, marginRight: 5, width: 8 },
  demoStatusDotAlert: { backgroundColor: '#DC2626' },
  demoStatusText: { color: '#047857', fontSize: 9, fontWeight: '900' },
  demoStatusTextAlert: { color: '#B91C1C' },
  choiceRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  choiceButton: { alignItems: 'center', backgroundColor: '#F8FAFC', borderColor: '#E2E8F0', borderRadius: 10, borderWidth: 1, flex: 1, paddingVertical: 9 },
  choiceButtonNormalActive: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  choiceButtonAlertActive: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  choiceButtonText: { color: '#64748B', fontSize: 11, fontWeight: '800' },
  choiceButtonTextActive: { color: '#047857' },
  choiceButtonAlertTextActive: { color: '#B91C1C' },
  demoFieldLabel: { color: '#334155', fontSize: 15, fontWeight: '900', marginTop: 13 },
  demoOriginList: { gap: 7, paddingTop: 8 },
  demoOriginChip: { backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  demoOriginChipActive: { backgroundColor: '#ECFDF5', borderColor: '#5EEAD4' },
  demoOriginChipText: { color: '#475569', fontSize: 10, fontWeight: '800' },
  demoOriginChipTextActive: { color: '#047857' },
  demoOriginNote: { color: '#64748B', fontSize: 10, lineHeight: 15, marginTop: 7 },
  demoNotificationButton: { alignItems: 'center', backgroundColor: '#0F766E', borderRadius: 10, justifyContent: 'center', marginTop: 11, minHeight: 40, paddingHorizontal: 11, paddingVertical: 8 },
  demoNotificationButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  demoNotificationNote: { color: '#64748B', fontSize: 10, lineHeight: 15, marginTop: 7 },
  secondaryActionButton: { alignItems: 'center', backgroundColor: '#F8FAFC', borderColor: '#99D7CC', borderRadius: 10, borderWidth: 1, justifyContent: 'center', marginTop: 10, minHeight: 38, paddingHorizontal: 11, paddingVertical: 8 },
  fixtureCommandButton: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' },
  secondaryActionButtonText: { color: '#0F766E', fontSize: 11, fontWeight: '900' },
  waitingPill: { alignItems: 'center', backgroundColor: '#F1F5F9', borderRadius: 12, flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 6 },
  waitingDot: { backgroundColor: '#94A3B8', borderRadius: 4, height: 8, marginRight: 5, width: 8 },
  waitingPillText: { color: '#64748B', fontSize: 9, fontWeight: '900' },
  gpsPill: { alignItems: 'center', backgroundColor: '#ECFDF5', borderRadius: 12, flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 6 },
  gpsDot: { backgroundColor: '#10B981', borderRadius: 4, height: 8, marginRight: 5, width: 8 },
  gpsPillText: { color: '#047857', fontSize: 9, fontWeight: '900' },
  locationPreview: { color: '#475569', fontSize: 11, lineHeight: 16, marginTop: 11 },
  stepList: { backgroundColor: '#F8FAFC', borderRadius: 11, marginTop: 11, paddingHorizontal: 10, paddingVertical: 9 },
  stepText: { color: '#475569', fontSize: 10, lineHeight: 17 },
  commandLabel: { color: '#334155', fontSize: 15, fontWeight: '900', marginTop: 12 },
  terminalCommand: { backgroundColor: '#0F172A', borderRadius: 10, color: '#E2E8F0', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 9, lineHeight: 14, marginTop: 10, padding: 10 },
  terminalActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  guideNote: { color: '#64748B', fontSize: 10, lineHeight: 15, marginTop: 8 },
  liveGuideNote: { color: '#000000', fontSize: 15, lineHeight: 22, marginTop: 10 },
  liveGuideAudienceNote: { color: '#475569', fontSize: 12, lineHeight: 18, marginTop: 4 },
  detailCard: { backgroundColor: '#FFFFFF', borderColor: '#DCE7E5', borderRadius: 16, borderWidth: 1, marginTop: 12, paddingHorizontal: 13, paddingVertical: 11 },
  detailCardTitle: { color: '#0F172A', fontSize: 20, fontWeight: '900' },
  detailCardCaption: { color: '#64748B', fontSize: 10, lineHeight: 15, marginTop: 3 },
  currentLocationRow: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#DCE7E5',
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 56,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  currentLocationCopy: { flex: 1, marginLeft: 8 },
  currentLocationLabel: { color: '#0F766E', fontSize: 11, fontWeight: '900' },
  currentLocationValue: { color: '#64748B', fontSize: 10, lineHeight: 15, marginTop: 2 },
  inputRow: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#DCE7E5',
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    height: 46,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  inputMarker: { alignItems: 'center', justifyContent: 'center', width: 22 },
  originDot: { backgroundColor: '#0F766E', borderColor: '#CCFBF1', borderRadius: 7, borderWidth: 4, height: 14, width: 14 },
  destinationPin: { backgroundColor: '#7C3AED', borderRadius: 7, height: 13, width: 13 },
  input: { color: '#0F172A', flex: 1, fontSize: 14, marginLeft: 8 },
  inputLocked: { color: '#64748B' },
  connector: { backgroundColor: '#CBD5E1', height: 7, marginLeft: 22, width: 1 },
  placeSuggestions: { backgroundColor: '#F8FAFC', borderColor: '#DCE7E5', borderRadius: 11, borderWidth: 1, marginTop: 4, overflow: 'hidden' },
  placeSuggestionsList: { maxHeight: 230 },
  placeSearchingRow: { alignItems: 'center', flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 11 },
  placeSearchingText: { color: '#64748B', fontSize: 11, marginLeft: 8 },
  placeSuggestionButton: { borderBottomColor: '#E2E8F0', borderBottomWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  placeSuggestionMain: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  placeSuggestionSecondary: { color: '#64748B', fontSize: 10, marginTop: 3 },
  placeSearchMessage: { color: '#64748B', fontSize: 10, lineHeight: 15, marginTop: 6 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  secondaryButton: {
    alignItems: 'center',
    borderColor: '#99D7CC',
    borderRadius: 12,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 96,
  },
  secondaryButtonText: { color: '#0F766E', fontSize: 13, fontWeight: '800' },
  primaryButton: { alignItems: 'center', backgroundColor: '#0F766E', borderRadius: 12, flex: 1, height: 44, justifyContent: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  pauseButton: { alignItems: 'center', backgroundColor: '#FFF1F2', borderColor: '#FECDD3', borderRadius: 12, borderWidth: 1, flex: 1, height: 44, justifyContent: 'center' },
  pauseButtonText: { color: '#BE123C', fontSize: 12, fontWeight: '900' },
  routeMessage: { color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 9 },
  navigationActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  navigationButton: { alignItems: 'center', backgroundColor: '#E0F2FE', borderRadius: 11, flex: 1, height: 38, justifyContent: 'center' },
  navigationButtonText: { color: '#0369A1', fontSize: 12, fontWeight: '800' },
  alertButton: { alignItems: 'center', backgroundColor: '#FFF1F2', borderColor: '#FECDD3', borderRadius: 11, borderWidth: 1, flex: 1, height: 38, justifyContent: 'center' },
  alertButtonActive: { backgroundColor: '#DCFCE7', borderColor: '#BBF7D0' },
  alertButtonText: { color: '#BE123C', fontSize: 12, fontWeight: '800' },
  alertButtonTextActive: { color: '#15803D' },
  disabledButton: { opacity: 0.45 },
  triggerCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DCE7E5',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  triggerTitle: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  triggerCaption: { color: '#64748B', fontSize: 11, lineHeight: 16, marginTop: 3 },
  triggerActions: { flexDirection: 'row', gap: 8, marginTop: 9 },
  triggerDemoButton: { alignItems: 'center', backgroundColor: '#E0F2FE', borderRadius: 9, flex: 1, justifyContent: 'center', paddingVertical: 9 },
  triggerDemoButtonText: { color: '#0369A1', fontSize: 11, fontWeight: '800' },
  triggerLiveButton: { alignItems: 'center', backgroundColor: '#DDF7F1', borderRadius: 9, flex: 1, justifyContent: 'center', paddingVertical: 9 },
  triggerLiveButtonText: { color: '#047857', fontSize: 11, fontWeight: '800' },
  triggerMessage: { color: '#475569', fontSize: 11, lineHeight: 16, marginTop: 8 },
  pushTokenStatus: { color: '#64748B', fontSize: 10, lineHeight: 15, marginTop: 3 },
  pushTokenActions: { flexDirection: 'row', gap: 7, marginTop: 8 },
  pushPrepareButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#99D7CC',
    borderRadius: 9,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  pushPrepareButtonText: { color: '#0F766E', fontSize: 10, fontWeight: '900' },
  pushTokenButton: {
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    borderRadius: 9,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  pushTokenButtonText: { color: '#047857', fontSize: 10, fontWeight: '900' },
});
