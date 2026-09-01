import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

export const SAFETY_ALERTS_CHANNEL_ID = 'safety-alerts';
export const BACKGROUND_NOTIFICATION_TASK = 'ansimgil-background-notification';

export type PushRegistrationResult =
  | { state: 'granted'; token: string }
  | { state: 'not-configured' | 'denied' | 'unavailable' | 'error'; message: string };

let handlerConfigured = false;

function getPushMode() {
  return Constants.expoConfig?.extra?.pushMode === 'live' ? 'live' : 'demo';
}

function isFirebaseConfigMissing() {
  return Constants.expoConfig?.extra?.pushModeRequestedWithoutFirebaseConfig === true;
}

export function configureNotificationHandler() {
  if (handlerConfigured) return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  handlerConfigured = true;
}

TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  BACKGROUND_NOTIFICATION_TASK,
  async ({ data, error }) => {
    if (error) {
      console.error('[AnsimGil] background notification task failed', error);
      return Notifications.BackgroundNotificationTaskResult.Failed;
    }

    console.log('[AnsimGil] background notification received', data);
    return Notifications.BackgroundNotificationTaskResult.NoData;
  },
);

export async function registerBackgroundNotificationTaskAsync() {
  if (Platform.OS === 'web') return;

  try {
    if (!(await TaskManager.isAvailableAsync())) return;

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_NOTIFICATION_TASK);
    if (!isRegistered) {
      await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
    }
  } catch (error) {
    console.warn('[AnsimGil] background notification task is unavailable', error);
  }
}

// Register at module load so headless/background launches can resolve the task.
void registerBackgroundNotificationTaskAsync();

export type DemoNotificationResult =
  | { state: 'scheduled'; message: string }
  | { state: 'denied' | 'unavailable' | 'error'; message: string };

/**
 * 외부 Push Service 없이 Android 알림 수신·터치 흐름을 재현합니다.
 * 알림 데이터는 실제 M10 Push와 같은 floodAlert URL 구조를 사용합니다.
 */
export async function scheduleDemoFloodNotificationAsync(
  notificationUrl: string,
): Promise<DemoNotificationResult> {
  if (Platform.OS === 'web') {
    return { state: 'unavailable', message: '웹에서는 Demo 백그라운드 알림을 실행할 수 없습니다.' };
  }

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(SAFETY_ALERTS_CHANNEL_ID, {
        name: '안전 알림',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#0F766E',
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return { state: 'denied', message: '알림 권한이 허용되지 않아 Demo 알림을 예약하지 못했습니다.' };
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: '안심길 Demo 침수 위험 알림',
        body: '로컬 재난문자 Fixture가 감지되었습니다. 알림을 눌러 안전경로를 확인하세요.',
        sound: 'default',
        data: {
          url: notificationUrl,
          trigger: 'M10_FLOOD_ALERT',
          dataMode: 'demo',
          source: 'LOCAL_NOTIFICATION',
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 3,
        repeats: false,
        channelId: SAFETY_ALERTS_CHANNEL_ID,
      },
    });

    return {
      state: 'scheduled',
      message: '3초 뒤 Demo 로컬 알림을 보냅니다. 앱을 백그라운드로 보낸 뒤 알림을 터치하세요.',
    };
  } catch (error) {
    console.warn('[AnsimGil] unable to schedule demo notification', error);
    return { state: 'error', message: 'Demo 로컬 알림을 예약하지 못했습니다.' };
  }
}

export async function registerForPushNotificationsAsync(): Promise<PushRegistrationResult> {
  if (Platform.OS === 'web') {
    return { state: 'unavailable', message: '웹에서는 Android 푸시 준비를 실행하지 않습니다.' };
  }

  if (getPushMode() !== 'live') {
    return {
      state: 'not-configured',
      message: '현재 무키 Demo 모드입니다. Expo Push Token은 LIVE 모드에서만 준비합니다. Demo는 로컬 알림을 사용하세요.',
    };
  }

  if (isFirebaseConfigMissing()) {
    return {
      state: 'not-configured',
      message: 'Live 모드의 Firebase 설정 파일 경로가 없습니다. google-services.json 경로를 확인하세요.',
    };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(SAFETY_ALERTS_CHANNEL_ID, {
      name: '안전 알림',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0F766E',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return { state: 'denied', message: '알림 권한이 허용되지 않았습니다.' };
  }

  if (!Device.isDevice && Platform.OS === 'android') {
    // Android emulators with Google Play services can still be used for this MVP.
    console.info('[AnsimGil] testing push notifications on an Android emulator');
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    return {
      state: 'not-configured',
      message: 'EAS projectId가 없어 권한까지만 준비했습니다. eas init 후 .env.local에 projectId를 입력하세요.',
    };
  }

  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return { state: 'granted', token };
  } catch (error) {
    console.warn('[AnsimGil] unable to fetch Expo push token', error);
    return {
      state: 'error',
      message: '권한은 허용됐지만 푸시 토큰을 가져오지 못했습니다. 개발 빌드와 네트워크를 확인하세요.',
    };
  }
}
