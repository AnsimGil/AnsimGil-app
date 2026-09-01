# 안심길 앱 MVP

Expo React Native 기반의 Android 우선 프로토타입입니다.

전체 작업 범위와 재현 기준은 [MVP 마일스톤](./docs/MILESTONES.md)을 참고하세요. 이 프로젝트는 배포하지 않고 로컬 Android 에뮬레이터에서 시연·재현하는 것을 기준으로 합니다.

## 실행

```bash
npm ci
cp .env.example .env.local
npm run android
```

`npm ci`는 `package-lock.json`에 고정된 Expo SDK 57 호환 의존성을 그대로 설치합니다.
특히 `react-native-reanimated 4.5.1`과 `react-native-worklets 0.10.1`의 조합을 유지해야
`expo-modules-core` 네이티브 빌드가 정상적으로 동작합니다.

`npm run android`는 Android 개발 빌드를 만들고 에뮬레이터에 설치합니다. 이후 Metro 서버만 다시 실행하려면 `npm start`를 사용합니다.

## 재현 환경의 Java 기준

Android 네이티브 빌드는 Gradle이 사용하는 `JAVA_HOME`의 Java로 실행됩니다. 셸에서
`java --version`으로 확인한 버전과 Gradle의 Java가 다를 수 있으므로, 빌드 전에
`JAVA_HOME`과 Gradle 버전을 함께 확인하세요.

- Spring Boot 백엔드는 Java 17 기준입니다.
- Android 앱 빌드는 JDK 17 또는 JDK 21을 사용합니다.
- 현재 Expo/React Native 네이티브 도구 조합에서는 JDK 25를 사용하지 않습니다.
- macOS에서는 Android Studio에 포함된 JDK 21을 사용할 수 있습니다.

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"

java --version
cd android
./gradlew --version
cd ..
```

두 출력 모두 Java 21인지 확인한 뒤 앱을 실행합니다.

```bash
npm run android
```

JDK 25를 사용하면 `react-native-screens`와 `expo-modules-core`의 CMake 설정 단계에서
Java 네이티브 접근 제한 오류가 발생할 수 있습니다. 이는 애플리케이션 코드나 Firebase
설정 오류가 아니라 로컬 JDK 선택 문제입니다.

## M3 시연 순서

앱을 실행한 뒤 다음 순서로 Navigation-style Map과 Flood Alert 경로 교체를 시연합니다.

1. `경로 안내 시작`을 눌러 정상 경로와 안전 경로를 준비하고 현재 위치 마커를 경로 위에 둡니다.
2. 경로 안내가 시작되면 현재 위치 마커가 경로를 따라 이동합니다.
3. 이동 중 `Flood Alert`를 누르면 카메라 위치·기울기·진행방향은 유지하고 안전 경로 선만 교체합니다.
4. `정상 복귀`를 누르면 정상 경로로 돌아옵니다.

M3는 외부 라우팅 API 응답이 없더라도 시연할 수 있도록 로컬 데모 경로로 자동 전환합니다. 실제 백엔드가 실행 중이면 `/api/v1/routes`와 `/api/v1/routes/safe` 응답을 우선 사용합니다.

Android 에뮬레이터에서 호스트 Mac의 Spring Boot 서버에 접근할 때 기본 API 주소는 `http://10.0.2.2:8080/api/v1`입니다. 다른 주소라면 `.env.local`의 `EXPO_PUBLIC_API_BASE_URL`을 수정하세요.

## 푸시 알림 실험

Android SDK 53 이상에서는 Expo Go에서 원격 푸시를 사용할 수 없으므로 개발 빌드가 필요합니다. 앱 화면의 `권한 확인` 버튼으로 알림 권한과 토큰 준비를 실행합니다.

토큰까지 발급하려면 먼저 `eas init`으로 EAS project ID를 만든 다음 `.env.local`의 `EXPO_PUBLIC_EAS_PROJECT_ID`에 입력하세요. Android 에뮬레이터는 Google Play 서비스가 포함된 시스템 이미지로 실행해야 합니다.

