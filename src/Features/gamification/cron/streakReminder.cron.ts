import cron from "node-cron";
import StudentGamification from "../schema/studentGamification.schema";
import User from "../../user/schema/user.schema";
import {
  formatDateInZone,
  getTodayKey,
  normalizeTimeZone,
} from "../service/gamification.service";
import { sendFirebaseNotification } from "../../../helpers/firebase";
import { isUserNotificationEnabled } from "../../../helpers/notificationSettings";

type StreakReminderOptions = {
  cronExpression?: string;
};

const getYesterdayKey = (timeZone: string) => {
  return formatDateInZone(
    new Date(Date.now() - 24 * 60 * 60 * 1000),
    timeZone
  );
};

export const startStreakReminderCron = (
  options: StreakReminderOptions = {}
) => {
  // Default 17:30 UTC daily; override via options.cronExpression / STREAK_REMINDER_CRON
  const cronExpression = options.cronExpression || "00 18 * * *";

  cron.schedule(
    cronExpression,
    async () => {
      try {
        const candidates = await StudentGamification.find({
          currentStreak: { $gt: 0 },
        }).lean();

        for (const doc of candidates as any[]) {
          const user = await User.findById(doc.student)
            .select("firebase_token timezone email notificationSettings")
            .lean();
          const firebaseToken = (user as any)?.firebase_token as
            | string
            | undefined;
          if (!firebaseToken) continue;
          if (!isUserNotificationEnabled(user as any, "streaks")) continue;

          const timeZone = normalizeTimeZone((user as any)?.timezone);
          const todayKey = getTodayKey(timeZone);
          const yesterdayKey = getYesterdayKey(timeZone);
          const lastActiveKey =
            doc.lastActiveDateKey ||
            (doc.lastActiveDate
              ? formatDateInZone(new Date(doc.lastActiveDate), timeZone)
              : null);

          if (lastActiveKey !== yesterdayKey) continue;
          if (doc.streakReminderDateKey === todayKey) continue;

          await sendFirebaseNotification(firebaseToken, {
            title: "Keep your streak alive!",
            body: "You’re about to lose your streak. Open the app today.",
            data: {
              type: "gamification",
              event: "streak_reminder",
            },
          });

          await StudentGamification.updateOne(
            { _id: doc._id },
            { $set: { streakReminderDateKey: todayKey } }
          );
        }
      } catch (error) {
        console.error("[gamification] streak reminder cron failed", error);
      }
    },
    { timezone: "Etc/UTC" }
  );
};
