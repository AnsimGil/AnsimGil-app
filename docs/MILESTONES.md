# 안심길 MVP 마일스톤

## 제품 범위

안심길 MVP의 목표는 다음 한 문장으로 고정한다.

> 재난 상황과 사용자의 위치가 관련 있을 때 알림을 보내고, 침수 위험구역을 피하는 경로를 지도에 보여준다.

이 MVP는 배포하지 않는다. 로컬 Android 에뮬레이터에서 시연 가능하고, 소스코드와 재현 문서만 제출한다. 따라서 모든 시연 흐름은 실제 운전, 상시 백그라운드 위치 추적, 운영 서버, 실시간 데이터베이스에 의존하지 않도록 구성한다.

## 마일스톤

### M0 — 기술 스택과 재현 기준 확정

- Expo React Native + TypeScript + Expo Router
- Android 우선, Google Play 이미지가 포함된 Android Emulator 기준
- Spring Boot 로컬 서버와 REST 통신
- Google Maps SDK for Android 사용(개인 시연 영상에서 선택)
- 제출·재현 기준은 API 키가 필요 없는 로컬 Demo 지도 모드
- 데이터베이스, 인증, 운영 배포, Google Navigation SDK는 MVP 범위에서 제외
- 소스코드 제출자가 아닌 심사 환경에서도 재현할 수 있도록 `.env.example`, 설치 절차, API 키 설정 절차를 유지

### M1 — 앱 프로젝트 부트스트랩

- Expo Router/TypeScript 기본 화면
- Android 개발 빌드 실행
- `app.config.ts`의 패키지명 `com.ansimgil.app`
- `EXPO_PUBLIC_MAP_MODE`로 Google Maps/Demo 지도 모드 선택
- Google Maps API 키는 개인 `.env.local`에서만 native 설정으로 주입
- 현재 위치 권한과 푸시 권한/토큰 준비 골격
- 경로 설정은 목적지만 입력하고, 출발지는 현재 위치를 자동 사용

### M2 — 로컬 백엔드와 경로 API 연결

- Spring Boot 로컬 서버 실행
- 앱의 `EXPO_PUBLIC_API_BASE_URL` 연결
- Android Emulator에서 호스트 서버에 접근하는 기본 주소는 `http://10.0.2.2:8080/api/v1`
- openrouteservice Directions API를 사용하며 키는 백엔드의 `ORS_API_KEY` 환경변수로만 주입
- ORS 기본 주소는 `https://api.heigit.org/openrouteservice`
- 정상 경로와 안전 경로 응답을 앱에서 사용할 수 있는 GeoJSON 계약으로 고정

### M3 — Navigation-style Map + Normal Route

기존의 “지도 + 정상 경로”를 다음과 같이 강화한다.

- 현재 위치를 카메라 중심으로 유지
- 이동 방향을 카메라 진행 방향으로 반영
  - React Native 지도 카메라에서는 `heading`을 사용하며, Google Maps의 bearing 개념에 해당
- 카메라 `pitch/tilt`: 약 50~60도
- 카메라 `zoom`: 약 17~19
- 위치가 갱신될 때 `center`, `heading`, `pitch`, `zoom`을 함께 갱신
- 정상 경로 polyline과 현재 위치/목적지 표시
- 실제 GPS가 없어도 심사 환경에서 재현할 수 있도록 경로 위를 이동하는 로컬 시뮬레이터 제공
- Flood Alert가 발생하면 카메라 상태와 현재 진행 위치는 유지하고, 정상 경로 polyline만 안전 경로 polyline으로 교체

#### M3 성공 조건

Android Emulator에서 다음 흐름을 반복 실행할 수 있어야 한다.

1. Demo에서는 로컬 출발지·목적지 노드로, LIVE에서는 현재 GPS와 목적지로 정상 경로가 표시된다.
2. `경로 안내 시작`을 누르면 현재 위치 마커가 경로를 따라 이동한다.
3. 카메라는 현재 위치를 중심으로 약 55도 기울고, 진행 방향을 바라보며, 약 18배 줌으로 따라간다.
4. Flood Alert를 누르면 동일한 카메라 흐름을 유지한 채 안전 경로로 선이 바뀐다.

M3에서는 Google Navigation SDK로 전환하지 않는다. Navigation SDK Simulator는 M3 이후 검토 항목으로 남긴다.

### M4 — 재난 안전 메시지 수신/정규화