제출·재현용 기본값은 `EXPO_PUBLIC_PUSH_MODE=demo`이며 Firebase 파일 없이 실행됩니다. 개인 시연 영상에서만 `.env.local`에 다음을 추가합니다.

```dotenv
EXPO_PUBLIC_PUSH_MODE=live
EXPO_PUBLIC_GOOGLE_SERVICES_FILE=./google-services.json
```

`google-services.json`은 Android 앱 패키지 `com.ansimgil.app`에 등록된 로컬 설정 파일입니다. 이 파일과 FCM 서비스 계정 키 JSON은 Git과 제출 압축파일에 포함하지 않습니다. FCM V1 서비스 계정 키는 EAS 자격 증명에 업로드한 상태를 사용합니다.

토큰 발급이 완료되면 LIVE 시연 카드의 `Expo Push Token 복사` 버튼으로 전체 Expo Push Token을 로컬 클립보드에 복사할 수 있습니다. 복사한 토큰은 [Expo Push Notifications Tool](https://expo.dev/notifications)의 Recipient에 직접 입력해 테스트하고, 채팅·Git·제출물에는 남기지 않습니다. 앱은 토큰 전체값을 화면이나 로그에 표시하지 않습니다.

백그라운드 알림은 기존처럼 알림을 탭하면 앱이 열리고 안전경로로 전환됩니다. 앱이 이미 정상 경로를 안내 중인 상태에서 침수 푸시를 받으면, 앱이 `침수로부터 안전한 경로로 안내할까요?`를 표시합니다. `예`를 누르면 현재 위치에서 정상·안전 경로를 다시 계산하고 안전경로로 전환하며, `아니오`를 누르면 현재 경로를 유지합니다.

## 지도 모드

지도는 `EXPO_PUBLIC_MAP_MODE`로 선택합니다.

- `demo`: 외부 지도 API와 API 키 없이 실행되는 제출용 기본 모드입니다. 경로, 침수구역, 현재 위치 마커, 진행방향, Flood Alert 경로 교체, 지도 길게 누르기 목적지 설정을 로컬 화면에서 재현합니다.
- `google`: 개인 시연 영상용 Google Maps 모드입니다. `.env.local`에 `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`와 함께 설정합니다.
- `auto`: 키가 있으면 Google Maps, 없으면 Demo 지도를 사용합니다.

제출 시에는 `.env.local`을 포함하지 않고 `.env.example`의 `demo` 설정을 기준으로 실행합니다. 실제 키는 소스코드나 제출 압축파일에 넣지 않습니다.

개인 시연 영상용 `.env.local` 예시는 다음과 같습니다.

```dotenv
EXPO_PUBLIC_MAP_MODE=google
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=개인_로컬_키
```

`google` 모드로 바꾸거나 다시 `demo` 모드로 바꿀 때는 Android native 설정을 다시 생성해야 합니다.

```bash
npx expo prebuild --platform android
npm run android
```

Google Maps 키는 Android 실행 파일 생성을 위해 로컬에서 생성되는 native 설정에 반영될 수
있습니다. 따라서 개인 시연 후 제출 ZIP을 만들 때는 `.env.local`, `google-services.json`,
`android/`, `ios/`를 포함하지 마세요. `.gitignore`는 Git용 설정이므로 ZIP 생성 시에도
직접 제외해야 합니다. 심사자는 키 없는 `demo` 설정에서 `prebuild` 후 앱을 재현할 수
있습니다.

단순히 앱 JavaScript만 다시 실행할 때는 native 재생성이 필요하지 않습니다. 키가 없는 `google` 설정은 자동으로 Demo 모드로 안전하게 전환됩니다.

## 목적지 입력과 Demo 출발지

경로 카드에서는 `서울역`, `시청`, `종각역`처럼 목적지만 자연어로 검색합니다. 검색 결과를
선택하면 앱이 목적지 좌표를 저장하고, 경로 안내를 시작할 때 출발지는 자동으로 현재 위치를
사용합니다. 좌표 형식(`37.5665, 126.9780`)을 목적지 입력란에 직접 입력하는 방식도 유지됩니다.

- `DEMO · 무키`: 앱에 포함된 서울 장소 목록을 사용합니다. `시연 출발지 · 로컬 Fixture` 칩에서 서울시청·서울역·광화문광장·명동역 중 하나를 선택할 수 있으며, GPS 권한이나 장소 API가 필요하지 않습니다. 목적지는 아래의 로컬 장소 검색 결과에서 선택합니다.
- `LIVE · 실제 API`: 백엔드가 Google Places API (New)의 Autocomplete와 Place Details를 호출해 목적지를 찾고, 출발지는 Android 에뮬레이터의 현재 GPS를 사용합니다.
  Google 키는 앱에 넣지 않고 백엔드 레포지토리의 `.env.local` 또는 백엔드 실행 셸의
  `GOOGLE_PLACES_API_KEY` 환경변수로만 전달합니다.

### LIVE 에뮬레이터 위치 강제 지정

개인 LIVE 시연에서 실제 GPS 대신 특정 위치를 사용해야 할 때 Android Emulator 터미널에
다음 형식으로 입력합니다. 순서는 `경도 위도`입니다.

```bash
adb emu geo fix 126.9780 37.5665
```

실행 후 앱에서 `경로 안내 시작`을 누르면 해당 위치가 출발지로 사용됩니다. 에뮬레이터가
여러 대 연결되어 있으면 `adb devices`로 대상 serial을 확인하고 다음처럼 지정합니다.

```bash
adb -s <emulator-serial> emu geo fix 126.9780 37.5665
```

앱의 LIVE 카드에서도 위치 명령을 복사할 수 있습니다. 이 명령은 앱의 GPS를 바꾸며,
백엔드 재난 Trigger 요청의 `location` 값도 같은 좌표로 맞춰야 위치 관련성 판정과 푸시
시연이 일치합니다.

중요: Android Emulator는 호스트 Mac의 물리적 위치를 Android 앱에 자동 전달하지 않습니다.
따라서 에뮬레이터에서의 `현재 위치`는 Extended Controls에서 설정한 가상 GPS 위치입니다.
심사위원이 각자의 PC 위치를 기준으로 재현하려면 해당 위치를 에뮬레이터에 한 번 설정한
뒤 `경로 안내 시작`을 누르세요. 실제 Android 기기에서 실행하면 기기의 GPS가 자동으로
현재 출발지가 됩니다. 호스트 PC의 위치를 에뮬레이터에 자동 동기화하려면 별도 OS별
위치 브리지 프로그램이 필요하므로 MVP에는 포함하지 않습니다.

개인 LIVE 시연 시 백엔드 레포지토리의 `.env.local` 파일에 다음처럼 키를 저장한 뒤
Spring Boot를 재시작합니다. 이 파일은 Git에서 무시됩니다.

```properties
GOOGLE_PLACES_API_KEY=개인_로컬_Places_키
```

기존처럼 백엔드 실행 셸에서 `export`한 뒤 시작하는 방식도 사용할 수 있습니다.

제출·재현 환경에서는 이 변수를 설정하지 않아도 Demo 장소 검색과 좌표 입력이 동작합니다.
실제 키는 `.env.local`, 셸 기록, Git, 제출 압축파일에 포함하지 않습니다.

## M7 침수 데이터 모드

침수 위험구역도 제출용 Demo와 개인 시연용 Live를 분리합니다.

```dotenv
# 제출·심사 재현용 기본값
EXPO_PUBLIC_FLOOD_MAP_MODE=demo

# 개인 시연 영상에서만 사용
# EXPO_PUBLIC_FLOOD_MAP_MODE=live
```

`demo` 모드는 백엔드의 로컬 서울용 FloodZone fixture를 사용하며, 백엔드가 실행되지
않아도 앱에 포함된 동일한 Demo Polygon으로 화면을 재현합니다. `live` 모드는
백엔드가 공식 도시침수지도 WMS 타일을 프록시하여 Google 지도 위에 라이브 위험지도를
표시합니다. WMS는 이미지 서비스이므로 현재 ORS 회피경로에는 기존 Demo Polygon을
사용합니다. 연결되지 않은 경우 화면은 자동으로 Demo Polygon으로 유지됩니다.

지도와 ORS 경로가 서로 다른 위험구역을 사용하지 않도록, 백엔드의 `/api/v1/flood-zones`
응답을 ORS `avoid_polygons`의 원천으로 함께 사용하도록 준비되어 있습니다.

홍수위험지도 서비스키는 앱에 넣지 않습니다. 실제 키가 필요한 연결은 백엔드의 로컬
환경변수로만 설정하고, `.env.local`은 제출하지 않습니다.

## M10.5 시뮬레이터 E2E

기본 화면은 지도와 `NORMAL / FLOOD ALERT` 상태를 중심으로 유지하며, 하단 시트를
위로 올려 실행 메뉴를 엽니다. 기본 실행 흐름은 다음과 같습니다.

- `DEMO · 무키`: `정상 상태` 또는 `침수 위험 발생`을 선택한 뒤 Demo 출발지 칩과
  목적지를 선택하고 `경로 안내 시작`을 누릅니다. 외부 키·네트워크 없이 Demo 지도,
  정상·안전경로 전환, 침수구역 표시·미표시를 재현합니다. 출발지와 목적지를 바꾸어도
  동일한 로컬 규칙과 경로 Fixture로 반복 시연할 수 있습니다.
- `LIVE · 실제 API`: 경로 카드에는 목적지만 입력합니다. `경로 안내 시작`을 누르면
  Android 에뮬레이터의 현재 GPS를 출발지로 사용합니다. 앱에는 Trigger 버튼이 없고,
  LIVE 카드의 목적지 없는 명령을 복사해 터미널에서 재난문자 Trigger를 실행합니다.
  실제 행정안전부 재난문자를 사용하는 명령은 서울 관련 문자가 없으면
  `LOCATION_NOT_RELEVANT`로 중단될 수 있습니다. 같은 카드의 `위험 대상자 테스트
  fixture 명령 복사`는 서울 중구 대상자 fixture를 사용해 재현 가능한 실제 푸시를
  보냅니다. 두 명령 모두 목적지를 포함하지 않으므로, 푸시를 확인한 뒤 앱에서 원하는
  목적지를 선택합니다. 특정 위치 시연이 필요하면 먼저 `adb emu geo fix <경도> <위도>`를 실행하고,
  앱 지도 우측 하단의 현재 위치 버튼을 한 번 눌러 좌표를 반영합니다.

LIVE 재난문자가 현재 사용자 위치와 일치하지 않으면 `LOCATION_NOT_RELEVANT`로
정상 중단됩니다. 이 경우 위험구역과 `FLOOD ALERT`를 표시하지 않으며, 이는 위치
관련성 보호 동작입니다. 경로 계산·경로 안내·알림 권한 기능은 하단 시연 메뉴에서 확인합니다.

LIVE의 재난 Trigger 명령은 목적지를 포함하지 않습니다. 재난안전문자는 사용자의 현재
위치와 관련된 위험을 먼저 알리고, 사용자가 알림을 확인한 뒤 원하는 목적지를 입력하면
앱이 그 시점의 현재 위치에서 정상경로와 침수 회피 안전경로를 계산합니다. 따라서 특정
목적지 하나에 묶이지 않고 서울 중구 안에서 출발지와 목적지를 바꾸어 시연할 수 있습니다.

위험 대상자 성공 예시가 필요하면 백엔드 M10 요청에 `dataMode=test`를 사용합니다.
이 모드는 `fixtures/live-test-disaster-messages.json`의 서울 중구 재난문자를 사용하며,
실제 행정안전부 LIVE 조회와 구분하기 위해 `LIVE_TEST_FIXTURE`로 표시됩니다. 앱 카드의
테스트 fixture 명령을 복사하고 `pushToken`만 입력하면 목적지와 무관하게 실제 Android
푸시를 보낼 수 있습니다. 알림 탭 후 앱에서 목적지를 선택하면 현재 위치에서 안전경로
전환을 재현할 수 있습니다.

앱이 이미 정상 경로를 안내 중인 상태에서 같은 테스트 fixture를 실행하면, 앱이
foreground 푸시를 받아 `침수 위험 감지` 확인창을 표시합니다. `예`를 누르면 현재 위치와
기존 목적지로 안전경로를 다시 계산하고, `아니오`를 누르면 정상 경로를 유지합니다.
이 흐름에서는 알림을 탭하지 않아도 경로 전환을 확인할 수 있습니다. 앱이 백그라운드인
상태에서 알림을 탭하는 기존 흐름은 처음부터 안전경로 화면으로 진입합니다.

### Demo 백그라운드 알림 재현

Demo에는 외부 Push Service와 Expo Push Token 없이 Android의 로컬 알림을 예약하는
버튼이 있습니다. 이 기능은 제출물에서 심사위원이 백그라운드 알림 터치와 안전경로
전환을 재현할 수 있도록 만든 로컬 Fixture입니다.

1. `DEMO · 무키`를 선택합니다.
2. Demo 출발지 칩을 선택하고, 목적지를 로컬 검색 결과에서 선택합니다.
3. `Demo 백그라운드 알림 테스트`를 누릅니다. Android 알림 권한을 요청하면 허용합니다.
4. 앱을 백그라운드로 보낸 뒤 `안심길 Demo 침수 위험 알림`을 터치합니다.
5. 앱이 열리면 Demo Fixture를 실행하고 `FLOOD ALERT`, 침수 위험구역, 안전경로를
   표시합니다.

알림 권한만 필요하며 Google Maps API 키, Places API 키, ORS 키, 공공데이터 키,
Expo Push Token은 필요하지 않습니다. 앱이 이미 화면에 열려 있을 때 알림이 도착하면
확인창에서 `예`를 눌러 같은 안전경로 전환을 확인할 수 있습니다. 실제 Expo 원격 푸시는
개인 LIVE 시연에서만 사용합니다.

앱에서 `침수 데이터 LIVE`가 표시되면 Google 지도 위에 공식 WMS 오버레이를 요청한
상태입니다. WMS는 이미지 서비스이므로 현재 ORS 회피경로는 기존 Demo Polygon을
사용합니다. 따라서 LIVE WMS 표시와 ORS 안전경로 생성을 각각 확인해야 합니다.

재난 Trigger가 실행되지 않은 상태에서는 지도 위 침수 위험영역을 표시하지 않습니다.
Demo에서 `침수 위험 발생`을 실행하거나, LIVE 위험 발생 시연에서 터미널 Trigger 후
푸시 알림을 선택하면 그때 Demo 위험영역 또는 공식 WMS가 표시됩니다. LIVE 재난문자가
현재 위치와 무관하면 위험영역을 숨기고 `NORMAL` 상태를 유지합니다.

경로 안내가 시작되면 지도 상단 중앙에 `강수 기반 위험도` 배지가 표시됩니다. 배지를
누르면 별도 화면에서 현재 출발지 기준 단기예보의 강수확률·강수형태·강수량·출처를
확인할 수 있습니다. `높음`과 `주의`는 예보의 강수 신호를 뜻하며, `강수 신호 없음`은
예보에서 뚜렷한 강수가 확인되지 않는다는 의미이지 침수 위험이 0이라는 뜻은 아닙니다.
침수 여부는 재난문자와 홍수위험지도, 위치 관련성을 함께 판단합니다.

## MVP API 계약

앱은 다음 요청을 보냅니다.

화면에서는 목적지만 입력하지만, 앱이 경로를 요청할 때 `origin`에는 Demo 기준점 또는
LIVE Android 에뮬레이터에서 읽은 현재 GPS 좌표를 자동으로 넣습니다.

`POST /api/v1/routes`

정상 경로 요청에 사용합니다. 안전 경로 요청은 동일한 body로 아래 endpoint를 사용합니다.

`POST /api/v1/routes/safe`

```json
{
  "origin": { "latitude": 37.5665, "longitude": 126.978 },
  "destination": { "latitude": 37.5705, "longitude": 126.992 }
}
```

응답은 GeoJSON `FeatureCollection`, `Feature`, 또는 `LineString` 중 하나이며, 앱은 첫 번째 `LineString` 경로를 지도에 그립니다.
