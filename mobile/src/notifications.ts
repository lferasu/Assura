import Constants, { ExecutionEnvironment } from "expo-constants";

type NotificationModule = {
  requestPermissionsAsync: () => Promise<unknown>;
  scheduleNotificationAsync: (request: {
    content: {
      title: string;
      body: string;
    };
    trigger: null;
  }) => Promise<unknown>;
  setNotificationHandler: (handler: {
    handleNotification: () => Promise<{
      shouldShowBanner: boolean;
      shouldShowList: boolean;
      shouldPlaySound: boolean;
      shouldSetBadge: boolean;
    }>;
  }) => void;
};

let cachedModule: NotificationModule | null | undefined;

function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

function getNotificationsModule(): NotificationModule | null {
  if (isExpoGo()) {
    return null;
  }

  if (cachedModule !== undefined) {
    return cachedModule;
  }

  try {
    cachedModule = require("expo-notifications") as NotificationModule;
  } catch {
    cachedModule = null;
  }

  return cachedModule;
}

export function configureNotifications(): boolean {
  const notifications = getNotificationsModule();
  if (!notifications) {
    return false;
  }

  notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false
    })
  });

  return true;
}

export async function requestNotificationPermissions(): Promise<boolean> {
  const notifications = getNotificationsModule();
  if (!notifications) {
    return false;
  }

  await notifications.requestPermissionsAsync();
  return true;
}

export async function scheduleLocalNotification(
  title: string,
  body: string
): Promise<boolean> {
  const notifications = getNotificationsModule();
  if (!notifications) {
    return false;
  }

  await notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null
  });

  return true;
}

export function areLocalNotificationsAvailable(): boolean {
  return getNotificationsModule() !== null;
}
