import { Request, Response } from "express";
import mongoose from "mongoose";
import StudentGamification from "../schema/studentGamification.schema";
import User from "../../user/schema/user.schema";
import {
  getCourseProgressForStudent,
  getLevelFromXp,
  getTodayKey,
  formatDateInZone,
  normalizeTimeZone,
} from "../service/gamification.service";

export class GamificationV2Controller {
  static async getMyGamification(req: Request, res: Response) {
    try {
      const { id } = (req as any).currentUser as { id: string };
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing student id",
        });
      }

      let doc = await StudentGamification.findOne({ student: id }).lean();
      if (!doc) {
        doc = {
          student: id,
          lastActiveDate: null,
          currentStreak: 0,
          longestStreak: 0,
          totalXp: 0,
          level: 1,
          badges: [],
          dailyChallenge: null,
          weeklyChallenge: null,
        } as any;
      }

      const courseProgress = await getCourseProgressForStudent(id);
      const headerTimeZone = req.headers["x-timezone"] as string | undefined;
      const user = await User.findById(id).select("timezone").lean();
      const timeZone = normalizeTimeZone(
        headerTimeZone || (user as any)?.timezone
      );
      const today = getTodayKey(timeZone);
      const lastDate =
        (doc as any).lastActiveDateKey ||
        ((doc as any).lastActiveDate
          ? formatDateInZone(new Date((doc as any).lastActiveDate), timeZone)
          : null);
      const streakAtRisk = lastDate !== null && lastDate !== today;

      return res.status(200).json({
        success: true,
        message: "Gamification data retrieved.",
        response: {
          currentStreak: (doc as any).currentStreak ?? 0,
          longestStreak: (doc as any).longestStreak ?? 0,
          totalXp: (doc as any).totalXp ?? 0,
          level: (doc as any).level ?? getLevelFromXp((doc as any).totalXp ?? 0),
          badges: (doc as any).badges ?? [],
          dailyChallenge: (doc as any).dailyChallenge ?? null,
          weeklyChallenge: (doc as any).weeklyChallenge ?? null,
          courseProgress,
          streakAtRisk,
        },
      });
    } catch (error: any) {
      console.log(error);
      return res.status(500).json({
        success: false,
        message: "Error fetching gamification",
        error: error?.message,
      });
    }
  }

  static async getLeaderboard(req: Request, res: Response) {
    try {
      const type = (req.query.type as string) || "xp";
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
      const { id } = (req as any).currentUser as { id?: string };

      const sort = type === "streak" ? { currentStreak: -1 } : { totalXp: -1 };
      const list = await StudentGamification.find()
        .sort(sort)
        .limit(limit)
        .populate("student", "firstname lastname email image")
        .lean();

      const items = (list as any[]).map((row, index) => ({
        rank: index + 1,
        studentId: row.student?._id ?? row.student,
        firstname: row.student?.firstname ?? null,
        lastname: row.student?.lastname ?? null,
        image: row.student?.image ?? null,
        totalXp: row.totalXp ?? 0,
        level: row.level ?? 1,
        currentStreak: row.currentStreak ?? 0,
      }));

      let myRank: number | null = null;
      if (id && mongoose.Types.ObjectId.isValid(id)) {
        const doc = await StudentGamification.findOne({ student: id }).lean();
        if (doc) {
          const key = type === "streak" ? "currentStreak" : "totalXp";
          const value = (doc as any)[key] ?? 0;
          myRank = await StudentGamification.countDocuments({
            [key]: { $gt: value },
          }) + 1;
        }
      }

      return res.status(200).json({
        success: true,
        message: "Leaderboard retrieved.",
        response: {
          type,
          items,
          myRank,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching leaderboard",
        error: error?.message,
      });
    }
  }
}
