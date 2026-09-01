import Constants from 'expo-constants';

export type RequestedMapMode = 'google' | 'demo' | 'auto';
export type ActiveMapMode = 'google' | 'demo';

const rawMapMode = process.env.EXPO_PUBLIC_MAP_MODE?.trim().toLowerCase();
const extra = (Constants.expoConfig?.extra ?? {}) as {
  activeMapMode?: unknown;
  mapModeRequestedWithoutKey?: unknown;
};

export const requestedMapMode: RequestedMapMode =
  rawMapMode === 'google' || rawMapMode === 'demo' || rawMapMode === 'auto'
    ? rawMapMode
    : 'demo';

// The native app config decides whether Google Maps was configured. The key
// itself is never read by JavaScript, so Demo mode cannot bundle or display it.
export const activeMapMode: ActiveMapMode = extra.activeMapMode === 'google' ? 'google' : 'demo';

export const isGoogleMapEnabled = activeMapMode === 'google';
export const isGoogleMapRequestedWithoutKey = Boolean(extra.mapModeRequestedWithoutKey);
