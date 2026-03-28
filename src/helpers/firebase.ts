import * as admin from "firebase-admin";

const getServiceAccount = () => {
  const raw =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
      ? Buffer.from(
          process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
          "base64"
        ).toString("utf8")
      : "");
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
  console.log("------------------FIREBASE NOTIFICATION--------------");
  console.log("payload", payload);
  console.log("token", token);
  console.log("app", app);
  await app.messaging().send({
    token,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data,
  });
};
