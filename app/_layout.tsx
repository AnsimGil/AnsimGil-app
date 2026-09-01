import { useEffect, useRef } from 'react';
import { Stack, router, useRootNavigationState } from 'expo-router';
import type { Href } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  configureNotificationHandler,
} from '../src/services/notifications';

configureNotificationHandler();

function useNotificationObserver() {
  const rootNavigationState = useRootNavigationState();
  const pendingUrlRef = useRef<string | null>(null);
  const navigationReadyRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledNotificationIdRef = useRef<string | null>(null);

  function flushPendingUrl() {
    if (
      !navigationReadyRef.current ||
      !pendingUrlRef.current ||
      flushTimerRef.current !== null
    ) {
      return;
    }

    // rootNavigationState.key can become available just before Expo Router's
    // linking container has mounted. Defer the push until the current commit
    // has completed to avoid updating Expo Router before it is mounted.
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      if (!navigationReadyRef.current) return;

      const url = pendingUrlRef.current;
      if (!url) return;
      pendingUrlRef.current = null;
      router.push(url as Href);
    }, 0);
  }

  useEffect(() => {
    function queueNotificationUrl(notification: Notifications.Notification) {
      const notificationId = notification.request.identifier;
      if (notificationId && handledNotificationIdRef.current === notificationId) return;

      const data = notification.request.content.data as
        | { url?: unknown; dataMode?: unknown }
        | undefined;
      const url = data?.url;
      if (typeof url === 'string' && url.startsWith('/')) {
        const dataMode = data?.dataMode;
        const targetUrl =
          typeof dataMode === 'string' && ['demo', 'live', 'test'].includes(dataMode)
            ? `${url}${url.includes('?') ? '&' : '?'}dataMode=${encodeURIComponent(dataMode)}`
            : url;
        handledNotificationIdRef.current = notificationId || targetUrl;
        pendingUrlRef.current = targetUrl;
        // The app may already be mounted when a background notification is tapped.
        // In that case the navigation-ready effect does not run again, so flush now.
        flushPendingUrl();
      }
    }

    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse?.notification) {
      queueNotificationUrl(lastResponse.notification);
    }

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      queueNotificationUrl(response.notification);
    });

    return () => {
      subscription.remove();
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    navigationReadyRef.current = Boolean(rootNavigationState?.key);
    flushPendingUrl();

    return () => {
      navigationReadyRef.current = false;
    };
  }, [rootNavigationState?.key]);
}

export default function RootLayout() {
  useNotificationObserver();

  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#F2FBFA' },
        }}
      />
    </SafeAreaProvider>
  );
}
