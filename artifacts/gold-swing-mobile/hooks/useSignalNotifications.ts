import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";

export function useSignalNotifications() {
  const prevSignalRef = useRef<string | null>(null);
  const permGrantedRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web") return;
    (async () => {
      const { status } = await Notifications.requestPermissionsAsync();
      permGrantedRef.current = status === "granted";
    })();
  }, []);

  const checkSignal = useCallback(
    (signal: string, confidence: number) => {
      const prev = prevSignalRef.current;

      if (
        prev !== null &&
        prev !== signal &&
        signal !== "HOLD" &&
        Platform.OS !== "web" &&
        permGrantedRef.current
      ) {
        const emoji = signal === "LONG" ? "🟢" : "🔴";
        Notifications.scheduleNotificationAsync({
          content: {
            title: `${emoji} ${signal} Signal — Gold`,
            body: `Confidence ${confidence.toFixed(0)}% — Open app for entry & SL/TP levels`,
            sound: true,
          },
          trigger: null,
        }).catch(() => {});
      }

      prevSignalRef.current = signal;
    },
    []
  );

  return { checkSignal };
}
