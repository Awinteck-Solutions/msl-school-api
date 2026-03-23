import { Request, Response } from "express";
import User from "../../user/schema/user.schema";
import Enroll from "../../course/schema/enroll.schema";
import QuizResponse from "../../quiz/schema/quizResponse.schema";
import FlashCardCompletion from "../../flashcard/schema/flashcardLeaderboard.schema";
import { Roles } from "../../../enums/roles.enum";
import { Status } from "../../../enums/status.enum";

type Granularity = "daily" | "weekly" | "monthly";

const parseDate = (value?: string): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const buildDateMatch = (from?: Date, to?: Date) => {
  const createdAt: Record<string, Date> = {};
  if (from) createdAt.$gte = from;
  if (to) createdAt.$lte = to;
  return Object.keys(createdAt).length > 0 ? { createdAt } : {};
};

const buildDateFieldMatch = (
  field: string,
  from?: Date,
  to?: Date
): Record<string, Record<string, Date>> | Record<string, never> => {
  const range: Record<string, Date> = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return Object.keys(range).length > 0 ? { [field]: range } : {};
};

const buildPeriodExpression = (granularity: Granularity) => {
  if (granularity === "monthly") {
    return { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
  }
  if (granularity === "weekly") {
    return {
      $concat: [
        { $toString: { $isoWeekYear: "$createdAt" } },
        "-W",
        {
          $cond: [
            { $lt: [{ $isoWeek: "$createdAt" }, 10] },
            { $concat: ["0", { $toString: { $isoWeek: "$createdAt" } }] },
            { $toString: { $isoWeek: "$createdAt" } },
          ],
        },
      ],
    };
  }
  return { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
};

const normalizeGranularity = (value?: string): Granularity => {
  if (value === "weekly" || value === "monthly") return value;
  return "daily";
};

const getAnalyticsFilters = (req: Request) => {
  const granularity = normalizeGranularity(
    (req.query.granularity as string) || "daily"
  );
  const from = parseDate(req.query.from as string | undefined);
  const to = parseDate(req.query.to as string | undefined);
  const topLimit = Math.max(
    1,
    parseInt((req.query.topLimit as string) || "10", 10)
  );
  const courseStatus = (req.query.courseStatus as string | undefined) || "";
  const quizStatus = (req.query.quizStatus as string | undefined) || "";
  const flashcardStatus =
    (req.query.flashcardStatus as string | undefined) || "";

  return {
    granularity,
    from,
    to,
    topLimit,
    courseStatus,
    quizStatus,
    flashcardStatus,
  };
};

export class AdminAnalyticsV2Controller {
  static async dashboard(req: Request, res: Response) {
    try {
      const { granularity, from, to, topLimit, courseStatus } =
        getAnalyticsFilters(req);

      const dateMatch = buildDateMatch(from, to);
      const periodExpr = buildPeriodExpression(granularity);

      const [
        totalStudents,
        activeStudents,
        inactiveStudents,
        totalEnrollments,
        activeEnrollments,
        inactiveEnrollments,
        studentTrendAgg,
        enrollmentTrendAgg,
        topCoursesAgg,
        enrolledUsersAgg,
      ] = await Promise.all([
        User.countDocuments({ role: Roles.USER }),
        User.countDocuments({ role: Roles.USER, status: Status.ACTIVE }),
        User.countDocuments({ role: Roles.USER, status: Status.INACTIVE }),
        Enroll.countDocuments({}),
        Enroll.countDocuments({ status: "ACTIVE" }),
        Enroll.countDocuments({ status: { $ne: "ACTIVE" } }),
        User.aggregate([
          { $match: { role: Roles.USER, ...dateMatch } },
          {
            $group: {
              _id: { period: periodExpr, status: "$status" },
              count: { $sum: 1 },
            },
          },
          { $sort: { "_id.period": 1 } },
        ]),
        Enroll.aggregate([
          { $match: { ...dateMatch } },
          {
            $group: {
              _id: { period: periodExpr, status: "$status" },
              count: { $sum: 1 },
            },
          },
          { $sort: { "_id.period": 1 } },
        ]),
        Enroll.aggregate([
          { $match: { status: "ACTIVE" } },
          { $group: { _id: "$course", enrollments: { $sum: 1 } } },
          { $sort: { enrollments: -1 } },
          { $limit: topLimit },
          {
            $lookup: {
              from: "courses",
              localField: "_id",
              foreignField: "_id",
              as: "course",
            },
          },
          { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
          ...(courseStatus
            ? [{ $match: { "course.status": courseStatus } }]
            : []),
          {
            $project: {
              _id: 0,
              courseId: "$_id",
              enrollments: 1,
              title: "$course.title",
              status: "$course.status",
              archived: "$course.archived",
              categoryId: "$course.categoryId",
            },
          },
        ]),
        Enroll.aggregate([
          { $match: { status: "ACTIVE" } },
          { $group: { _id: "$email" } },
          { $count: "total" },
        ]),
      ]);

      const studentTrendMap: Record<
        string,
        { period: string; total: number; active: number; inactive: number; other: number }
      > = {};
      const studentPeriods: string[] = [];

      studentTrendAgg.forEach((item: any) => {
        const period = item?._id?.period as string;
        const status = item?._id?.status as string;
        if (!period) return;
        if (!studentTrendMap[period]) {
          studentTrendMap[period] = {
            period,
            total: 0,
            active: 0,
            inactive: 0,
            other: 0,
          };
          studentPeriods.push(period);
        }
        const entry = studentTrendMap[period];
        entry.total += item.count || 0;
        if (status === Status.ACTIVE) entry.active += item.count || 0;
        else if (status === Status.INACTIVE) entry.inactive += item.count || 0;
        else entry.other += item.count || 0;
      });

      const enrollmentTrendMap: Record<
        string,
        { period: string; total: number; active: number; inactive: number }
      > = {};
      const enrollmentPeriods: string[] = [];

      enrollmentTrendAgg.forEach((item: any) => {
        const period = item?._id?.period as string;
        const status = item?._id?.status as string;
        if (!period) return;
        if (!enrollmentTrendMap[period]) {
          enrollmentTrendMap[period] = {
            period,
            total: 0,
            active: 0,
            inactive: 0,
          };
          enrollmentPeriods.push(period);
        }
        const entry = enrollmentTrendMap[period];
        entry.total += item.count || 0;
        if (status === "ACTIVE") entry.active += item.count || 0;
        else entry.inactive += item.count || 0;
      });

      const enrolledUsers = enrolledUsersAgg[0]?.total || 0;
      const conversionRate =
        activeStudents > 0
          ? Math.round((enrolledUsers / activeStudents) * 10000) / 100
          : 0;

      return res.status(200).json({
        status: true,
        message: "Analytics dashboard fetched successfully",
        filters: {
          granularity,
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
          topLimit,
          courseStatus: courseStatus || null,
        },
        response: {
          students: {
            totals: {
              total: totalStudents,
              active: activeStudents,
              inactive: inactiveStudents,
            },
            trend: studentPeriods.map((period) => studentTrendMap[period]),
          },
          enrollments: {
            totals: {
              total: totalEnrollments,
              active: activeEnrollments,
              inactive: inactiveEnrollments,
            },
            trend: enrollmentPeriods.map((period) => enrollmentTrendMap[period]),
            topCourses: topCoursesAgg,
          },
          conversions: {
            activeStudents,
            enrolledStudents: enrolledUsers,
            ratePercent: conversionRate,
          },
        },
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Analytics dashboard failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async students(req: Request, res: Response) {
    try {
      const { granularity, from, to } = getAnalyticsFilters(req);
      const dateMatch = buildDateMatch(from, to);
      const periodExpr = buildPeriodExpression(granularity);

      const [totalStudents, activeStudents, inactiveStudents, studentTrendAgg] =
        await Promise.all([
          User.countDocuments({ role: Roles.USER }),
          User.countDocuments({ role: Roles.USER, status: Status.ACTIVE }),
          User.countDocuments({ role: Roles.USER, status: Status.INACTIVE }),
          User.aggregate([
            { $match: { role: Roles.USER, ...dateMatch } },
            {
              $group: {
                _id: { period: periodExpr, status: "$status" },
                count: { $sum: 1 },
              },
            },
            { $sort: { "_id.period": 1 } },
          ]),
        ]);

      const studentTrendMap: Record<
        string,
        { period: string; total: number; active: number; inactive: number; other: number }
      > = {};
      const studentPeriods: string[] = [];

      studentTrendAgg.forEach((item: any) => {
        const period = item?._id?.period as string;
        const status = item?._id?.status as string;
        if (!period) return;
        if (!studentTrendMap[period]) {
          studentTrendMap[period] = {
            period,
            total: 0,
            active: 0,
            inactive: 0,
            other: 0,
          };
          studentPeriods.push(period);
        }
        const entry = studentTrendMap[period];
        entry.total += item.count || 0;
        if (status === Status.ACTIVE) entry.active += item.count || 0;
        else if (status === Status.INACTIVE) entry.inactive += item.count || 0;
        else entry.other += item.count || 0;
      });

      return res.status(200).json({
        status: true,
        message: "Analytics students fetched successfully",
        filters: {
          granularity,
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
        },
        response: {
          totals: {
            total: totalStudents,
            active: activeStudents,
            inactive: inactiveStudents,
          },
          trend: studentPeriods.map((period) => studentTrendMap[period]),
        },
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Analytics students failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async enrollments(req: Request, res: Response) {
    try {
      const { granularity, from, to, topLimit, courseStatus } =
        getAnalyticsFilters(req);
      const dateMatch = buildDateMatch(from, to);
      const periodExpr = buildPeriodExpression(granularity);

      const [
        totalEnrollments,
        activeEnrollments,
        inactiveEnrollments,
        enrollmentTrendAgg,
        topCoursesAgg,
      ] = await Promise.all([
        Enroll.countDocuments({}),
        Enroll.countDocuments({ status: "ACTIVE" }),
        Enroll.countDocuments({ status: { $ne: "ACTIVE" } }),
        Enroll.aggregate([
          { $match: { ...dateMatch } },
          {
            $group: {
              _id: { period: periodExpr, status: "$status" },
              count: { $sum: 1 },
            },
          },
          { $sort: { "_id.period": 1 } },
        ]),
        Enroll.aggregate([
          { $match: { status: "ACTIVE" } },
          { $group: { _id: "$course", enrollments: { $sum: 1 } } },
          { $sort: { enrollments: -1 } },
          { $limit: topLimit },
          {
            $lookup: {
              from: "courses",
              localField: "_id",
              foreignField: "_id",
              as: "course",
            },
          },
          { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
          ...(courseStatus
            ? [{ $match: { "course.status": courseStatus } }]
            : []),
          {
            $project: {
              _id: 0,
              courseId: "$_id",
              enrollments: 1,
              title: "$course.title",
              status: "$course.status",
              archived: "$course.archived",
              categoryId: "$course.categoryId",
            },
          },
        ]),
      ]);

      const enrollmentTrendMap: Record<
        string,
        { period: string; total: number; active: number; inactive: number }
      > = {};
      const enrollmentPeriods: string[] = [];

      enrollmentTrendAgg.forEach((item: any) => {
        const period = item?._id?.period as string;
        const status = item?._id?.status as string;
        if (!period) return;
        if (!enrollmentTrendMap[period]) {
          enrollmentTrendMap[period] = {
            period,
            total: 0,
            active: 0,
            inactive: 0,
          };
          enrollmentPeriods.push(period);
        }
        const entry = enrollmentTrendMap[period];
        entry.total += item.count || 0;
        if (status === "ACTIVE") entry.active += item.count || 0;
        else entry.inactive += item.count || 0;
      });

      return res.status(200).json({
        status: true,
        message: "Analytics enrollments fetched successfully",
        filters: {
          granularity,
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
          topLimit,
          courseStatus: courseStatus || null,
        },
        response: {
          totals: {
            total: totalEnrollments,
            active: activeEnrollments,
            inactive: inactiveEnrollments,
          },
          trend: enrollmentPeriods.map((period) => enrollmentTrendMap[period]),
          topCourses: topCoursesAgg,
        },
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Analytics enrollments failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async conversions(req: Request, res: Response) {
    try {
      const [activeStudents, enrolledUsersAgg] = await Promise.all([
        User.countDocuments({ role: Roles.USER, status: Status.ACTIVE }),
        Enroll.aggregate([
          { $match: { status: "ACTIVE" } },
          { $group: { _id: "$email" } },
          { $count: "total" },
        ]),
      ]);

      const enrolledUsers = enrolledUsersAgg[0]?.total || 0;
      const conversionRate =
        activeStudents > 0
          ? Math.round((enrolledUsers / activeStudents) * 10000) / 100
          : 0;

      return res.status(200).json({
        status: true,
        message: "Analytics conversions fetched successfully",
        response: {
          activeStudents,
          enrolledStudents: enrolledUsers,
          ratePercent: conversionRate,
        },
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Analytics conversions failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async uniqueActiveCourseStudents(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;
      const { from, to, courseStatus } = getAnalyticsFilters(req);
      const dateMatch = buildDateMatch(from, to);

      const uniqueAgg = await Enroll.aggregate([
        { $match: { status: "ACTIVE", ...dateMatch } },
        {
          $lookup: {
            from: "courses",
            localField: "course",
            foreignField: "_id",
            as: "course",
          },
        },
        { $unwind: "$course" },
        {
          $match: {
            "course.status": courseStatus || "ACTIVE",
            "course.archived": false,
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "email",
            foreignField: "email",
            as: "user",
          },
        },
        { $unwind: "$user" },
        { $match: { "user.role": Roles.USER } },
        {
          $group: {
            _id: "$user._id",
            user: { $first: "$user" },
            courses: {
              $addToSet: {
                courseId: "$course._id",
                title: "$course.title",
                image: "$course.thumbnail",
                status: "$course.status",
                archived: "$course.archived",
                categoryId: "$course.categoryId",
              },
            },
          },
        },
        {
          $replaceRoot: {
            newRoot: { $mergeObjects: ["$user", { courses: "$courses" }] },
          },
        },
        {
          $facet: {
            students: [
              { $sort: { createdAt: -1 } },
              { $skip: skip },
              { $limit: limit },
              {
                $project: {
                  _id: 1,
                  firstname: 1,
                  lastname: 1,
                  email: 1,
                  image: 1,
                  status: 1,
                  courses: 1,
                },
              },
            ],
            total: [{ $count: "total" }],
          },
        },
      ]);

      const total = uniqueAgg[0]?.total?.[0]?.total || 0;
      const students = uniqueAgg[0]?.students || [];
      const totalPages = Math.ceil(total / limit);

      return res.status(200).json({
        status: true,
        message: "Analytics unique active course students fetched successfully",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        filters: {
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
          courseStatus: courseStatus || null,
        },
        response: {
          students,
        },
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Analytics unique active course students failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async topCourses(req: Request, res: Response) {
    try {
      const { from, to, topLimit, courseStatus } = getAnalyticsFilters(req);
      const dateMatch = buildDateMatch(from, to);

      const topCoursesAgg = await Enroll.aggregate([
        { $match: { status: "ACTIVE", ...dateMatch } },
        { $group: { _id: "$course", enrollments: { $sum: 1 } } },
        { $sort: { enrollments: -1 } },
        { $limit: topLimit },
        {
          $lookup: {
            from: "courses",
            localField: "_id",
            foreignField: "_id",
            as: "course",
          },
        },
        { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
        ...(courseStatus
          ? [{ $match: { "course.status": courseStatus } }]
          : []),
        {
          $project: {
            _id: 0,
            courseId: "$_id",
            enrollments: 1,
            title: "$course.title",
            status: "$course.status",
            archived: "$course.archived",
            categoryId: "$course.categoryId",
          },
        },
      ]);

      return res.status(200).json({
        status: true,
        message: "Analytics top courses fetched successfully",
        filters: {
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
          topLimit,
          courseStatus: courseStatus || null,
        },
        response: topCoursesAgg,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Analytics top courses failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async topQuizzes(req: Request, res: Response) {
    try {
      const { from, to, topLimit, quizStatus } = getAnalyticsFilters(req);
      const dateMatch = buildDateMatch(from, to);

      const topQuizzesAgg = await QuizResponse.aggregate([
        { $match: { quiz_id: { $ne: null }, ...dateMatch } },
        { $group: { _id: "$quiz_id", responses: { $sum: 1 } } },
        { $sort: { responses: -1 } },
        { $limit: topLimit },
        {
          $lookup: {
            from: "quizzes",
            localField: "_id",
            foreignField: "_id",
            as: "quiz",
          },
        },
        { $unwind: { path: "$quiz", preserveNullAndEmptyArrays: true } },
        ...(quizStatus ? [{ $match: { "quiz.status": quizStatus } }] : []),
        {
          $project: {
            _id: 0,
            quizId: "$_id",
            responses: 1,
            title: "$quiz.title",
            status: "$quiz.status",
            course: "$quiz.course",
          },
        },
      ]);

      return res.status(200).json({
        status: true,
        message: "Analytics top quizzes fetched successfully",
        filters: {
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
          topLimit,
          quizStatus: quizStatus || null,
        },
        response: topQuizzesAgg,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Analytics top quizzes failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async topFlashcards(req: Request, res: Response) {
    try {
      const { from, to, topLimit, flashcardStatus } = getAnalyticsFilters(req);
      const dateMatch = buildDateFieldMatch("completedAt", from, to);

      const topFlashcardsAgg = await FlashCardCompletion.aggregate([
        { $match: { flashcard: { $ne: null }, ...dateMatch } },
        { $group: { _id: "$flashcard", completions: { $sum: 1 } } },
        { $sort: { completions: -1 } },
        { $limit: topLimit },
        {
          $lookup: {
            from: "flashcards",
            localField: "_id",
            foreignField: "_id",
            as: "flashcard",
          },
        },
        { $unwind: { path: "$flashcard", preserveNullAndEmptyArrays: true } },
        ...(flashcardStatus
          ? [{ $match: { "flashcard.status": flashcardStatus } }]
          : []),
        {
          $project: {
            _id: 0,
            flashcardId: "$_id",
            completions: 1,
            title: "$flashcard.title",
            status: "$flashcard.status",
            course: "$flashcard.course",
          },
        },
      ]);

      return res.status(200).json({
        status: true,
        message: "Analytics top flashcards fetched successfully",
        filters: {
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
          topLimit,
          flashcardStatus: flashcardStatus || null,
        },
        response: topFlashcardsAgg,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Analytics top flashcards failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async topStudents(req: Request, res: Response) {
    try {
      const { from, to, topLimit } = getAnalyticsFilters(req);
      const metric =
        ((req.query.metric as string) || "enrollments").toLowerCase();
      const enrollDateMatch = buildDateMatch(from, to);
      const quizDateMatch = buildDateMatch(from, to);
      const completionDateMatch = buildDateFieldMatch("completedAt", from, to);
      const logDateMatch = buildDateMatch(from, to);

      const pipeline: any[] = [{ $match: { role: Roles.USER } }];
      let metricKey = "enrollments";

      if (metric === "quiz" || metric === "quizanswers") {
        metricKey = "quizAnswers";
        pipeline.push(
          {
            $lookup: {
              from: "quizresponses",
              let: { studentId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$student", "$$studentId"] },
                    ...quizDateMatch,
                  },
                },
              ],
              as: "quizResponses",
            },
          },
          { $addFields: { quizAnswers: { $size: "$quizResponses" } } }
        );
      } else if (metric === "flashcards" || metric === "flashcardcompletions") {
        metricKey = "flashcardCompletions";
        pipeline.push(
          {
            $lookup: {
              from: "flashcardcompletes",
              let: { studentId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$student", "$$studentId"] },
                    ...completionDateMatch,
                  },
                },
              ],
              as: "flashcardCompletions",
            },
          },
          {
            $addFields: {
              flashcardCompletions: { $size: "$flashcardCompletions" },
            },
          }
        );
      } else if (metric === "appusage" || metric === "logs") {
        metricKey = "appUsage";
        pipeline.push(
          {
            $lookup: {
              from: "requestlogs",
              let: { userId: { $toString: "$_id" } },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$userId", "$$userId"] },
                    ...logDateMatch,
                  },
                },
              ],
              as: "appUsages",
            },
          },
          { $addFields: { appUsage: { $size: "$appUsages" } } }
        );
      } else {
        metricKey = "enrollments";
        pipeline.push(
          {
            $lookup: {
              from: "enrolls",
              let: { email: "$email" },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$email", "$$email"] },
                    status: "ACTIVE",
                    ...enrollDateMatch,
                  },
                },
              ],
              as: "enrolls",
            },
          },
          { $addFields: { enrollments: { $size: "$enrolls" } } }
        );
      }

      pipeline.push(
        { $sort: { [metricKey]: -1 } },
        { $limit: topLimit },
        {
          $project: {
            _id: 1,
            firstname: 1,
            lastname: 1,
            email: 1,
            image: 1,
            status: 1,
            [metricKey]: 1,
          },
        }
      );

      const topStudentsAgg = await User.aggregate(pipeline);

      return res.status(200).json({
        status: true,
        message: "Analytics top students fetched successfully",
        filters: {
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
          topLimit,
          metric: metricKey,
        },
        response: topStudentsAgg,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Analytics top students failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}
