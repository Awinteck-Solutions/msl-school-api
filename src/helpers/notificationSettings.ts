/** Keys stored on User.notificationSettings (all default to on when missing). */
export type UserNotificationChannel =
  | "gamification"
  | "streaks"
  | "smartconnect"
  | "course_alerts";

export type UserNotificationSettingsShape = Partial<
  Record<UserNotificationChannel, boolean>
>;

/**
 * Whether a push may be sent for this channel. Missing settings or missing field => enabled.
 */
export function isUserNotificationEnabled(
  user: { notificationSettings?: UserNotificationSettingsShape } | null | undefined,
  channel: UserNotificationChannel
): boolean {
  const v = user?.notificationSettings?.[channel];
  return v !== false;
}
