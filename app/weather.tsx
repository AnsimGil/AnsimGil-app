import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';

import { requestShortTermWeather } from '../src/lib/api';
import type { Coordinate, WeatherResponse } from '../src/types/geo';

const SEOUL_CITY_HALL: Coordinate = { latitude: 37.5663, longitude: 126.9779 };

function readParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function parseCoordinate(latitudeParam?: string, longitudeParam?: string): Coordinate | null {
  const latitude = Number(latitudeParam);
  const longitude = Number(longitudeParam);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function fallbackRegionName({ latitude, longitude }: Coordinate) {
  if (latitude >= 37.4 && latitude <= 37.7 && longitude >= 126.7 && longitude <= 127.3) {
    return '서울특별시';
  }
  return '현재 위치';
}

async function resolveRegionName(location: Coordinate) {
  try {
    const addresses = await Location.reverseGeocodeAsync(location);
    const address = addresses[0];
    if (!address) return null;

    const regionParts = [address.city, address.district, address.subregion]
      .filter((part): part is string => Boolean(part && part.trim()))
      .filter((part, index, parts) => parts.indexOf(part) === index);
    return regionParts.length > 0 ? regionParts.join(' ') : null;
  } catch {
    return null;
  }
}

function riskLabel(riskLevel: WeatherResponse['riskLevel']) {
  return riskLevel === 'EXPECTED' ? '높음' : riskLevel === 'POSSIBLE' ? '주의' : '강수 신호 없음';
}

function riskDescription(riskLevel: WeatherResponse['riskLevel']) {
  return riskLevel === 'EXPECTED'
    ? '예보상 강수 가능성이 높습니다.'
    : riskLevel === 'POSSIBLE'
      ? '예보상 강수 가능성이 있습니다.'
      : '예보에서 뚜렷한 강수 신호가 확인되지 않습니다.';
}

function formatForecastSlot(date: string, time: string) {
  const monthDay = date.length === 8 ? `${date.slice(4, 6)}/${date.slice(6, 8)}` : date;
  const hourMinute = time.length === 4 ? `${time.slice(0, 2)}:${time.slice(2, 4)}` : time;
  return `${monthDay} ${hourMinute}`;
}

function RainAnimation({ riskLevel }: { riskLevel: WeatherResponse['riskLevel'] }) {
  const rainDrops = useRef(
    Array.from({ length: 8 }, () => new Animated.Value(0)),
  ).current;
  const rainCount = riskLevel === 'EXPECTED' ? 8 : riskLevel === 'POSSIBLE' ? 4 : 0;
  const rainDuration = riskLevel === 'EXPECTED' ? 520 : 900;
  const rainOpacity = riskLevel === 'EXPECTED' ? 0.9 : 0.62;
  const rainPositions = [8, 20, 32, 44, 56, 68, 80, 92];

  useEffect(() => {
    const animations = rainDrops.map((value, index) => {
      value.setValue(0);
      const animation = Animated.loop(
        Animated.sequence([
          Animated.delay(index * 55),
          Animated.timing(value, {
            toValue: 1,
            duration: rainDuration,
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration: 1,
            useNativeDriver: true,
          }),
        ]),
      );
      if (index < rainCount) animation.start();
      return animation;
    });

    return () => animations.forEach((animation) => animation.stop());
  }, [rainCount, rainDrops, rainDuration]);

  return (
    <View style={styles.rainAnimation} accessibilityLabel="위험도별 강수 애니메이션">
      <View style={styles.rainLayer}>
        {rainDrops.slice(0, rainCount).map((value, index) => (
          <Animated.View
            key={`rain-drop-${index}`}
            style={[
              styles.rainDrop,
              { left: `${rainPositions[index]}%`, opacity: rainOpacity },
              {
                opacity: value.interpolate({
                  inputRange: [0, 0.15, 1],
                  outputRange: [0, rainOpacity, 0],
                }),
                transform: [
                  {
                    translateY: value.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-5, 19],
                    }),
                  },
                ],
              },
            ]}
          />
        ))}
      </View>
      <Text style={styles.umbrellaIcon}>☂</Text>
    </View>
  );
}