- 행정안전부 및 재난안전 관련 공식 공공데이터를 백엔드에서 수신
- 현재는 행정안전부 `긴급재난문자` API(`/V2/api/DSSP-IF-00247`)를 사용
- 백엔드 키는 `DISASTER_DATA_SERVICE_KEY`로만 주입하며 앱에 전달하지 않음
- `crtDt`로 최근 데이터를 조회하고 `receivedAt` 기준 최신순으로 정렬
- 원문을 앱이 처리할 수 있는 재난 이벤트 모델로 정규화
- 실시간 API 연결이 준비되지 않은 경우 동일 형식의 로컬 fixture로 시연 가능하게 유지

### M5 — 재난 유형 관련성 판정

- 침수/홍수 관련 메시지만 통과
- MVP에서는 복잡한 AI/NLP 대신 키워드와 명시적 규칙으로 판정
- 판정 결과: `FLOOD_RELATED` 또는 `NOT_RELATED`
- M5 자체에는 새로운 외부 API 키가 필요하지 않음
- 백엔드 `GET /api/v1/disasters/flood-related`에서 관련 문자만 다음 단계로 전달
- 공식 `type`의 홍수·침수·범람, 고신뢰 침수어, 호우+위험상황 조합을 사용
- 폭염·산불·실종 등 비대상 문자는 통과시키지 않음

### M6 — 사용자 위치 관련성 판정 ✅

- 재난 메시지의 행정구역/좌표와 사용자 위치를 비교
- MVP에서는 서울 특정 구역 또는 데모 polygon으로 범위를 제한
- 판정 결과: `LOCATION_RELEVANT` 또는 `LOCATION_NOT_RELEVANT`
- M6 자체에는 새로운 외부 API 키가 필요하지 않음
- 백엔드 `POST /api/v1/disasters/location-relevant`에서 M5 통과 이벤트를 평가
- 서울시·서울 25개 구의 재현용 근사 범위로 결정적 판정
- 좌표와 조회 개수 입력을 검증하고 이벤트별 판정 근거를 반환

### M6.5 — 기상청 단기예보 기반 위험도 보강 ✅

- 기상청 `단기예보 조회서비스`를 사용해 사용자 위치 주변의 현재/향후 강수 정보를 조회
- 예보는 `Risk Context`로만 사용하고 `ANSIMGIL_TRIGGER`의 필수조건으로 만들지 않음
- `FLOOD_RELATED && LOCATION_RELEVANT`이면 예보 응답이 없어도 Trigger를 유지
- 예보 응답이 있으면 강수 위험 문구와 위험도 정보를 알림/화면에 보강
- 기상청 격자 좌표(`nx`, `ny`)와 예보 발표시각/UTC 변환을 백엔드에서 처리
- 기상청 API 서비스키가 필요하며, 작업 시작 전에 발급·승인 상태를 확인
- 키나 실시간 연결이 없을 경우 동일 형식의 로컬 기상 fixture로 재현
- 백엔드 `GET /api/v1/weather/short-term`에서 위경도를 기상청 `nx`, `ny` 격자로 변환
- `POP`, `PTY`, `PCP`, `TMP`를 정규화하고 `NONE`, `POSSIBLE`, `EXPECTED` Risk Context로 반환
- `KMA_WEATHER_USE_LIVE=true`일 때만 라이브 호출하며, 기본값과 API 장애 시 fixture로 전환

### M7 — 도시침수지도 기반 FloodZone 생성 ⏸️ LIVE 보류

- 환경부 한강홍수통제소의 `유역별 빈도별 도시침수지도`를 우선 검토
- 도시침수지도는 “어디를 피해야 하는가”를 결정하는 공간 데이터로 사용
- 침수 위험구역을 GeoJSON polygon으로 표현
- 도시침수지도 메타데이터가 WMS인 경우, MVP에서는 필요한 지역을 로컬 공간 fixture/변환 결과로 고정해 재현성을 확보
- 공식 API 레퍼런스의 행정구역 도시침수 WMS 서비스 경로(`adm-cty-wms`), 파라미터, 좌표계 확인
- 도시침수지도 자체의 인증키 필요 여부는 제공 방식 확인 후 확정하며, 작업 시작 전에 사용자에게 알림
- 재난문자와 위치가 확정한 뒤 해당 지역의 FloodZone을 활성화
- 제출·심사 재현용 기본 모드는 `FLOOD_MAP_MODE=demo`로 고정하고 로컬 서울 fixture를 사용
- 개인 시연 영상에서만 `FLOOD_MAP_MODE=live`를 선택하며, 실제 서비스키는 백엔드 로컬 환경변수로만 주입
- `/api/v1/flood-zones`가 지도 표시와 ORS 회피경로에 공통으로 사용하는 GeoJSON 계약을 제공
- 공식 WMS는 백엔드 프록시를 통해 Android 지도에 표시하고, 인증키가 앱에 노출되지 않도록 구성
- WMS는 `image/png` 화면 표시용이며, ORS 회피용 Polygon GeoJSON과는 별도 계약으로 관리
- 서비스키가 없어도 M7 Demo fixture를 기반으로 후속 M7.5 작업을 진행

