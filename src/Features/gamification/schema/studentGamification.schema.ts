const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const badgeSchema = new Schema(
  {
    id: { type: String, required: true },
    earnedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const challengeCountsSchema = new Schema(
  {
    ai_query: { type: Number, default: 0 },
    lesson_complete: { type: Number, default: 0 },
    quiz_complete: { type: Number, default: 0 },
    flashcard_session: { type: Number, default: 0 },
  },
  { _id: false }
);

const periodChallengeSchema = new Schema(
  {
    periodId: { type: String, required: true },
    counts: { type: challengeCountsSchema, default: () => ({}) },
    rewarded: { type: Boolean, default: false },
  },
  { _id: false }
);

const studentGamificationSchema = new Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    lastActiveDateKey: { type: String, default: null },
    streakReminderDateKey: { type: String, default: null }, // for streak reminder cron
    lastActiveDate: { type: Date, default: null },
    currentStreak: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    totalXp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    badges: [badgeSchema],
    dailyChallenge: { type: periodChallengeSchema, default: null },
    weeklyChallenge: { type: periodChallengeSchema, default: null },
  },
  { timestamps: true }
);

studentGamificationSchema.index({ student: 1 }, { unique: true });
studentGamificationSchema.index({ totalXp: -1 });
studentGamificationSchema.index({ currentStreak: -1 });

const StudentGamification =
  mongoose.models.StudentGamification ||
  mongoose.model("StudentGamification", studentGamificationSchema);

export default StudentGamification;
