import type { Coordinate, PlaceSuggestion } from '../types/geo';

export type DemoPlace = {
  placeId: string;
  name: string;
  address: string;
  location: Coordinate;
  keywords: string[];
};

export const demoPlaces: DemoPlace[] = [
  {
    placeId: 'demo-seoul-city-hall',
    name: '서울시청',
    address: '서울특별시 중구 세종대로 110',
    location: { latitude: 37.5663, longitude: 126.9779 },
    keywords: ['시청', '서울시청', 'city hall'],
  },
  {
    placeId: 'demo-seoul-station',
    name: '서울역',
    address: '서울특별시 용산구 한강대로 405',
    location: { latitude: 37.5547, longitude: 126.9707 },
    keywords: ['서울역', 'seoul station'],
  },
  {
    placeId: 'demo-jonggak-station',
    name: '종각역',
    address: '서울특별시 종로구 종로 55',
    location: { latitude: 37.5704, longitude: 126.9831 },
    keywords: ['종각', '종각역'],
  },
  {
    placeId: 'demo-gwanghwamun',
    name: '광화문광장',
    address: '서울특별시 종로구 세종대로 172',
    location: { latitude: 37.5717, longitude: 126.9769 },
    keywords: ['광화문', '광화문광장'],
  },
  {
    placeId: 'demo-myeongdong-station',
    name: '명동역',
    address: '서울특별시 중구 퇴계로 126',
    location: { latitude: 37.5609, longitude: 126.986 },
    keywords: ['명동', '명동역'],
  },
  {
    placeId: 'demo-dongdaemun-station',
    name: '동대문역사문화공원역',
    address: '서울특별시 중구 을지로 7',
    location: { latitude: 37.5656, longitude: 127.009 },
    keywords: ['동대문', '동대문역사문화공원', '동대문역사문화공원역'],
  },
  {
    placeId: 'demo-gangnam-station',
    name: '강남역',
    address: '서울특별시 강남구 강남대로 396',
    location: { latitude: 37.4979, longitude: 127.0276 },
    keywords: ['강남', '강남역'],
  },
  {
    placeId: 'demo-jamsil-station',
    name: '잠실역',
    address: '서울특별시 송파구 올림픽로 265',
    location: { latitude: 37.5133, longitude: 127.1001 },
    keywords: ['잠실', '잠실역'],
  },
];

export function searchDemoPlaces(input: string): PlaceSuggestion[] {
  const query = input.trim().toLocaleLowerCase('ko-KR');
  if (query.length < 2) return [];

  return demoPlaces
    .filter((place) =>
      [place.name, place.address, ...place.keywords].some((value) =>
        value.toLocaleLowerCase('ko-KR').includes(query),
      ),
    )
    .slice(0, 8)
    .map((place) => ({
      placeId: place.placeId,
      primaryText: place.name,
      secondaryText: place.address,
      fullText: `${place.name} · ${place.address}`,
      types: ['demo'],
    }));
}

export function findDemoPlace(placeId: string): DemoPlace | undefined {
  return demoPlaces.find((place) => place.placeId === placeId);
}