### M7.5 — ORS Safe Routing ✅ Demo 기준

- M2에서 연결한 openrouteservice Directions API를 계속 사용
- 활성 FloodZone을 `avoid_polygons`로 전달
- 정상 경로와 위험구역의 교차 여부 확인
- 안전 경로 요청 시 위험구역을 회피한 경로 반환
- M3의 navigation-style 카메라와 경로 추적은 유지하고 polyline만 안전 경로로 교체
- 새로운 키는 필요하지 않지만 기존 `ORS_API_KEY` 유효성과 회피 결과를 M7.5 시작 전에 확인
- 현재는 M7의 로컬 서울용 Demo FloodZone을 `avoid_polygons`에 전달
- 공식 FloodZone provider가 연결되면 동일한 Route API 계약에서 회피 geometry만 교체
- `/api/v1/routes/safe`가 실패하거나 ORS 키가 없는 심사 환경에서는 앱의 로컬 안전경로 fixture로 재현

### M8 — 관련 사용자 대상 Android Push ✅

- `FLOOD_RELATED && LOCATION_RELEVANT`일 때만 알림 트리거
- Android 알림 권한과 Expo Push Token을 사용
- 전체 사용자 broadcast는 구현하지 않음
- 에뮬레이터에서 권한 승인과 토큰 준비를 확인
- 제출·재현 기본값은 `EXPO_PUBLIC_PUSH_MODE=demo`로 고정하고 Firebase 파일 없이 실행
- 개인 시연 영상에서만 `EXPO_PUBLIC_PUSH_MODE=live`와 로컬 `google-services.json`을 사용
- 토큰 발급 성공 시 전체 토큰을 노출하지 않는 로컬 전용 `토큰 복사` 기능으로 Expo Push 테스트 도구에 전달
- `google-services.json`과 FCM 서비스 계정 키 JSON은 Git 및 제출 압축파일에서 제외
- `google-services.json`은 Android 패키지 `com.ansimgil.app`과 일치하는지 확인
- FCM V1 서비스 계정 키는 EAS 자격 증명에 저장하고 소스코드에 포함하지 않음
- Android Emulator에서 알림 권한 승인, Expo Push Token 발급, 백그라운드 알림 수신을 확인

### M9 — 알림 탭에서 앱 화면으로 이동 ✅

- 알림 탭 이벤트 수신
- 안심길 앱을 열고 재난 구역/안전 경로 화면으로 이동
- 딥링크는 최소한의 화면 이동만 지원
- Expo Push 알림의 `url` 데이터로 백그라운드 상태에서 앱 재진입을 확인

### M10 — End-to-End 데모 트리거 ✅

다음 하나의 시나리오를 로컬에서 반복 실행한다.

```text
재난 fixture 또는 백엔드 trigger
  → 침수 관련성 판정
  → 사용자 위치 관련성 판정
  → 기상청 Risk Context 보강(선택적)
  → 도시침수지도 기반 FloodZone 활성화
  → ORS Safe Route 계산
  → 대상 사용자만 push
  → 알림 탭
  → 지도에서 안전 경로로 교체
```

현재 구현:

- 백엔드 `POST /api/v1/demo/trigger`가 M5·M6·M6.5·M7·M7.5 흐름을 단일 요청으로 오케스트레이션
- 기본 `routeMode=demo`, `pushMode=demo`로 외부 키 없이 재현
- `dataMode=demo`가 전역 공공데이터 LIVE 설정과 무관하게 Demo 재난·날씨 fixture를 선택
- 개인 시연에서는 요청 단위로 `routeMode=ors`, `pushMode=live` 선택 가능
- `pushMode=live`는 별도 API 키 없이 Expo Push Service로 대상 Expo Push Token에 발송
- 푸시 payload의 `/?floodAlert=true`를 앱이 해석하여 안전경로로 자동 전환
- Demo 경로 fixture는 Demo FloodZone을 회피하도록 구성
- Android 백그라운드 알림 수신, 알림 탭, `FLOOD ALERT` 표시, 침수 위험구역 우회까지 E2E 검증 완료

