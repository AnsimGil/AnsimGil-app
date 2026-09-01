export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type PlaceSuggestion = {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  fullText: string;
  types: string[];
};

export type PlaceSearchResponse = {
  source: string;
  live: boolean;
  suggestions: PlaceSuggestion[];
};

export type PlaceDetailsResponse = {
  source: string;
  live: boolean;
  placeId: string;
  name: string;
  address: string;
  location: Coordinate;
};

export type GeoJsonPosition = [longitude: number, latitude: number, elevation?: number];

export type SafeRouteRequest = {
  origin: Coordinate;
  destination: Coordinate;
};

export type GeoJsonGeometry = {
  type: 'LineString';
  coordinates: GeoJsonPosition[];
};

export type FloodZoneGeoJson = {
  type: 'FeatureCollection';
  features?: Array<{
    type: 'Feature';
    properties?: Record<string, unknown>;
    geometry?: {
      type: 'Polygon';
      coordinates: GeoJsonPosition[][];
    } | null;
  }>;
};

export type FloodZoneResponse = {
  source: string;
  requestedMode: 'demo' | 'live';
  live: boolean;
  fallbackReason: string | null;
  geoJson: FloodZoneGeoJson;
};

export type WeatherForecast = {
  forecastDate: string;
  forecastTime: string;
  precipitationProbability: number | null;
  precipitationType: string;
  precipitationAmount: string;
  temperature: number | null;
};

export type WeatherResponse = {
  source: string;
  live: boolean;
  userLocation: Coordinate;
  grid: { nx: number; ny: number };
  baseDate: string;
  baseTime: string;
  riskLevel: 'NONE' | 'POSSIBLE' | 'EXPECTED';
  summary: string;
  fallbackReason: string | null;
  forecasts: WeatherForecast[];
};

export type TriggerRequest = {
  location: Coordinate;
  destination?: Coordinate;
  limit?: number;
  routeMode?: 'demo' | 'ors';
  dataMode?: 'demo' | 'live' | 'test';
  pushMode?: 'demo' | 'live';
  sendPush?: boolean;
  pushToken?: string;
};

export type TriggerResponse = {
  triggerStatus: string;
  dataMode: 'demo' | 'live' | 'test';
  decision: {
    floodRelated: boolean;
    locationRelevant: boolean;
    eventId: string | null;
    matchedRegion: string | null;
  };
  weather: WeatherResponse | null;
  floodZone: FloodZoneResponse | null;
  route: {
    status: string;
    mode: string;
    source: string | null;
    error: string | null;
    geoJson: RouteGeoJson | null;
  };
  push: {
    status: string;
    mode: string;
  };
};

export type RouteGeoJson = {
  type: 'FeatureCollection' | 'Feature' | 'LineString';
  geometry?: GeoJsonGeometry | null;
  coordinates?: GeoJsonPosition[];
  features?: Array<{
    geometry?: GeoJsonGeometry | null;
  }>;
  route?: RouteGeoJson;
};
