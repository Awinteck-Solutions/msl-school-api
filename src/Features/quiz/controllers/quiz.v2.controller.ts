import { Request, Response } from "express";
import { default as mongoose } from "mongoose";
import Quiz from "../schema/quiz.schema";
import QuizResponse from "../schema/quizResponse.schema";
import { recordStudentActivity } from "../../gamification/service/gamification.service";

export class QuizV2Controller {
  static async all(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string)) || 1;
      const limit = Math.max(1, parseInt(req.query.limit as string)) || 10000;
      const search = (req.query.search as string | undefined)?.trim() || "";

      const filter: Record<string, any> = {};

      if (search) {
        filter.title = { $regex: search, $options: "i" };
        filter.description = { $regex: search, $options: "i" };
      }

      const skip = (page - 1) * limit;

      const [quizzes, total] = await Promise.all([
        Quiz.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
        Quiz.countDocuments(filter),
      ]);

      return res.status(200).json({
        status: true,
        message: "QUIZ success",
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page * limit < total,
          hasPrevPage: page > 1,
        },
        response: quizzes,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "QUIZ failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async byStudentV3(req: Request, res: Response) {
    const { id } = req['currentUser'] as { id: string };
    const page = Math.max(1, parseInt(req.query.page as string)) || 1;
    const limit = Math.max(1, parseInt(req.query.limit as string)) || 10000;
    const search = (req.query.search as string | undefined)?.trim() || "";
    const skip = (page - 1) * limit;

    try {
      const quizFilter: Record<string, any> = {
        students: id,
      };

      if (search) {
        quizFilter.title = { $regex: search, $options: "i" };
      }

      const [quizzes, total] = await Promise.all([
        Quiz.find(quizFilter, {
          _id: 1,
          title: 1,
          description: 1,
          status: 1,
          thumbnail: 1,
          updatedAt: 1,
        })
          .skip(skip)
          .limit(limit)
          .sort({ updatedAt: -1 })
          .lean(),
        Quiz.countDocuments(quizFilter),
      ]);

      const quizzesWithResponses = await Promise.all(
        quizzes.map(async (quiz) => {
          const latestResponse = await QuizResponse.findOne(
            {
              student: id,
              quiz_id: quiz._id,
            },
            {
              _id: 1,
              total_questions: 1,
              total_response: 1,
              total_corrects: 1,
              total_wrongs: 1,
              total_points: 1,
              createdAt: 1,
            }
          )
            .sort({ createdAt: -1 })
            .lean();

          return {
            quiz,
            latestResponse: latestResponse || null,
          };
        })
      );

      return res.status(200).json({
        status: true,
        message: "QUIZZES with latest responses fetched successfully",
        response: quizzesWithResponses,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page * limit < total,
          hasPrevPage: page > 1,
        },
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Error fetching quizzes with latest responses",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async quizResponseAdd(req: Request, res: Response) {
    const {
      student,
      quiz_id,
      quiz,
      total_questions,
      total_response,
      total_corrects,
      total_wrongs,
      total_points,
    } = req.body;
    if (!student && !quiz_id && !quiz) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }

    try {
      const result = await QuizResponse({
        student,
        quiz_id,
        quiz,
        total_questions,
        total_response,
        total_corrects,
        total_wrongs,
        total_points,
      }).save();

      const totalCorrect = typeof total_corrects === "number" ? total_corrects : parseInt(String(total_corrects), 10);
      const totalQuestions = typeof total_questions === "number" ? total_questions : parseInt(String(total_questions), 10);
      if (student) {
        recordStudentActivity(student, "quiz_complete", {
          quizId: quiz_id,
          totalCorrect: isNaN(totalCorrect) ? undefined : totalCorrect,
          totalQuestions: isNaN(totalQuestions) ? undefined : totalQuestions,
        }).catch(() => {});
      }

      return res.status(201).json({
        status: true,
        message: "QUIZ response saved success",
        response: result,
      });
    } catch (error) {
      return res.status(404).json({
        status: false,
        message: "QUIZ response failed",
        other: error,
      });
    }
  }

  static async quizResponseUpdate(req: Request, res: Response) {
    const {
      id,
      student,
      quiz_id,
      quiz,
      total_questions,
      total_response,
      total_corrects,
      total_wrongs,
      total_points,
    } = req.body;
    if (!id && !student && !quiz_id) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }

    QuizResponse.updateOne(
      { _id: id },
      {
        quiz_id,
        quiz,
        total_questions,
        total_response,
        total_corrects,
        total_wrongs,
        total_points,
      }
    )
      .then((result) => {
        if (result.matchedCount === 0) {
          return res.status(404).json({
            status: false,
            message: "Student response not found",
          });
        }
        return res.status(201).json({
          status: true,
          message: "Student response update success",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Student response  update failed",
          other: error,
        });
      });
  }

  static async quizResponseLeaderboard(req: Request, res: Response) {
    const { quiz_id } = req.params;
    let { page = 1, limit = 20 } = req.query as {
      page?: number | string;
      limit?: number | string;
    };

    page = parseInt(page as string);
    limit = parseInt(limit as string);

    if (page < 1) page = 1;
    if (limit < 1 || limit > 100) limit = 20;

    const skip = (page - 1) * limit;

    QuizResponse.countDocuments({ quiz_id })
      .then((totalCount) => {
        const totalPages = Math.ceil(totalCount / limit);

        return QuizResponse.find(
          { quiz_id },
          { _id: 0, student: 1, total_points: 1 }
        )
          .populate("student", "_id firstname lastname email image")
          .then((results) => {
            const sortedResults = results.sort((a: any, b: any) => {
              const pointsA = parseFloat(a.total_points) || 0;
              const pointsB = parseFloat(b.total_points) || 0;
              return pointsB - pointsA;
            });

            const paginatedResults = sortedResults.slice(skip, skip + limit);
            return paginatedResults;
          })
          .then((result) => {
            return res.status(200).json({
              status: true,
              message: "QUIZ Leaderboard success",
              pagination: {
                page,
                limit,
                total: totalCount,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
              },
              response: result,
            });
          });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "QUIZ Leaderboard failed",
          other: error,
        });
      });
  }

  static async quizResponseByQuizId(req: Request, res: Response) {
    const { quiz_id } = req.params;
    const { id } = req['currentUser'] as { id: string };
    try {
      QuizResponse.findOne({ quiz_id, student: id })
        .then((result) => {
          return res.status(201).json({
            status: true,
            message: "Student response success",
            response: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Student response failed",
            other: error,
          });
        });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Something went wrong",
        other: error,
      });
    }
  }

  static async byCourseStudent(req: Request, res: Response) {
    const { courseId } = req.params as { courseId: string };
    const { id } = req['currentUser'] as { id: string };
    const { page = 1, limit = 100, search = "" } = req.query as {
      page?: string | number;
      limit?: string | number;
      search?: string;
    };

    try {
      const query: Record<string, any> = {
        course: courseId,
        title: { $regex: search, $options: "i" },
        description: { $regex: search, $options: "i" },
      };

      const quizzes = await Quiz.find(query, {
        _id: 1,
        title: 1,
        description: 1,
        status: 1,
        thumbnail: 1,
        updatedAt: 1,
      })
        .skip((parseInt(page as string) - 1) * parseInt(limit as string))
        .limit(parseInt(limit as string))
        .lean();

      const quizzesWithResponses = await Promise.all(
        quizzes.map(async (quiz) => {
          const latestResponse = await QuizResponse.findOne(
            {
              student: id,
              quiz_id: quiz._id,
            },
            {
              _id: 1,
              total_questions: 1,
              total_response: 1,
              total_corrects: 1,
              total_wrongs: 1,
              total_points: 1,
              createdAt: 1,
            }
          )
            .sort({ createdAt: -1 })
            .lean();

          return {
            quiz,
            latestResponse: latestResponse || null,
          };
        })
      );

      const total = await Quiz.countDocuments(query);

      return res.status(200).json({
        status: true,
        message: "Quizzes with latest responses fetched successfully",
        response: quizzesWithResponses,
        pagination: {
          total,
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          totalPages: Math.ceil(total / parseInt(limit as string)),
        },
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Error fetching quizzes with latest responses",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async single(req: Request, res: Response) {
    const { id } = req.params;
    console.log('id', id)

    if (!id || !mongoose.Types.ObjectId.isValid(id as string)) {
      return res.status(400).json({ error: "Invalid or missing quiz ID" });
    }

    try {
      const quiz = await Quiz.findById(id, {
        _id: 1,
        title: 1,
        description: 1,
        status: 1,
        thumbnail: 1,
        updatedAt: 1,
        instructions: 1,
        quiz: 1,
        students: 1,
      })
        // .populate("students")
        .populate({
          path: "course",
          select: "title thumbnail status",
          match: { status: "ACTIVE" },
        });

      if (!quiz) {
        return res.status(404).json({ error: "Quiz not found" });
      }
      return res.status(200).json({
        status: true,
        message: "Quiz fetched successfully",
        response: quiz,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch quiz",
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}