### M10.5 — Navigation UI + LIVE/DEMO E2E 🚧

- 지도 위에 경로 안내 HUD, 남은 거리·예상 시간, 진행률, 현재 위치 재정렬 버튼 추가
- 앱 이름과 `NORMAL`/`FLOOD ALERT`를 고정 헤더에 유지하고, 지도 영역을 최대화하는 드래그형 경로 안내 하단 시트 적용
- 정상 경로와 Flood Alert 안전경로를 같은 내비게이션 화면에서 비교
- Demo와 LIVE 모두 화면에서는 목적지만 입력한다. Demo는 서울시청·서울역·광화문광장·명동역 중 선택한 로컬 출발지와 8개 로컬 목적지 노드를 사용하고, LIVE는 Android 에뮬레이터의 현재 GPS를 출발지로 사용
- Demo는 정상·침수 위험 발생을 선택해 위험구역 표시·미표시와 안전경로 전환을 재현하며, 출발지와 목적지를 바꾸어도 같은 로컬 계약으로 반복 시연
- Demo의 `Demo 백그라운드 알림 테스트`는 외부 Push Service·Expo Push Token 없이 Android 로컬 알림을 예약하고, 알림 터치 후 Demo Flood Alert 진입을 재현
- LIVE 모드는 위험 발생 시연과 현재 상황을 별도 UI 모드로 나누지 않고 하나의 실제 API 흐름으로 통합
- LIVE 카드에서 `adb emu geo fix <경도> <위도>`로 에뮬레이터 위치를 강제 지정하고, 앱의 `경로 안내 시작`으로 현재 GPS를 읽음
- LIVE 재난 Trigger는 앱 버튼이 아니라 터미널 명령으로 실행하며, 실제 행정안전부 조회와 서울 중구 대상자 테스트 fixture를 모두 지원
- LIVE Trigger 명령에는 목적지를 넣지 않으며, 재난·위치 판정과 푸시를 먼저 처리한 뒤 알림을 확인한 사용자가 원하는 목적지를 앱에서 선택
- 목적지 선택 후 현재 위치에서 공식 FloodZone 회피 경로를 계산하여, 하나의 목적지에 종속되지 않는 중구 내 임의 출발·도착 시연을 지원
- LIVE 카드의 `권한 확인`과 `Expo Push Token 복사`로 푸시 시연 준비를 한 곳에서 수행
- 앱이 정상 경로 안내 중 LIVE/Demo 침수 푸시를 수신하면 확인 팝업을 표시하고, `예` 선택 시 현재 위치 기준 안전경로를 재계산하여 실시간으로 경로를 교체하며 `아니오` 선택 시 기존 경로를 유지
- 앱이 백그라운드인 기존 흐름은 알림 탭 후 안전경로 화면으로 진입하는 동작을 유지
- 지도 상단의 `강수 기반 위험도` 배지를 누르면 별도 예보 화면으로 이동하며, `NONE`은 침수 위험 0이 아닌 “뚜렷한 강수 신호 없음”으로 표시
- `scripts/m10-5-e2e.sh demo`로 외부 키 없는 전체 Trigger 재현
- `scripts/m10-5-e2e.sh live`로 행정안전부·기상청·ORS·Expo Push LIVE 연결 점검
- 도시침수지도 LIVE는 공식 WMS 오버레이로 표시하고, ORS 회피용 geometry는 제출 재현성을 위해 Demo Polygon을 유지
- 실제 Android 알림 수신 및 탭 전환은 기존 M10 검증 결과를 재사용하고 M10.5에서 재확인

### M11 — Demo Hardening + 제출/재현 하드닝

- `npm ci`로 의존성 설치 가능
- Node, JDK, Android Studio/SDK, 에뮬레이터 프로필 명시
- `.env.local`은 제출하지 않고 `.env.example`만 제출
- Google Maps 키를 개인 키로 공유하지 않고 심사 환경에서 자체 발급/제한하도록 안내
- `npx expo prebuild --platform android`와 `npm run android` 실행 절차 문서화
- API 없이도 지도·M3 경로 추적·Flood Alert 경로 교체·Demo 로컬 알림 진입을 재현할 수 있는 데모 fixture 유지
- EAS 빌드와 배포는 수행하지 않음
- M6.5 기상예보와 M7 도시침수지도도 외부 연결이 불가능한 심사 환경에서 fixture로 재현 가능하게 유지
- `EXPO_PUBLIC_MAP_MODE=demo`에서 Google Maps 키 없이 M3 화면과 상호작용을 재현
- 개인 영상 녹화 시에만 `EXPO_PUBLIC_MAP_MODE=google`과 개인 키를 사용하며, 제출물에는 `.env.local`과 키를 포함하지 않음

