import { Request, Response } from "express";
import { default as mongoose } from "mongoose";
import Quiz from "../schema/quiz.schema";
import QuizResponse from "../schema/quizResponse.schema";
import { uploadFile } from "../../../helpers/s3";
import multer from "multer";

interface MulterRequest extends Request {
  file?: multer.File;
  files?: multer.File[];
}

export class AdminQuizV2Controller {
  static async updateThumbnail(req: MulterRequest, res: Response) {
    const { id } = req.body;
    const file = req.file as { buffer: Buffer; originalname: string } | undefined;

    if (!file || !id) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    try {
      const result = await uploadFile(file, "quiz");
      if (result) {
        const thumbnail = `${result.key}`;
        Quiz.findOneAndUpdate({ _id: id }, { thumbnail }, { upsert: true })
          .then((updated) => {
            return res.status(201).json({
              status: true,
              message: "Quiz image update",
              response: updated,
            });
          })
          .catch((error) => {
            return res.status(404).json({
              status: false,
              message: "Quiz image updating failed",
              other: error,
            });
          });
      }
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
      });
    }
  }

  static async adminAll(req: Request, res: Response) {
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

  static async single(req: Request, res: Response) {
    const { id } = req.params;
    Quiz.findOne({ _id: id })
      .populate("students")
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "QUIZ success",
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "QUIZ failed",
          other: error,
        });
      });
  }

  static async byCourse(req: Request, res: Response) {
    try {
      const { course } = req.params;
      const page = Math.max(1, parseInt(req.query.page as string)) || 1;
      const limit = Math.max(1, parseInt(req.query.limit as string)) || 10000;
      const search = (req.query.search as string | undefined)?.trim() || "";
      const skip = (page - 1) * limit;

      const filter: Record<string, any> = {
        course: course,
      };

      if (search) {
        filter.title = { $regex: search, $options: "i" };
      }

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

  static async toggle(req: Request, res: Response) {
    const { id } = req.params;
    const { status } = req.body;
    if (!id || !status) {
      return res.status(401).json({
        status: false,
        message: "Missing fields",
      });
    }
    Quiz.updateOne({ _id: id }, { status }, { upsert: false })
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "Quiz update success",
        });
      })
      .catch(() => {
        return res.status(404).json({
          status: false,
          message: "Quiz update failed",
        });
      });
  }

  static async updateInfo(req: Request, res: Response) {
    const { id, title, description } = req.body;
    if (!id || !title) {
      return res.status(401).json({
        status: false,
        message: "Missing fields",
      });
    }
    Quiz.updateOne({ _id: id }, { title, description }, { upsert: false })
      .then((result) => {
        if (result.matchedCount === 0) {
          return res.status(404).json({
            status: false,
            message: "Quiz not found",
          });
        }
        return res.status(201).json({
          status: true,
          message: "Quiz info update success",
        });
      })
      .catch(() => {
        return res.status(404).json({
          status: false,
          message: "Quiz info update failed",
        });
      });
  }

  static async delete(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      return res.status(401).json({
        status: false,
        message: "Missing field",
      });
    }
    Quiz.deleteOne({ _id: id })
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "Quiz delete success",
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Quiz delete failed",
          other: error,
        });
      });
  }

  static async add(req: Request, res: Response) {
    const { course, title } = req.body;
    if (!title && !course) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }

    Quiz({ ...req.body })
      .save()
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "QUIZ saved success",
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "QUIZ failed",
          other: error,
        });
      });
  }

  static async update(req: Request, res: Response) {
    const { id, course, title } = req.body;
    if (!id && !title && !course) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }

    Quiz.updateOne({ _id: id }, { ...req.body })
      .then((result) => {
        if (result.matchedCount === 0) {
          return res.status(404).json({
            status: false,
            message: "Quiz not found",
          });
        }
        return res.status(201).json({
          status: true,
          message: "Quiz update success",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Quiz  update failed",
          other: error,
        });
      });
  }

  static async addQuizItem(req: Request, res: Response) {
    const { id, quiz } = req.body;
    if (!quiz && !id) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }
    Quiz.findOneAndUpdate({ _id: id }, { $push: { quiz: quiz } }, { new: true })
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "Quiz item update success",
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Quiz item update failed",
          other: error,
        });
      });
  }

  static async addQuizItemWithObjectiveImage(req: MulterRequest, res: Response) {
    try {
      let { id, quiz } = req.body;

      if (!quiz || !id) {
        return res.status(400).json({
          status: false,
          message: "Missing fields",
        });
      }

      quiz = JSON.parse(quiz);

      let imageUrls: string[] = [];
      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files as { buffer: Buffer; originalname: string }[]) {
          const imageUrl = await uploadFile(file, "objectiveImages");
          imageUrls.push(`${imageUrl.key}`);
        }
      }

      quiz.objectivesWithImage = quiz.objectivesWithImage.map((obj, index) => ({
        name: obj.name,
        image: imageUrls[index] || null,
      }));

      const updatedQuiz = await Quiz.findOneAndUpdate(
        { _id: id },
        { $push: { quiz: quiz } },
        { new: true }
      );

      return res.status(201).json({
        status: true,
        message: "Quiz item update success",
        response: updatedQuiz,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Quiz item update failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async updateQuizItemWithObjectiveImage(req: MulterRequest, res: Response) {
    try {
      let { quiz_id, quiz } = req.body;

      if (!quiz || !quiz_id) {
        return res.status(400).json({
          status: false,
          message: "Missing fields",
        });
      }

      quiz = JSON.parse(quiz);

      let imageUrls: string[] = [];
      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files as { buffer: Buffer; originalname: string }[]) {
          const imageUrl = await uploadFile(file, "objectiveImages");
          imageUrls.push(`${imageUrl.key}`);
        }
      }

      if (quiz.objectivesWithImage && quiz.objectivesWithImage.length > 0) {
        quiz.objectivesWithImage = quiz.objectivesWithImage.map((obj, index) => ({
          name: obj.name,
          image: imageUrls[index] || obj.image,
        }));
      }

      const updatedQuiz = await Quiz.findOneAndUpdate(
        { "quiz._id": quiz_id },
        { $set: { "quiz.$": quiz } },
        { new: true }
      );

      if (!updatedQuiz) {
        return res.status(404).json({
          status: false,
          message: "Quiz item not found",
        });
      }

      return res.status(200).json({
        status: true,
        message: "Quiz item update success",
        response: updatedQuiz,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Quiz item update failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async updateQuizItemWithObjectiveImageV2(req: MulterRequest, res: Response) {
    try {
      let { question_id, question } = req.body;

      if (!question_id || !question) {
        return res.status(400).json({
          status: false,
          message: "Missing fields: question_id or/and question",
        });
      }

      const quizQuestion = await Quiz.findOne({ "quiz._id": question_id });

      question = JSON.parse(question);

      let imageUrls: string[] = [];
      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files as { buffer: Buffer; originalname: string }[]) {
          const imageUrl = await uploadFile(file, "objectiveImages");
          imageUrls.push(`${imageUrl.key}`);
        }
      }

      const updatedQuiz = quizQuestion;

      if (!updatedQuiz) {
        return res.status(404).json({
          status: false,
          message: "Quiz item not found",
          quizQuestion,
          question,
        });
      }

      return res.status(200).json({
        status: true,
        message: "Quiz item update success",
        response: updatedQuiz,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Quiz item update failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async updateQuizItem(req: Request, res: Response) {
    const { quiz_id, quiz } = req.body;
    if (!quiz && !quiz_id) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }

    Quiz.findOneAndUpdate(
      { "quiz._id": quiz_id },
      { $set: { "quiz.$": quiz } },
      { new: true }
    )
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "Quiz item update success",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Quiz item update failed",
          other: error,
        });
      });
  }

  static async updateQuizItemThumbnail(req: MulterRequest, res: Response) {
    const { id } = req.body;
    const file = req.file as { buffer: Buffer; originalname: string } | undefined;

    if (!file || !id) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    try {
      const result = await uploadFile(file, "quiz-item");
      if (result) {
        const thumbnail = `${result.key}`;
        Quiz.findOneAndUpdate(
          { "quiz._id": id },
          { $set: { "quiz.$.thumbnail": thumbnail } },
          { new: true }
        )
          .then(() => {
            return res.status(201).json({
              status: true,
              message: "Quiz item(thumbnail) update success",
            });
          })
          .catch((error) => {
            return res.status(404).json({
              status: false,
              message: "Quiz item(thumbnail) update failed",
              other: error,
            });
          });
      }
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
      });
    }
  }

  static async deleteQuizItem(req: Request, res: Response) {
    const { id, quiz_id } = req.body;
    if (!quiz_id && !id) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }

    Quiz.findOneAndUpdate(
      { _id: id },
      { $pull: { quiz: { _id: quiz_id } } },
      { new: true }
    )
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "Quiz item deleted success",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Quiz item deleted failed",
          other: error,
        });
      });
  }

  static async addCourse(req: Request, res: Response) {
    const { id, course } = req.body;
    if (!id && !course) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }

    Quiz.findOneAndUpdate(
      { _id: id },
      { $addToSet: { course: course } },
      { new: true }
    )
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "Quiz update success",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Quiz update failed",
          other: error,
        });
      });
  }

  static async courseToManyQuiz(req: Request, res: Response) {
    const { ids, course } = req.body;
    if (!course || !Array.isArray(ids) || ids.length === 0) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }

    const objectIds = ids.map((id: string) => new mongoose.Types.ObjectId(id));

    Quiz.updateMany(
      { _id: { $in: objectIds } },
      { $addToSet: { course: course } }
    )
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "Quiz update success",
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Quiz update failed",
          other: error,
        });
      });
  }

  static async removeCourse(req: Request, res: Response) {
    const { id, course } = req.body;
    if (!id && !course) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }

    Quiz.findOneAndUpdate(
      { _id: id },
      { $pull: { course: course } },
      { new: true }
    )
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "Quiz update success",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Quiz update failed",
          other: error,
        });
      });
  }

  static async addStudent(req: Request, res: Response) {
    const { id, student } = req.body;
    if (!id && !student) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }

    Quiz.findOneAndUpdate(
      { _id: id },
      { $addToSet: { students: student } },
      { new: true }
    )
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "Student added to Quiz success",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Failed to add student",
          other: error,
        });
      });
  }

  static async removeStudent(req: Request, res: Response) {
    const { id, student } = req.body;
    if (!id && !student) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }

    Quiz.findOneAndUpdate(
      { _id: id },
      { $pull: { students: student } },
      { new: true }
    )
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "Student removed successful",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Failed to remove Student",
          other: error,
        });
      });
  }

  static async byStudent(req: Request, res: Response) {
    const { id } = req.params;
    Quiz.find({ students: { $in: [id] } })
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "QUIZ success",
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "QUIZ failed",
          other: error,
        });
      });
  }

  static async updateQuizItemAnswerNotesImage(req: MulterRequest, res: Response) {
    const { id } = req.body;
    const file = req.file as { buffer: Buffer; originalname: string } | undefined;

    if (!file || !id) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    try {
      const result = await uploadFile(file, "quiz-item");
      if (result) {
        const thumbnail = `${result.key}`;
        Quiz.findOneAndUpdate(
          { "quiz._id": id },
          { $set: { "quiz.$.answer_notes_image": thumbnail } },
          { new: true }
        )
          .then(() => {
            return res.status(201).json({
              status: true,
              message: "Quiz item answer_notes_image update success",
            });
          })
          .catch((error) => {
            return res.status(404).json({
              status: false,
              message: "Quiz item answer_notes_image update failed",
              other: error,
            });
          });
      }
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
      });
    }
  }

  static async deleteQuizItemAnswerNotesImage(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }
    try {
      Quiz.findOneAndUpdate(
        { "quiz._id": id },
        { $set: { "quiz.$.answer_notes_image": null } },
        { new: true }
      )
        .then(() => {
          return res.status(201).json({
            status: true,
            message: "Quiz item answer_notes_image deletion success",
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Quiz item answer_notes_image deletion failed",
            other: error,
          });
        });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
      });
    }
  }

  static async byCourseStudentV(req: Request, res: Response) {
    const { course, studentId } = req.params;
    try {
      const quizzes = await Quiz.find(
        { course: { $in: [course] } },
        { _id: 1, title: 1, description: 1, status: 1, thumbnail: 1, updatedAt: 1 }
      ).lean();

      const quizzesWithResponses = await Promise.all(
        quizzes.map(async (quiz) => {
          const latestResponse = await QuizResponse.findOne(
            {
              student: studentId,
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
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Error fetching quizzes with latest responses",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async quizResponseAll(req: Request, res: Response) {
    QuizResponse.find()
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "QUIZ success",
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "QUIZ failed",
          other: error,
        });
      });
  }

  static async quizResponseDelete(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      return res.status(401).json({
        status: false,
        message: "Missing field",
      });
    }
    QuizResponse.deleteOne({ _id: id })
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "Quiz delete success",
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Quiz delete failed",
          other: error,
        });
      });
  }

  static async quizResponseLeaderboardAll(req: Request, res: Response) {
    QuizResponse.aggregate([
      {
        $group: {
          _id: "$quiz_id",
          responseCount: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "quizzes",
          localField: "_id",
          foreignField: "_id",
          as: "quizDetails",
        },
      },
      {
        $unwind: { path: "$quizDetails", preserveNullAndEmptyArrays: true },
      },
      {
        $project: {
          quiz_id: "$_id",
          responseCount: 1,
          quizTitle: "$quizDetails.title",
          _id: 0,
        },
      },
    ])
      .then((result) => {
        return res.status(200).json({
          status: true,
          message: "QUIZ Leaderboard deleted",
          response: result,
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

  static async quizResponseLeaderboardDelete(req: Request, res: Response) {
    const { quiz_id } = req.params;

    QuizResponse.deleteMany({ quiz_id })
      .then(() => {
        return res.status(200).json({
          status: true,
          message: "QUIZ Leaderboard deleted",
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
}
