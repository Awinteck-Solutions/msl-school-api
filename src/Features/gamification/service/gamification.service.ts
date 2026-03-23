import StudentGamification from "../schema/studentGamification.schema";
import LessonProgress from "../../lesson/schema/lessonProgress.schema";
import Lesson from "../../lesson/schema/lesson.schema";
import QuizResponse from "../../quiz/schema/quizResponse.schema";
import Course from "../../course/schema/course.schema";

export type ActivityType =
  | "ai_query"
  | "lesson_complete"
  | "quiz_complete"
  | "flashcard_session";

export interface ActivityMetadata {
  courseId?: string;
  lessonId?: string;
  quizId?: string;
  flashcardId?: string;
  totalCorrect?: number;
  totalQuestions?: number;
}

const XP_BY_ACTIVITY: Record<ActivityType, number> = {
  ai_query: 10,
  lesson_complete: 20,
  quiz_complete: 15,
  flashcard_session: 10,
};

const DAILY_BONUS_XP = 5;
const DAILY_CHALLENGE_TARGET = { ai_query: 3 };
const DAILY_CHALLENGE_REWARD_XP = 20;
const WEEKLY_CHALLENGE_TARGET = { lesson_complete: 5 };
const WEEKLY_CHALLENGE_REWARD_XP = 50;

export function getLevelFromXp(totalXp: number): number {
  if (totalXp <= 0) return 1;
  return Math.floor(1 + Math.sqrt(totalXp / 50));
}