## API 및 공공데이터 사용 기준

### API 의존성 확인 원칙

작업 시작 전에 아래 의존성을 사용자에게 먼저 알리고 키/승인 상태를 확인한다.

- M5: 새로운 API 키 없음. 재난문자 `type`/`message`의 결정적 규칙으로 처리
- M6: 새로운 API 키 없음. 재난문자 지역과 사용자 위치의 행정구역/데모 polygon을 비교
- M6.5: 기상청 `단기예보 조회서비스` 서비스키를 로컬에 확보하고, 라이브 모드에서만 사용
- M7: 도시침수지도 WMS 접근·레이어·좌표계·GeoJSON 변환 가능 여부와 인증키 필요 여부를 작업 전에 확인. 확인 전에는 로컬 Demo FloodZone만 사용
- M7.5: M2의 `ORS_API_KEY` 재사용. 키 유효성과 `avoid_polygons` 결과를 작업 전에 확인
- M8: Expo Push를 실제 전송할 경우 EAS project ID와 Android 푸시 설정 필요
- M8 로컬 시연: `EXPO_PUBLIC_PUSH_MODE=live`와 `EXPO_PUBLIC_GOOGLE_SERVICES_FILE=./google-services.json` 필요
- M8 제출 모드: `EXPO_PUBLIC_PUSH_MODE=demo`에서 Firebase/FCM 설정 없이 재현
- Google Maps 키는 현재 설정한 Android SDK 키를 재사용
- Google Maps 키는 제출물에 포함하지 않으며, `.env.example`의 기본 지도 모드는 `demo`

Google Navigation SDK는 현재 M3/M7에 필요하지 않으며, 별도 검토 작업으로 보류한다.

## 현재 상태와 다음 실행 작업

M3, M4, M5, M6, M6.5와 M10을 완료했고 M10.5를 진행 중이다.

- M3 navigation-style 지도, 정상/안전 경로, 로컬 route-following, Flood Alert 경로 교체
- M4 행정안전부 긴급재난문자 API 라이브 조회 및 표준 이벤트 정규화
- 최근 `crtDt` 조회와 `receivedAt` 최신순 정렬
- 재난 API 키가 없을 때 사용할 로컬 재난 fixture
- M5 결정적 홍수·침수 관련성 판정과 `/api/v1/disasters/flood-related` endpoint
- M6 서울 지역 기반 사용자 위치 관련성 판정과 `/api/v1/disasters/location-relevant` endpoint
- M6.5 기상청 단기예보 Risk Context와 `/api/v1/weather/short-term` endpoint
- Google Maps/Demo 지도 모드 선택과 무키 Demo 지도 재현 화면
- M7의 로컬 FloodZone fixture, `/api/v1/flood-zones` endpoint, ORS `avoid_polygons` 공통 provider 준비
- M7 LIVE 서비스키 발급 지연 상태를 유지하고, M7.5 Demo 안전경로 검증을 다음 실행 작업으로 전환
- M8 Android Push의 Demo/Live 모드 분리 반영 및 백그라운드 수신 검증 완료
- M9 알림 탭 이벤트와 안심길 앱 화면 재진입 검증 완료
- FCM V1 서비스 계정 키 EAS 업로드 완료
- 로컬 `google-services.json`을 Git 및 제출물에서 제외하도록 설정
- M10 로컬 Demo Trigger, 키 없는 안전경로 fixture, Expo Push 발송 어댑터 구현
- M10 알림 URL 기반 안전경로 자동 전환 및 Android 백그라운드 E2E 검증 완료
- M10.5 내비게이션 HUD·남은 거리·예상 시간·진행률·지도 재정렬 UI·공식 홍수위험지도 WMS 오버레이 연결
- M10.5 LIVE/DEMO E2E 점검 스크립트 추가

다음 작업은 M10.5의 LIVE/DEMO 실행 검증을 완료하는 것이다. 그 후 M11 제출·재현
하드닝으로 넘어가며, 제출 전에는 다시 `demo` 모드로 되돌리고 `google-services.json`,
`.env.local`, API 키, Expo Push Token이 압축파일에 포함되지 않았는지 확인한다.
