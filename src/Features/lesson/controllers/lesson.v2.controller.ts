import { Request, Response } from "express";
import mongoose from "mongoose";
import Lesson from "../schema/lesson.schema";
import LessonProgress from "../schema/lessonProgress.schema";
import { recordStudentActivity } from "../../gamification/service/gamification.service";

export class LessonV2Controller {
  static async completeLesson(req: Request, res: Response) {
    try {
      const { lessonId } = req.params;
      const { id } = req["currentUser"] as { id: string };

      if (!lessonId || !mongoose.Types.ObjectId.isValid(lessonId as string)) {
        return res.status(400).json({
          status: false,
          message: "Invalid or missing lessonId",
        });
      }

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          status: false,
          message: "Invalid or missing studentId",
        });
      }

      const lesson = await Lesson.findOne({
        _id: lessonId,
        status: "ACTIVE",
      }).select("_id course");

      if (!lesson) {
        return res.status(404).json({
          status: false,
          message: "Lesson not found",
        });
      }

      const progress = await LessonProgress.findOneAndUpdate(
        { student: id, lesson: lessonId },
        { $set: { completedAt: new Date() } },
        { upsert: true, new: true }
      );

      const courseId = (lesson as any).course?.toString();
      recordStudentActivity(id, "lesson_complete", {
        courseId: courseId || undefined,
        lessonId: lessonId as string,
      }).catch(() => {});

      return res.status(200).json({
        status: true,
        message: "Lesson completion recorded",
        response: progress,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "System Error",
        error: error.message,
      });
    }
  }
}
