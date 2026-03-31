import { Request, Response } from "express";
import mongoose from "mongoose";
import Course from "../schema/course.schema";
import Enrolled from "../schema/enroll.schema";
import Quiz from "../schema/quiz.schema";
import Lesson from "../../lesson/schema/lesson.schema";
import LessonProgress from "../../lesson/schema/lessonProgress.schema";

export class CourseV2Controller {
  static async singleV2(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const result = await Course.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(id as string) } },
        {
          $lookup: {
            from: "lessons",
            let: { courseId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $in: [
                      "$$courseId",
                      { $ifNull: ["$linkedCourses.course", []] },
                    ],
                  },
                },
              },
              { $match: { status: "ACTIVE" } },
            ],
            as: "lessons",
          },
        },
        {
          $lookup: {
            from: "categories",
            localField: "categoryId",
            foreignField: "_id",
            as: "categoryId",
          },
        },
        {
          $project: {
            _id: 1,
            title: 1,
            description: 1,
            thumbnail: 1,
            link: 1,
            price: 1,
            category: 1,
            categoryId: { $arrayElemAt: ["$categoryId", 0] },
            archived: 1,
            status: 1,
            author: 1,
            createdAt: 1,
            updatedAt: 1,
            lessons: 1,
          },
        },
      ]);

      if (!result.length) {
        return res.status(404).json({
          status: false,
          message: "Course not found",
        });
      }

      return res.status(200).json({
        status: true,
        message: "Course details success",
        response: result[0],
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
        error,
      });
    }
  }

  static async userCoursesV2(req: Request, res: Response) {
    try {
      // const { email } = req.params; 
      const { email } = req['currentUser'] as { email: string };
      const { id } = req['currentUser'] as { id: string };
      if (!email) {
        return res.status(400).json({ error: "Missing email parameter" });
      }

      const page = parseInt(req.query.page as string) > 0 ? parseInt(req.query.page as string) : 1;
      const limit =
        parseInt(req.query.limit as string) > 0 ? parseInt(req.query.limit as string) : 10000;
      const skip = (page - 1) * limit;

      const enrollments = await Enrolled.find({
        email,
        status: "ACTIVE",
      }).populate({
        path: "course",
        populate: [
          { path: "categoryId" },
          {
            path: "linkedCourses.course",
            populate: { path: "categoryId" },
          },
        ],
      });

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

      const combinedCourses = [...courses, ...linkedCourses];

      const uniqueCoursesMap = new Map();
      combinedCourses.forEach((course) => {
        uniqueCoursesMap.set(course._id.toString(), course);
      });
      const uniqueCourses = Array.from(uniqueCoursesMap.values());

      const total = uniqueCourses.length;
      const totalPages = Math.ceil(total / limit);
      const paginatedCourses = uniqueCourses.slice(skip, skip + limit);

      const pagedCourseIds = paginatedCourses.map((course) => course._id);

      let progressMap: Record<
        string,
        { completed: number; total: number; percentage: number }
      > = {};

      if (
        pagedCourseIds.length > 0 &&
        id &&
        mongoose.Types.ObjectId.isValid(id)
      ) {
        const lessons = await Lesson.find(
          {
            status: "ACTIVE",
            "linkedCourses.course": { $in: pagedCourseIds },
          },
          { linkedCourses: 1 }
        ).lean();

        const courseLessonMap: Record<string, Set<string>> = {};
        lessons.forEach((lesson: any) => {
          lesson.linkedCourses?.forEach((lc: any) => {
            const courseId = lc.course?.toString();
            if (courseId) {
              if (!courseLessonMap[courseId]) {
                courseLessonMap[courseId] = new Set();
              }
              courseLessonMap[courseId].add(lesson._id.toString());
            }
          });
        });

        const lessonIds = lessons.map((lesson: any) => lesson._id);
        const completedLessons = await LessonProgress.find(
          { student: id, lesson: { $in: lessonIds } },
          { lesson: 1 }
        ).lean();

        const completedSet = new Set(
          completedLessons.map((progress: any) => progress.lesson.toString())
        );

        progressMap = {};
        Object.keys(courseLessonMap).forEach((courseId) => {
          const lessonSet = courseLessonMap[courseId];
          let completedCount = 0;
          lessonSet.forEach((lessonId) => {
            if (completedSet.has(lessonId)) {
              completedCount += 1;
            }
          });

          const totalLessons = lessonSet.size;
          const percentage =
            totalLessons > 0
              ? Math.round((completedCount / totalLessons) * 100)
              : 0;

          progressMap[courseId] = {
            completed: completedCount,
            total: totalLessons,
            percentage,
          };
        });
      }

      return res.status(200).json({
        status: true,
        message: "Successfully retrieved enrolled courses",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        result: paginatedCourses.map((course: any) => {
          const courseId = course._id.toString();
          const baseCourse =
            typeof course.toObject === "function" ? course.toObject() : course;
          return {
            ...baseCourse,
            progress: progressMap[courseId] || {
              completed: 0,
              total: 0,
              percentage: 0,
            },
          };
        }),
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Failed to retrieve enrolled courses",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async userCoursesWithQuizzes(req: Request, res: Response) {
    try {
      // const { email } = req.params;     
      const { email } = req['currentUser'] as { email: string };
      const { id } = req['currentUser'] as { id: string };
      if (!email) {
        return res.status(400).json({ error: "Missing email parameter" });
      }

      const page = parseInt(req.query.page as string) > 0 ? parseInt(req.query.page as string) : 1;
      const limit =
        parseInt(req.query.limit as string) > 0 ? parseInt(req.query.limit as string) : 10000;
      const skip = (page - 1) * limit;

      const enrollments = await Enrolled.find({ email, status: "ACTIVE" }).populate({
        path: "course",
        populate: [
          { path: "categoryId" },
          {
            path: "linkedCourses.course",
            populate: { path: "categoryId" },
          },
        ],
      });

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

      const allCourseIds = uniqueCourses.map((course) => course._id);

      const quizzes = await Quiz.find(
        { course: { $in: allCourseIds }, status: "ACTIVE" },
        { course: 1 }
      );

      const quizCounts: Record<string, number> = {};
      quizzes.forEach((quiz) => {
        quiz.course.forEach((courseId) => {
          const courseIdStr = courseId.toString();
          quizCounts[courseIdStr] = (quizCounts[courseIdStr] || 0) + 1;
        });
      });

      const courseIdsWithQuizzes = new Set(Object.keys(quizCounts));

      const filteredCourses = uniqueCourses
        .filter((course) => courseIdsWithQuizzes.has(course._id.toString()))
        .map((course) => ({
          ...course.toObject(),
          totalQuiz: quizCounts[course._id.toString()] || 0,
        }));

      const total = filteredCourses.length;
      const totalPages = Math.ceil(total / limit);
      const paginatedCourses = filteredCourses.slice(skip, skip + limit);

      const courseIds = paginatedCourses.map((course) => course._id);

      let progressMap: Record<
        string,
        { completed: number; total: number; percentage: number }
      > = {};

      if (courseIds.length > 0 && id && mongoose.Types.ObjectId.isValid(id)) {
        const lessons = await Lesson.find(
          {
            status: "ACTIVE",
            "linkedCourses.course": { $in: courseIds },
          },
          { linkedCourses: 1 }
        ).lean();

        const courseLessonMap: Record<string, Set<string>> = {};
        lessons.forEach((lesson: any) => {
          lesson.linkedCourses?.forEach((lc: any) => {
            const courseId = lc.course?.toString();
            if (courseId) {
              if (!courseLessonMap[courseId]) {
                courseLessonMap[courseId] = new Set();
              }
              courseLessonMap[courseId].add(lesson._id.toString());
            }
          });
        });

        const lessonIds = lessons.map((lesson: any) => lesson._id);
        const completedLessons = await LessonProgress.find(
          { student: id, lesson: { $in: lessonIds } },
          { lesson: 1 }
        ).lean();

        const completedSet = new Set(
          completedLessons.map((progress: any) => progress.lesson.toString())
        );

        progressMap = {};
        Object.keys(courseLessonMap).forEach((courseId) => {
          const lessonSet = courseLessonMap[courseId];
          let completedCount = 0;
          lessonSet.forEach((lessonId) => {
            if (completedSet.has(lessonId)) {
              completedCount += 1;
            }
          });

          const totalLessons = lessonSet.size;
          const percentage =
            totalLessons > 0
              ? Math.round((completedCount / totalLessons) * 100)
              : 0;

          progressMap[courseId] = {
            completed: completedCount,
            total: totalLessons,
            percentage,
          };
        });
      }

      return res.status(200).json({
        status: true,
        message: "Successfully retrieved courses with quizzes",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        result: paginatedCourses.map((course: any) => {
          const courseId = course._id.toString();
          const baseCourse =
            typeof course.toObject === "function" ? course.toObject() : course;
          return {
            ...baseCourse,
            progress: progressMap[courseId] || {
              completed: 0,
              total: 0,
              percentage: 0,
            },
          };
        }),
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Failed to retrieve courses with quizzes",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async courseAllV2(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10000;
      const skip = (page - 1) * limit;
      const { categoryId, search } = req.query as {
        categoryId?: string;
        search?: string;
      };

      const filter: Record<string, unknown> = {};

      if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
        filter.categoryId = new mongoose.Types.ObjectId(categoryId);
      }

      filter.status = "ACTIVE";

      const matchStage = { $match: filter };
      const searchRegex = search ? new RegExp(search, "i") : null;

      const commonStages = [
        {
          $lookup: {
            from: "categories",
            localField: "categoryId",
            foreignField: "_id",
            as: "categoryId",
          },
        },
        {
          $unwind: {
            path: "$categoryId",
            preserveNullAndEmptyArrays: true,
          },
        },
        ...(searchRegex
          ? [
              {
                $match: {
                  $or: [
                    { title: { $regex: searchRegex } },
                    { description: { $regex: searchRegex } },
                    { "categoryId.name": { $regex: searchRegex } },
                  ],
                },
              },
            ]
          : []),
      ];

      const totalResult = await Course.aggregate([
        matchStage,
        ...commonStages,
        { $count: "total" },
      ]);

      const total = totalResult[0]?.total || 0;

      const result = await Course.aggregate([
        matchStage,
        ...commonStages,
        { $sort: { _id: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $lookup: {
            from: "enrolls",
            localField: "_id",
            foreignField: "course",
            as: "enrolls",
          },
        },
        {
          $lookup: {
            from: "lessons",
            let: { courseId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $in: [
                      "$$courseId",
                      { $ifNull: ["$linkedCourses.course", []] },
                    ],
                  },
                },
              },
            ],
            as: "lessons",
          },
        },
        {
          $project: {
            _id: 1,
            title: 1,
            description: 1,
            thumbnail: 1,
            link: 1,
            price: 1,
            category: 1,
            linkedCourses: 1,
            archived: 1,
            status: 1,
            author: 1,
            createdAt: 1,
            updatedAt: 1,
            categoryId: 1,
            lessons: { $size: "$lessons" },
            enrolls: {
              $filter: {
                input: "$enrolls",
                as: "enroll",
                cond: { $eq: ["$$enroll.status", "ACTIVE"] },
              },
            },
          },
        },
        {
          $addFields: {
            enroll: { $size: "$enrolls" },
          },
        },
        {
          $project: {
            enrolls: 0,
          },
        },
      ]);

      return res.status(200).json({
        status: true,
        message: "Active courses fetched successfully",
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
          hasNextPage: page * limit < total,
          hasPrevPage: page > 1,
        },
        response: result,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}
