import Constants from 'expo-constants';

export type FloodMapMode = 'demo' | 'live';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  floodMapMode?: unknown;
};

export const requestedFloodMapMode: FloodMapMode =
  extra.floodMapMode === 'live' ? 'live' : 'demo';
