import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type {
  Coordinate,
  FloodZoneResponse,
  PlaceDetailsResponse,
  PlaceSearchResponse,
  RouteGeoJson,
  SafeRouteRequest,
  TriggerRequest,
  TriggerResponse,
  WeatherResponse,
} from '../types/geo';

const configuredApiBaseUrl = Constants.expoConfig?.extra?.apiBaseUrl;
const defaultApiBaseUrl =
  Platform.OS === 'android' ? 'http://10.0.2.2:8080/api/v1' : 'http://localhost:8080/api/v1';

export const API_BASE_URL =
  typeof configuredApiBaseUrl === 'string' && configuredApiBaseUrl.length > 0
    ? configuredApiBaseUrl.replace(/\/$/, '')
    : defaultApiBaseUrl;

async function requestRoute(path: string, payload: SafeRouteRequest): Promise<RouteGeoJson> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `경로 요청에 실패했습니다 (${response.status}). ${responseText || '서버 응답을 확인해 주세요.'}`,
    );
  }

  return (await response.json()) as RouteGeoJson;
}

export function requestNormalRoute(payload: SafeRouteRequest): Promise<RouteGeoJson> {
  return requestRoute('/routes', payload);
}

export function requestSafeRoute(payload: SafeRouteRequest): Promise<RouteGeoJson> {
  return requestRoute('/routes/safe', payload);
}

export async function requestTrigger(payload: TriggerRequest): Promise<TriggerResponse> {
  const response = await fetch(`${API_BASE_URL}/demo/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `재난 Trigger 요청에 실패했습니다 (${response.status}). ${responseText || '서버 응답을 확인해 주세요.'}`,
    );
  }

  return (await response.json()) as TriggerResponse;
}

export async function requestShortTermWeather(location: Coordinate): Promise<WeatherResponse> {
  const query = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
  });
  const response = await fetch(`${API_BASE_URL}/weather/short-term?${query.toString()}`);

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `기상청 단기예보 요청에 실패했습니다 (${response.status}). ${responseText || '서버 응답을 확인해 주세요.'}`,
    );
  }

  return (await response.json()) as WeatherResponse;
}

export async function requestFloodZones(): Promise<FloodZoneResponse> {
  const response = await fetch(`${API_BASE_URL}/flood-zones`);
  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `침수 위험구역 요청에 실패했습니다 (${response.status}). ${responseText || '서버 응답을 확인해 주세요.'}`,
    );
  }

  return (await response.json()) as FloodZoneResponse;
}

export async function requestPlaceAutocomplete(input: string): Promise<PlaceSearchResponse> {
  const query = new URLSearchParams({ input });
  const response = await fetch(`${API_BASE_URL}/places/autocomplete?${query.toString()}`);

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `장소 검색에 실패했습니다 (${response.status}). ${responseText || '서버 응답을 확인해 주세요.'}`,
    );
  }

  return (await response.json()) as PlaceSearchResponse;
}

export async function requestPlaceDetails(placeId: string): Promise<PlaceDetailsResponse> {
  const query = new URLSearchParams({ placeId });
  const response = await fetch(`${API_BASE_URL}/places/details?${query.toString()}`);

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `장소 좌표 확인에 실패했습니다 (${response.status}). ${responseText || '서버 응답을 확인해 주세요.'}`,
    );
  }

  return (await response.json()) as PlaceDetailsResponse;
}

export function extractFloodZoneCoordinates(response: FloodZoneResponse): Coordinate[] {
  const polygon = response.geoJson.features?.find(
    (feature) => feature.geometry?.type === 'Polygon',
  )?.geometry;
  const ring = polygon?.type === 'Polygon' ? polygon.coordinates[0] : undefined;

  return (ring ?? [])
    .filter((position) => position.length >= 2)
    .map(([longitude, latitude]) => ({ latitude, longitude }));
}

export function extractRouteCoordinates(route: RouteGeoJson) {
  if (route.route) {
    return extractRouteCoordinates(route.route);
  }

  const geometry =
    route.type === 'FeatureCollection'
      ? route.features?.find((feature) => feature.geometry?.type === 'LineString')?.geometry
      : route.type === 'Feature'
        ? route.geometry
        : route;

  const positions = geometry?.type === 'LineString' ? geometry.coordinates : route.coordinates;

  return (positions ?? [])
    .filter((position) => position.length >= 2)
    .map(([longitude, latitude]) => ({ latitude, longitude }));
}