export default function WeatherScreen() {
  const {
    appMode: appModeParam,
    latitude: latitudeParam,
    longitude: longitudeParam,
  } = useLocalSearchParams<{
    appMode?: string;
    latitude?: string;
    longitude?: string;
  }>();
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [location, setLocation] = useState<Coordinate | null>(null);
  const [locationName, setLocationName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadWeather() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const mode = readParam(appModeParam) === 'live' ? 'live' : 'demo';
        let nextLocation = parseCoordinate(
          readParam(latitudeParam),
          readParam(longitudeParam),
        );

        if (!nextLocation && mode === 'live') {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') {
            throw new Error('현재 위치 권한이 없어 예보를 조회할 수 없습니다.');
          }
          const position = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
            mayShowUserSettingsDialog: true,
          });
          nextLocation = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
        }

        nextLocation ??= SEOUL_CITY_HALL;
        const [response, resolvedLocationName] = await Promise.all([
          requestShortTermWeather(nextLocation),
          resolveRegionName(nextLocation),
        ]);
        if (cancelled) return;
        setLocation(nextLocation);
        setLocationName(resolvedLocationName ?? fallbackRegionName(nextLocation));
        setWeather(response);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : '단기예보 조회에 실패했습니다.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadWeather();
    return () => {
      cancelled = true;
    };
  }, [appModeParam, latitudeParam, longitudeParam, refreshNonce]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} accessibilityLabel="뒤로 가기">
          <Text style={styles.backButtonText}>‹</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>ANSIMGIL WEATHER</Text>
          <Text style={styles.title}>강수 기반 위험도</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color="#0F766E" size="large" />
          <Text style={styles.centerStateText}>현재 위치 기준 예보를 조회하는 중입니다…</Text>
        </View>
      ) : errorMessage ? (
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>예보를 불러오지 못했습니다.</Text>
          <Text style={styles.centerStateText}>{errorMessage}</Text>
          <Pressable style={styles.backHomeButton} onPress={() => router.back()}>
            <Text style={styles.backHomeButtonText}>지도 화면으로 돌아가기</Text>
          </Pressable>
        </View>
      ) : weather ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View
            style={[
              styles.riskCard,
              weather.riskLevel === 'EXPECTED'
                ? styles.riskCardHigh
                : weather.riskLevel === 'POSSIBLE'
                  ? styles.riskCardPossible
                  : styles.riskCardNone,
            ]}
          >
            <View style={styles.riskCardHeader}>
              <View style={styles.riskCardCopy}>
                <Text style={styles.riskValue}>{riskLabel(weather.riskLevel)}</Text>
              </View>
              <RainAnimation riskLevel={weather.riskLevel} />
            </View>
            <Text style={styles.riskDescription}>{riskDescription(weather.riskLevel)}</Text>
            <Text style={styles.locationText}>
              {locationName ?? '현재 지역 확인 중'}
            </Text>
          </View>

          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>데이터 출처</Text>
              <Text style={styles.infoValue}>{weather.live ? 'KMA LIVE' : '예보 Demo'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>예보 기준</Text>
              <Text style={styles.infoValue}>{`${weather.baseDate} ${weather.baseTime}`}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>격자</Text>
              <Text style={styles.infoValue}>{`nx ${weather.grid.nx} · ny ${weather.grid.ny}`}</Text>
            </View>
            <Text style={styles.summary}>{weather.summary}</Text>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>시간대별 예보</Text>
            <Pressable
              style={styles.refreshButton}
              onPress={() => setRefreshNonce((value) => value + 1)}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel="시간대별 예보 새로고침"
            >
              <Text style={styles.refreshIcon}>↻</Text>
            </Pressable>
          </View>
          <View style={styles.forecastCard}>
            {weather.forecasts.slice(0, 12).map((forecast) => (
              <View key={`${forecast.forecastDate}-${forecast.forecastTime}`} style={styles.forecastRow}>
                <Text style={styles.forecastTime}>{formatForecastSlot(forecast.forecastDate, forecast.forecastTime)}</Text>
                <Text style={styles.forecastType} numberOfLines={1}>{forecast.precipitationType}</Text>
                <Text style={styles.forecastProbability} numberOfLines={1}>
                  강수확률 {forecast.precipitationProbability ?? '-'}%
                </Text>
                <Text style={styles.forecastAmount}>{forecast.precipitationAmount}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.disclaimer}>
            이 값은 기상청 단기예보를 바탕으로 한 강수 위험 Context입니다. 재난문자와
            홍수위험지도에 따른 침수 판단을 대신하지 않습니다.
          </Text>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#F2FBFA', flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomColor: '#DCE7E5',
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  backButton: { alignItems: 'center', height: 38, justifyContent: 'center', width: 38 },
  backButtonText: { color: '#0F766E', fontSize: 38, fontWeight: '300', lineHeight: 38 },
  headerCopy: { marginLeft: 8 },
  eyebrow: { color: '#0F766E', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: '#0F172A', fontSize: 22, fontWeight: '900', marginTop: 2 },
  content: { padding: 18, paddingBottom: 32 },
  centerState: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 28 },
  centerStateText: { color: '#64748B', fontSize: 12, lineHeight: 18, marginTop: 12, textAlign: 'center' },
  errorTitle: { color: '#B91C1C', fontSize: 15, fontWeight: '900' },
  backHomeButton: { backgroundColor: '#0F766E', borderRadius: 11, marginTop: 18, paddingHorizontal: 15, paddingVertical: 11 },
  backHomeButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  riskCard: { borderRadius: 20, borderWidth: 1, padding: 20 },
  riskCardHigh: { backgroundColor: '#FEE2E2', borderColor: '#FECACA' },
  riskCardPossible: { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
  riskCardNone: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  riskCardHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  riskCardCopy: { flex: 1 },
  riskValue: { color: '#0F172A', fontSize: 32, fontWeight: '900' },
  riskDescription: { color: '#334155', fontSize: 13, lineHeight: 19, marginTop: 2 },
  locationText: { color: '#64748B', fontSize: 13, fontWeight: '700', marginTop: 14 },
  rainAnimation: { height: 72, justifyContent: 'flex-end', marginLeft: 10, overflow: 'hidden', width: 96 },
  rainLayer: { height: 43, left: 7, position: 'absolute', right: 7, top: 0 },
  rainDrop: { backgroundColor: '#2563EB', borderRadius: 2, height: 13, position: 'absolute', top: 2, width: 3 },
  umbrellaIcon: { color: '#0F766E', fontSize: 44, lineHeight: 48, textAlign: 'center' },
  infoCard: { backgroundColor: '#FFFFFF', borderColor: '#DCE7E5', borderRadius: 16, borderWidth: 1, marginTop: 14, padding: 15 },
  infoRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  infoLabel: { color: '#64748B', fontSize: 11 },
  infoValue: { color: '#0F766E', fontSize: 11, fontWeight: '900' },
  summary: { borderTopColor: '#E2E8F0', borderTopWidth: 1, color: '#334155', fontSize: 12, lineHeight: 18, marginTop: 8, paddingTop: 10 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  sectionTitle: { color: '#0F172A', fontSize: 15, fontWeight: '900' },
  refreshButton: { alignItems: 'center', borderColor: '#CBD5E1', borderRadius: 18, borderWidth: 1, height: 36, justifyContent: 'center', width: 36 },
  refreshIcon: { color: '#0F766E', fontSize: 25, fontWeight: '700', lineHeight: 28 },
  forecastCard: { backgroundColor: '#FFFFFF', borderColor: '#DCE7E5', borderRadius: 16, borderWidth: 1, marginTop: 9, overflow: 'hidden', paddingHorizontal: 14 },
  forecastRow: { alignItems: 'center', borderBottomColor: '#E2E8F0', borderBottomWidth: 1, flexDirection: 'row', minHeight: 70 },
  forecastTime: { color: '#334155', fontSize: 15, fontWeight: '900', width: 88 },
  forecastType: { color: '#0F172A', fontSize: 17, fontWeight: '800', width: 56 },
  forecastProbability: { color: '#64748B', flex: 1, fontSize: 15, marginLeft: 4 },
  forecastAmount: { color: '#64748B', fontSize: 15, marginLeft: 6, textAlign: 'right', width: 66 },
  disclaimer: { color: '#64748B', fontSize: 10, lineHeight: 16, marginTop: 14 },
});
