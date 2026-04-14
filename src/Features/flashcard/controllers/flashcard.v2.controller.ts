import { Request, Response } from "express";
import mongoose from "mongoose";
import FlashCard from "../schema/flashcard.schema";
import Enrolled from "../../course/schema/enroll.schema";
import FlashCardCompletion from "../schema/flashcardLeaderboard.schema";
import FlashCardProgress from "../schema/flashcardProgress.schema";
import { recordStudentActivity } from "../../gamification/service/gamification.service";

export class FlashcardV2Controller {
  static async userCoursesWithFlashcards(req: Request, res: Response) {
    try {
      // const { email } = req.params;
      const { email } = req['currentUser'] as { email: string };
      if (!email) {
        return res.status(400).json({ error: "Missing email parameter" });
      }

      const page =
        parseInt(req.query.page as string) > 0
          ? parseInt(req.query.page as string)
          : 1;
      const limit =
        parseInt(req.query.limit as string) > 0
          ? parseInt(req.query.limit as string)
          : 10000;
      const skip = (page - 1) * limit;

      const enrollments = await Enrolled.find({ email, status: "ACTIVE" }).populate(
        {
          path: "course",
          populate: [
            { path: "categoryId" },
            {
              path: "linkedCourses.course",
              populate: { path: "categoryId" },
            },
          ],
        }
      );

      const courses: any[] = [];
      const linkedCourses: any[] = [];

      enrollments.forEach((enrollment) => {
        if (enrollment.course && enrollment.course.status === "ACTIVE") {
          courses.push(enrollment.course);

          if (enrollment.course.linkedCourses) {
            linkedCourses.push(
              ...enrollment.course.linkedCourses
                .filter((lc) => lc.course && lc.course.status === "ACTIVE")
                .map((lc) => lc.course)
            );
          }
        }
      });

      const uniqueCoursesMap = new Map();
      [...courses, ...linkedCourses].forEach((course) => {
        uniqueCoursesMap.set(course._id.toString(), course);
      });
      const uniqueCourses = Array.from(uniqueCoursesMap.values());

      const courseIds = uniqueCourses.map((course) => course._id);

      const flashcards = await FlashCard.find(
        { course: { $in: courseIds }, status: "ACTIVE" },
        { course: 1 }
      );

      const courseIdsWithFlashcards = new Set();
      flashcards.forEach((fc) => {
        fc.course.forEach((courseId: mongoose.Types.ObjectId) => {
          courseIdsWithFlashcards.add(courseId.toString());
        });
      });

      const filteredCourses = uniqueCourses.filter((course) =>
        courseIdsWithFlashcards.has(course._id.toString())
      );

      const total = filteredCourses.length;
      const totalPages = Math.ceil(total / limit);
      const paginatedCourses = filteredCourses.slice(skip, skip + limit);

      return res.status(200).json({
        status: true,
        message: "Successfully retrieved courses with flashcards",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        result: paginatedCourses,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Failed to retrieve courses with flashcards",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async byCourseStudent(req: Request, res: Response) {
    try {
      const { courseId } = req.params as {
        courseId: string;  
      };
      const { id } = req['currentUser'] as { id: string };
      const search = (req.query.search as string | undefined)?.trim();

      const searchFilter = search
        ? {
            $or: [
              { title: { $regex: search, $options: "i" } },
              { description: { $regex: search, $options: "i" } },
            ],
          }
        : {};

      if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing courseId",
        });
      }

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing studentId",
        });
      }

      const page =
        parseInt(req.query.page as string) > 0
          ? parseInt(req.query.page as string)
          : 1;
      const limit =
        parseInt(req.query.limit as string) > 0
          ? parseInt(req.query.limit as string)
          : 10000;
      const skip = (page - 1) * limit;

      const total = await FlashCard.countDocuments({
        course: courseId,
        status: "ACTIVE",
        ...searchFilter,
      });

      const flashcards = await FlashCard.find(
        { course: courseId, status: "ACTIVE", ...searchFilter },
        { students: 0, course: 0 }
      )
        .populate({
          path: "course",
          select: "title thumbnail status",
          match: { status: "ACTIVE" },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const flashcardIds = flashcards.map((fc) => fc._id);

      const [progressDocs, completionCounts] = await Promise.all([
        FlashCardProgress.find({
          student: id,
          flashcard: { $in: flashcardIds },
        }),
        FlashCardCompletion.aggregate([
          {
            $match: {
              flashcard: { $in: flashcardIds },
              student: new mongoose.Types.ObjectId(id),
            },
          },
          {
            $group: {
              _id: "$flashcard",
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

      const progressMap: Record<string, number> = {};
      progressDocs.forEach((p) => {
        progressMap[p.flashcard.toString()] = p.progress;
      });

      const completionMap: Record<string, number> = {};
      completionCounts.forEach((c) => {
        completionMap[c._id.toString()] = c.count;
      });

      flashcards.forEach((fc: any) => {
        const id = fc._id.toString();
        fc.progress = progressMap[id] || 0;
        fc.completionCount = completionMap[id] || 0;
      });

      const totalPages = Math.ceil(total / limit);

      res.status(200).json({
        success: true,
        message: "FlashCards fetched successfully",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        flashcards,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch FlashCards",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async byStudent(req: Request, res: Response) {
    try {
      const { id } = req['currentUser'] as { id: string };
      const search = (req.query.search as string | undefined)?.trim();

      const searchFilter = search
        ? {
            $or: [
              { title: { $regex: search, $options: "i" } },
              { description: { $regex: search, $options: "i" } },
            ],
          }
        : {};

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing studentId",
        });
      }

      const page =
        parseInt(req.query.page as string) > 0
          ? parseInt(req.query.page as string)
          : 1;
      const limit =
        parseInt(req.query.limit as string) > 0
          ? parseInt(req.query.limit as string)
          : 10000;
      const skip = (page - 1) * limit;

      const total = await FlashCard.countDocuments({
        students: id,
        status: "ACTIVE",
        ...searchFilter,
      });

      const flashcards = await FlashCard.find(
        { students: id, status: "ACTIVE", ...searchFilter },
        {
          _id: 1,
          title: 1,
          description: 1,
          status: 1,
          thumbnail: 1,
          updatedAt: 1,
          instructions: 1,
          flashcardItems: 1,
        }
      )
        .populate({
          path: "course",
          select: "title thumbnail status",
          match: { status: "ACTIVE" },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const totalPages = Math.ceil(total / limit);

      res.status(200).json({
        success: true,
        message: "FlashCards fetched successfully",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        flashcards,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch FlashCards",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async single(req: Request, res: Response) {
    const { id } = req.params as { id: string };

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid or missing flashcard ID" });
    }

    try {
      const flashcards = await FlashCard.findById(id, {
        _id: 1,
        title: 1,
        description: 1,
        status: 1,
        thumbnail: 1,
        updatedAt: 1,
        instructions: 1,
        flashcardItems: 1,
        students: 1,
      })
        .populate("students", "firstname lastname email")
        .populate({
          path: "course",
          select: "title thumbnail status",
          match: { status: "ACTIVE" },
        });

      if (!flashcards) {
        return res.status(404).json({ error: "Flashcard not found" });
      }
      return res.status(200).json({
        status: true,
        message: "Flashcard fetched successfully",
        response: flashcards,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch flashcard",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async complete(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };
      const studentId = req['currentUser'].id;


      const completion = new FlashCardCompletion({
        student: studentId,
        flashcard: id,
        completedAt: new Date(),
      });

      await completion.save();
      recordStudentActivity(studentId, "flashcard_session", { flashcardId: id }).catch(() => {});

      res.status(200).json({
        success: true,
        message: "FlashCard completion recorded",
        completion,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Completion failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async progress(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };
      const { progress } = req.body;
      const studentId = req['currentUser'].id;


      const data = await FlashCardProgress.findOneAndUpdate(
        { student: studentId, flashcard: id },
        {
          $set: {
            student: studentId,
            progress: progress,
            flashcard: id,
            completedAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );
      recordStudentActivity(studentId, "flashcard_session", { flashcardId: id }).catch(() => {});
      res.status(200).json({
        success: true,
        message: "FlashCard progress recorded",
        progress: data,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Completion failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async leaderboard(req: Request, res: Response) {
    try {
      const { id } = req.params as { id: string };

      const leaderboard = await FlashCardCompletion.aggregate([
        {
          $match: { flashcard: new mongoose.Types.ObjectId(id) },
        },
        {
          $group: {
            _id: "$student",
            completionCount: { $sum: 1 },
            latestCompletion: { $max: "$completedAt" },
          },
        },
        {
          $sort: { completionCount: -1, latestCompletion: 1 },
        },
        {
          $limit: 50,
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "student",
          },
        },
        {
          $unwind: "$student",
        },
        {
          $project: {
            _id: 0,
            student: {
              _id: "$student._id",
              firstname: "$student.firstname",
              lastname: "$student.lastname",
              email: "$student.email",
              image: "$student.image",
            },
            completionCount: 1,
            latestCompletion: 1,
          },
        },
      ]);

      res.status(200).json({
        success: true,
        message: "Leaderboard fetched successfully",
        leaderboard,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch leaderboard",
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}
