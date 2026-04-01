import { Request, Response } from "express";
import mongoose from "mongoose";
import Course from "../schema/course.schema";
import Enrolled from "../schema/enroll.schema";
import Quiz from "../schema/quiz.schema";
import Lesson from "../../lesson/schema/lesson.schema";
import LessonProgress from "../../lesson/schema/lessonProgress.schema";

type CourseLessonProgress = {
  completed: number;
  total: number;
  percentage: number;
};

type LessonWithCompletionStatus = Record<string, unknown> & {
  completedStatus: boolean;
};

export class CourseV2Controller {
  /**
   * Active lessons linked to the given courses, ordered by link position then lesson position.
   * Each item includes `completedStatus` for the student (false if student id missing/invalid).
   */
  private static async computeLessonsWithCompletionByCourse(
    courseIds: string[],
    studentId: string | undefined
  ): Promise<Record<string, LessonWithCompletionStatus[]>> {
    const lessonsByCourse: Record<string, LessonWithCompletionStatus[]> = {};
    const courseIdSet = new Set(courseIds);
    courseIds.forEach((cid) => {
      lessonsByCourse[cid] = [];
    });

    if (!courseIds.length) {
      return lessonsByCourse;
    }

    const validObjectIds = courseIds
      .filter((cid) => mongoose.Types.ObjectId.isValid(cid))
      .map((cid) => new mongoose.Types.ObjectId(cid));

    if (!validObjectIds.length) {
      return lessonsByCourse;
    }

    const lessons = await Lesson.find({
      status: "ACTIVE",
      "linkedCourses.course": { $in: validObjectIds },
    }).lean();

    const lessonIds = lessons.map((l) => l._id);
    const studentOk =
      !!studentId && mongoose.Types.ObjectId.isValid(studentId);

    const completedLessons =
      studentOk && lessonIds.length
        ? await LessonProgress.find(
            { student: studentId, lesson: { $in: lessonIds } },
            { lesson: 1 }
          ).lean()
        : [];

    const completedSet = new Set(
      completedLessons.map((p: { lesson: { toString: () => string } }) =>
        p.lesson.toString()
      )
    );

    const pushedPerCourse: Record<string, Set<string>> = {};
    courseIds.forEach((cid) => {
      pushedPerCourse[cid] = new Set();
    });

    type LeanLesson = (typeof lessons)[number];
    const rows: Record<
      string,
      (LessonWithCompletionStatus & { _sortPos: number })[]
    > = {};
    courseIds.forEach((cid) => {
      rows[cid] = [];
    });

    lessons.forEach((lesson: LeanLesson) => {
      const lessonIdStr = lesson._id.toString();
      const completedStatus = completedSet.has(lessonIdStr);

      lesson.linkedCourses?.forEach(
        (lc: { course?: unknown; position?: number }) => {
          const courseId = lc.course?.toString();
          if (!courseId || !courseIdSet.has(courseId)) {
            return;
          }
          if (pushedPerCourse[courseId].has(lessonIdStr)) {
            return;
          }
          pushedPerCourse[courseId].add(lessonIdStr);

          rows[courseId].push({
            ...lesson,
            completedStatus,
            _sortPos: lc.position ?? 0,
          } as LessonWithCompletionStatus & { _sortPos: number });
        }
      );
    });

    for (const cid of courseIds) {
      const arr = rows[cid];
      arr.sort((a, b) => {
        if (a._sortPos !== b._sortPos) {
          return a._sortPos - b._sortPos;
        }
        const ap = typeof a.position === "number" ? a.position : 0;
        const bp = typeof b.position === "number" ? b.position : 0;
        return ap - bp;
      });
      lessonsByCourse[cid] = arr.map(
        ({ _sortPos, ...rest }) => rest as LessonWithCompletionStatus
      );
    }

    return lessonsByCourse;
  }

  private static progressFromLessonsWithCompletion(
    lessons: LessonWithCompletionStatus[]
  ): CourseLessonProgress {
    const total = lessons.length;
    const completed = lessons.filter((l) => l.completedStatus).length;
    return {
      completed,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }

  static async singleV2(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const result = await Course.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(id as string) } },
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
          },
        },
      ]);

      if (!result.length) {
        return res.status(404).json({
          status: false,
          message: "Course not found",
        });
      }

      const course = result[0] as { _id: mongoose.Types.ObjectId };
      const studentId = (req["currentUser"] as { id?: string } | undefined)?.id;
      const courseIdStr = course._id.toString();

      const lessonsByCourse =
        await CourseV2Controller.computeLessonsWithCompletionByCourse(
          [courseIdStr],
          studentId
        );
      const lessonsList = lessonsByCourse[courseIdStr] ?? [];
      const progress =
        CourseV2Controller.progressFromLessonsWithCompletion(lessonsList);

      return res.status(200).json({
        status: true,
        message: "Course details success",
        response: {
          ...course,
          lessons: lessonsList,
          progress,
        },
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
      const pagedCourseIdStrings = pagedCourseIds.map((c) => c._id.toString());

      const lessonsByCourse =
        pagedCourseIdStrings.length > 0
          ? await CourseV2Controller.computeLessonsWithCompletionByCourse(
              pagedCourseIdStrings,
              id
            )
          : ({} as Record<string, LessonWithCompletionStatus[]>);

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
          const lessonsList = lessonsByCourse[courseId] ?? [];
          return {
            ...baseCourse,
            progress:
              CourseV2Controller.progressFromLessonsWithCompletion(lessonsList),
            lessons: lessonsList,
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
