import type { ExpoConfig } from "expo/config";

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
// Keep the project identifier local so the submission does not point at a
// personal EAS project. Demo mode does not require an EAS project ID.
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
const requestedMapMode = process.env.EXPO_PUBLIC_MAP_MODE?.trim().toLowerCase();
const requestedFloodMapMode = process.env.EXPO_PUBLIC_FLOOD_MAP_MODE?.trim().toLowerCase();
const requestedPushMode = process.env.EXPO_PUBLIC_PUSH_MODE?.trim().toLowerCase();
const googleServicesFile = process.env.EXPO_PUBLIC_GOOGLE_SERVICES_FILE?.trim();
const useGoogleMaps =
  (requestedMapMode === "google" || requestedMapMode === "auto") && Boolean(googleMapsApiKey);
const activeMapMode = useGoogleMaps ? "google" : "demo";
const mapModeRequestedWithoutKey = requestedMapMode === "google" && !googleMapsApiKey;
const floodMapMode = requestedFloodMapMode === "live" ? "live" : "demo";
const pushMode = requestedPushMode === "live" ? "live" : "demo";
const pushModeRequestedWithoutFirebaseConfig = pushMode === "live" && !googleServicesFile;

const config: ExpoConfig = {
  name: "안심길",
  slug: "ansimgil-app",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "ansimgil",
  android: {
    package: "com.ansimgil.app",
    googleServicesFile: pushMode === "live" ? googleServicesFile : undefined,
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: ["POST_NOTIFICATIONS"],
    predictiveBackGestureEnabled: false,
  },
  ios: {
    bundleIdentifier: "com.ansimgil.app",
  },
  plugins: [
    "expo-router",
    "expo-dev-client",
    "./plugins/with-standard-debug-keystore",
    "./plugins/with-local-http",
    [
      "expo-notifications",
      {
        color: "#0F766E",
        defaultChannel: "safety-alerts",
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "안심길이 안전 경로를 위해 현재 위치를 사용합니다.",
      },
    ],
    useGoogleMaps
      ? ["react-native-maps", { androidGoogleMapsApiKey: googleMapsApiKey }]
      : "react-native-maps",
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    apiBaseUrl,
    activeMapMode,
    mapModeRequestedWithoutKey,
    floodMapMode,
    pushMode,
    pushModeRequestedWithoutFirebaseConfig,
    eas: easProjectId ? { projectId: easProjectId } : undefined,
  },
  web: {
    favicon: "./assets/favicon.png",
  },
};

export default config;
