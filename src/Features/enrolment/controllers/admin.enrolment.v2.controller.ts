import { Request, Response } from "express";
import mongoose from "mongoose";
import { Readable } from "stream";
import csvParser = require("csv-parser");
import Enrolled from "../../course/schema/enroll.schema";
import multer from "multer";
type CsvRow = Record<string, string>;

interface MulterRequest extends Request {
  file?: multer.File;
  files?: multer.File[];
}

const parseCsvEmails = async (buffer: Buffer): Promise<string[]> => {
  const emails: string[] = [];

  return new Promise((resolve, reject) => {
    Readable.from(buffer)
      .pipe(csvParser())
      .on("data", (row: CsvRow) => {
        const email =
          row.email ||
          row.Email ||
          row.EMAIL ||
          row["e-mail"] ||
          row["E-mail"] ||
          Object.values(row)[0];
        if (email) {
          emails.push(String(email).trim());
        }
      })
      .on("end", () => {
        const unique = Array.from(new Set(emails)).filter(Boolean);
        resolve(unique);
      })
      .on("error", reject);
  });
};

export class AdminEnrolmentV2Controller {
  static async addOne(req: Request, res: Response) {
    const { email, courseId } = req.body;

    if (!email || !courseId) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    const enrolled = Enrolled({
      email,
      course: courseId,
    });
    enrolled
      .save()
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "New user enrolled added",
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "User enrolling failed",
          other: error,
        });
      });
  }

  static async deleteOne(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    Enrolled.deleteOne({ _id: id })
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "Enrolled User delete",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Enrolled user deleting failed",
          other: error,
        });
      });
  }

  static async deleteMany(req: Request, res: Response) {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "Please provide an array of IDs" });
    }

    const objectIds = ids.map((id: string) => new mongoose.Types.ObjectId(id));

    Enrolled.deleteMany({ _id: { $in: objectIds } })
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "Enrollement delete",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Deleting enrollement failed",
          other: error,
        });
      });
  }

  static async deactivateOne(req: Request, res: Response) {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    Enrolled.updateOne({ _id: id }, { status: "INACTIVE" })
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "Enrollement removed",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Removing enrollement failed",
          other: error,
        });
      });
  }

  static async deactivateMany(req: Request, res: Response) {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "Please provide an array of IDs" });
    }

    const objectIds = ids.map((id: string) => new mongoose.Types.ObjectId(id));

    Enrolled.updateMany(
      { _id: { $in: objectIds } },
      { $set: { status: "INACTIVE" } }
    )
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "Enrollement removed",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Removing enrollement failed",
          other: error,
        });
      });
  }

  static async update(req: Request, res: Response) {
    const { id, status, email } = req.body;
    if (!id || !status || !email) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    Enrolled.updateOne({ _id: id }, { status, email }, { upsert: false })
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "Enrolled User updated",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Enrolled user updating failed",
          other: error,
        });
      });
  }

  static async addMany(req: Request, res: Response) {
    const { emails, courseId } = req.body;
    if (!emails || !courseId) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    const enrolled = [
      ...emails.map((email: string) => ({
        email,
        course: courseId,
      })),
    ];

    Enrolled.insertMany(enrolled)
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "New user enrolled added",
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "User enrolling failed",
          other: error,
        });
      });
  }

  static async addCsv(req: MulterRequest, res: Response) {
    const { courseId } = req.body;
    const file = req.file;
    if (!file || !courseId) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    try {
      const emailsFromCsv = await parseCsvEmails(file.buffer);
      const enrolled = [
        ...emailsFromCsv.map((email) => ({
          email,
          course: courseId,
        })),
      ];

      Enrolled.insertMany(enrolled)
        .then((result) => {
          return res.status(201).json({
            status: true,
            message: "New user enrolled added",
            response: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "User enrolling failed",
            other: error,
          });
        });
    } catch (error) {
      return res.status(404).json({
        status: false,
        message: "Failed to initial emailing...",
      });
    }
  }

  static async byCourse(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({
        error: "Missing fields",
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

    const total = await Enrolled.countDocuments({
      course: new mongoose.Types.ObjectId(id as string),
      status: "ACTIVE",
    });
    const totalPages = Math.ceil(total / limit);

    Enrolled.aggregate([
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 1,
          email: 1,
          status: 1,
          course: 1,
          createdAt: 1,
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
      {
        $match: {
          course: new mongoose.Types.ObjectId(id as string),
          status: "ACTIVE",
        },
      },
      { $skip: skip },
      { $limit: limit },
    ])
      .then((result) => {
        return res.status(200).json({
          status: true,
          message: "Enrolled all User",
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
          },
          result: result.map((value) => {
            const user = value.user[0];
            return {
              _id: value._id,
              courseId: value.course,
              email: value.email,
              hasAccount: user ? true : false,
              userId: user?._id,
              firstname: user?.firstname,
              lastname: user?.lastname,
              userStatus: user?.status,
              status: value.status,
              createdAt: value.createdAt,
            };
          }),
        });
      })
      .catch(() => {
        return res.status(404).json({
          status: false,
          message: "Enrolled users failed",
        });
      });
  }

  static async byUser(req: Request, res: Response) {
    const { email } = req.params;
    if (!email) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    Enrolled.find({ email, status: "ACTIVE" })
      .populate({
        path: "course",
        populate: { path: "categoryId" },
      })
      .then((result) => {
        return res.status(200).json({
          status: true,
          message: "Enrolled all User",
          result: result
            .filter((value) => { 
              if (value.course === undefined) return false;
              if (value.course?.status === "ACTIVE") return true;
              return false;
            })
            .map((value) => value.course),
        });
      })
      .catch((error) => { 
        return res.status(404).json({
          status: false,
          message: "Enrolled users failed",
        });
      });
  }

  static async enrollUserToManyCourses(req: Request, res: Response) {
    try {
      const { email, courseIds } = req.body;

      if (!email || !courseIds || !Array.isArray(courseIds)) {
        return res.status(400).json({
          status: false,
          message: "Missing fields or invalid courseIds format",
        });
      }

      const enrollments = courseIds.map((courseId: string) => ({
        email,
        course: courseId,
      }));

      const result = await Enrolled.insertMany(enrollments);

      return res.status(201).json({
        status: true,
        message: "User successfully enrolled in multiple courses",
        response: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "User enrollment failed",
        error: error.message,
      });
    }
  }

  static async unenrollUserFromManyCourses(req: Request, res: Response) {
    try {
      const { email, courseIds } = req.body;

      if (!email || !courseIds || !Array.isArray(courseIds)) {
        return res.status(400).json({
          status: false,
          message: "Missing fields or invalid courseIds format",
        });
      }

      const result = await Enrolled.deleteMany({
        email,
        course: { $in: courseIds },
      });

      return res.status(200).json({
        status: true,
        message: "User successfully unenrolled from selected courses",
        deletedCount: result.deletedCount,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "User unenrollment failed",
        error: error.message,
      });
    }
  }
}
