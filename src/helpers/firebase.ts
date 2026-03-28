import * as admin from "firebase-admin";

const getServiceAccount = () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error("[firebase] failed to parse service account", error);
    return null;
  }
};

const getFirebaseApp = () => {
  if (admin.apps.length > 0) return admin.app();
  const serviceAccount = getServiceAccount();
  if (!serviceAccount) return null;
  try {
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
    });
  } catch (error) {
    console.error("[firebase] initialization failed", error);
    return null;
  }
};

export type FirebaseNotificationPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

export const sendFirebaseNotification = async (
  token: string,
  payload: FirebaseNotificationPayload
) => {
  const app = getFirebaseApp();
  if (!app) return;
  if (!token) return;
  await app.messaging().send({
    token,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data,
  });
};