function getTodayUtc(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function getWeekId(): string {
  const d = new Date();
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return start.toISOString().slice(0, 10);
}

function ensureChallengeCounts(c: any): Record<string, number> {
  if (!c) return { ai_query: 0, lesson_complete: 0, quiz_complete: 0, flashcard_session: 0 };
  return {
    ai_query: c.ai_query ?? 0,
    lesson_complete: c.lesson_complete ?? 0,
    quiz_complete: c.quiz_complete ?? 0,
    flashcard_session: c.flashcard_session ?? 0,
  };
}

export async function recordStudentActivity(
  studentId: string,
  activityType: ActivityType,
  metadata?: ActivityMetadata
): Promise<void> {
  const today = getTodayUtc();
  const weekId = getWeekId();

  let doc = await StudentGamification.findOne({ student: studentId });
  if (!doc) {
    doc = new StudentGamification({
      student: studentId,
      lastActiveDate: null,
      currentStreak: 0,
      longestStreak: 0,
      totalXp: 0,
      level: 1,
      badges: [],
    });
  }

  const lastDate = doc.lastActiveDate
    ? new Date(doc.lastActiveDate).toISOString().slice(0, 10)
    : null;
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  if (lastDate !== today) {
    if (lastDate === yesterdayStr) {
      doc.currentStreak = (doc.currentStreak || 0) + 1;
    } else if (lastDate !== null) {
      doc.currentStreak = 1;
    } else {
      doc.currentStreak = 1;
    }
    doc.lastActiveDate = new Date(today + "T00:00:00.000Z");
    if (doc.currentStreak > (doc.longestStreak || 0)) {
      doc.longestStreak = doc.currentStreak;
    }
  }

  let xpToAdd = XP_BY_ACTIVITY[activityType] ?? 0;
  if (activityType === "quiz_complete" && metadata?.totalQuestions && metadata?.totalCorrect) {
    const pct = metadata.totalQuestions > 0 ? metadata.totalCorrect / metadata.totalQuestions : 0;
    if (pct >= 0.8) xpToAdd += 5;
  }

  const badgeIds = new Set((doc.badges || []).map((b: any) => b.id));

  if (activityType === "ai_query" && !badgeIds.has("first_question")) {
    doc.badges = doc.badges || [];
    doc.badges.push({ id: "first_question", earnedAt: new Date() });
    badgeIds.add("first_question");
  }

  doc.totalXp = (doc.totalXp || 0) + xpToAdd;
  doc.level = getLevelFromXp(doc.totalXp);

  if (doc.currentStreak >= 7 && !badgeIds.has("streak_7")) {
    doc.badges = doc.badges || [];
    doc.badges.push({ id: "streak_7", earnedAt: new Date() });
    badgeIds.add("streak_7");
  }
  if (doc.currentStreak >= 30 && !badgeIds.has("streak_30")) {
    doc.badges = doc.badges || [];
    doc.badges.push({ id: "streak_30", earnedAt: new Date() });
    badgeIds.add("streak_30");
  }
  if (doc.currentStreak >= 100 && !badgeIds.has("streak_100")) {
    doc.badges = doc.badges || [];
    doc.badges.push({ id: "streak_100", earnedAt: new Date() });
    badgeIds.add("streak_100");
  }
  if (doc.totalXp >= 100 && !badgeIds.has("xp_100")) {
    doc.badges = doc.badges || [];
    doc.badges.push({ id: "xp_100", earnedAt: new Date() });
    badgeIds.add("xp_100");
  }
  if (doc.totalXp >= 500 && !badgeIds.has("xp_500")) {
    doc.badges = doc.badges || [];
    doc.badges.push({ id: "xp_500", earnedAt: new Date() });
    badgeIds.add("xp_500");
  }

  if (activityType === "quiz_complete") {
    const quizCount = await QuizResponse.countDocuments({ student: studentId });
    if (quizCount >= 10 && !badgeIds.has("quiz_master")) {
      doc.badges = doc.badges || [];
      doc.badges.push({ id: "quiz_master", earnedAt: new Date() });
      badgeIds.add("quiz_master");
    }
  }

  if (activityType === "lesson_complete" && metadata?.courseId) {
    const lessonIds = await Lesson.find({ course: metadata.courseId, status: "ACTIVE" })
      .select("_id")
      .lean();
    const ids = (lessonIds as any[]).map((l) => l._id);
    const completedCount = await LessonProgress.countDocuments({
      student: studentId,
      lesson: { $in: ids },
    });
    const totalCount = ids.length;
    if (totalCount > 0 && completedCount >= totalCount && !badgeIds.has("course_complete")) {
      doc.badges = doc.badges || [];
      doc.badges.push({ id: "course_complete", earnedAt: new Date() });
      badgeIds.add("course_complete");
    }
  }

  const daily = doc.dailyChallenge;
  const dailyPeriodOk = daily && daily.periodId === today;
  if (!dailyPeriodOk) {
    doc.dailyChallenge = {
      periodId: today,
      counts: { ai_query: 0, lesson_complete: 0, quiz_complete: 0, flashcard_session: 0 },
      rewarded: false,
    };
  }
  const counts = ensureChallengeCounts(doc.dailyChallenge?.counts);
  if (activityType === "ai_query") counts.ai_query += 1;
  if (activityType === "lesson_complete") counts.lesson_complete += 1;
  if (activityType === "quiz_complete") counts.quiz_complete += 1;
  if (activityType === "flashcard_session") counts.flashcard_session += 1;
  doc.dailyChallenge = doc.dailyChallenge || {
    periodId: today,
    counts,
    rewarded: false,
  };
  doc.dailyChallenge.periodId = today;
  doc.dailyChallenge.counts = counts;
  if (
    !doc.dailyChallenge.rewarded &&
    counts.ai_query >= DAILY_CHALLENGE_TARGET.ai_query
  ) {
    doc.dailyChallenge.rewarded = true;
    doc.totalXp += DAILY_CHALLENGE_REWARD_XP;
    doc.level = getLevelFromXp(doc.totalXp);
  }

  const weekly = doc.weeklyChallenge;
  const weeklyPeriodOk = weekly && weekly.periodId === weekId;
  if (!weeklyPeriodOk) {
    doc.weeklyChallenge = {
      periodId: weekId,
      counts: { ai_query: 0, lesson_complete: 0, quiz_complete: 0, flashcard_session: 0 },
      rewarded: false,
    };
  }
  const wCounts = ensureChallengeCounts(doc.weeklyChallenge?.counts);
  if (activityType === "ai_query") wCounts.ai_query += 1;
  if (activityType === "lesson_complete") wCounts.lesson_complete += 1;
  if (activityType === "quiz_complete") wCounts.quiz_complete += 1;
  if (activityType === "flashcard_session") wCounts.flashcard_session += 1;
  doc.weeklyChallenge = doc.weeklyChallenge || {
    periodId: weekId,
    counts: wCounts,
    rewarded: false,
  };
  doc.weeklyChallenge.periodId = weekId;
  doc.weeklyChallenge.counts = wCounts;
  if (
    !doc.weeklyChallenge.rewarded &&
    wCounts.lesson_complete >= WEEKLY_CHALLENGE_TARGET.lesson_complete
  ) {
    doc.weeklyChallenge.rewarded = true;
    doc.totalXp += WEEKLY_CHALLENGE_REWARD_XP;
    doc.level = getLevelFromXp(doc.totalXp);
  }

  await doc.save();
}

export async function getCourseProgressForStudent(
  studentId: string
): Promise<{ courseId: string; completed: number; total: number }[]> {
  const activeCourses = await Course.find({
    status: "ACTIVE",
    archived: false,
  })
    .select("_id")
    .lean();
  const activeCourseIds = (activeCourses as any[]).map((c) => c._id);
  if (activeCourseIds.length === 0) {
    return [];
  }

  const completedByLesson = await LessonProgress.find({ student: studentId })
    .select("lesson")
    .lean();
  const lessonIds = (completedByLesson as any[]).map((r) => r.lesson);
  if (lessonIds.length === 0) {
    const lessonsByCourse = await Lesson.aggregate([
      {
        $match: {
          status: "ACTIVE",
          course: { $in: activeCourseIds },
        },
      },
      { $group: { _id: "$course", total: { $sum: 1 } } },
    ]);
    return lessonsByCourse
      .filter((g) => g._id != null)
      .map((g) => ({
        courseId: String(g._id),
        completed: 0,
        total: g.total,
      }));
  }
  const lessons = await Lesson.find({
    _id: { $in: lessonIds },
    course: { $in: activeCourseIds },
  })
    .select("course")
    .lean();
  const courseToCompleted = new Map<string, number>();
  for (const l of lessons as any[]) {
    const cid = l.course?.toString();
    if (cid) courseToCompleted.set(cid, (courseToCompleted.get(cid) || 0) + 1);
  }
  const courseTotals = await Lesson.aggregate([
    {
      $match: {
        status: "ACTIVE",
        course: { $in: activeCourseIds },
      },
    },
    { $group: { _id: "$course", total: { $sum: 1 } } },
  ]);
  return courseTotals
    .filter((g) => g._id != null)
    .map((g) => ({
      courseId: String(g._id),
      completed: courseToCompleted.get(String(g._id)) || 0,
      total: g.total,
    }));
}

