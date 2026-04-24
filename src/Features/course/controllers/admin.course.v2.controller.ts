import { Request, Response } from "express";
import * as fs from "fs";
import mongoose from "mongoose";
import Course from "../schema/course.schema";
import Enrolled from "../schema/enroll.schema";
import multer from "multer";
import { uploadFile } from "../../../helpers/s3";

interface MulterRequest extends Request {
  file?: multer.File;
  files?: multer.File[];
}

export class AdminCourseV2Controller {
  static async all(req: Request, res: Response) {
    try {
      Course.aggregate([
        { $sort: { _id: 1 } },
        {
          $lookup: {
            from: "lessons",
            localField: "_id",
            foreignField: "course",
            as: "lessons",
          },
        },
        { $match: { status: "ACTIVE" } },
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
            course: 1,
            author: 1,
            createdAt: 1,
            updatedAt: 1,
            lessons: {
              $filter: {
                input: "$lessons",
                as: "lessons",
                cond: { $eq: ["$$lessons.status", "ACTIVE"] },
              },
            },
          },
        },
      ])
        .then((result) => {
          return res.status(201).json({
            status: true,
            message: "Course list success",
            response: result.map((value) => ({
              ...value,
              lessons: value.lessons.length,
            })),
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Course list failed",
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

  static async allV3(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10000;
      const skip = (page - 1) * limit;

      const total = await Course.countDocuments({ status: "ACTIVE" });

      const result = await Course.aggregate([
        { $match: { status: "ACTIVE" } },
        { $sort: { _id: 1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $lookup: {
            from: "lessons",
            let: { courseId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$status", "ACTIVE"] },
                      {
                        $in: [
                          "$$courseId",
                          { $ifNull: ["$linkedCourses.course", []] },
                        ],
                      },
                    ],
                  },
                },
              },
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
            linkedCourses: 1,
            archived: 1,
            status: 1,
            author: 1,
            createdAt: 1,
            updatedAt: 1,
            categoryId: { $arrayElemAt: ["$categoryId", 0] },
            lessonsCount: { $size: "$lessons" },
          },
        },
      ]);

      return res.status(200).json({
        status: true,
        message: "Course list success",
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

  static async allV2(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10000;
      const skip = (page - 1) * limit;
      const { categoryId, search } = req.query as {
        categoryId?: string;
        search?: string;
      };

      const filter: Record<string, unknown> = {
        status: "ACTIVE",
      };

      if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
        filter.categoryId = new mongoose.Types.ObjectId(categoryId);
      }

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

  static async allNew(req: Request, res: Response) {
    try {
      const { student_id } = req.params;
      const page =
        parseInt(req.query.page as string) > 0
          ? parseInt(req.query.page as string)
          : 1;
      const limit =
        parseInt(req.query.limit as string) > 0
          ? parseInt(req.query.limit as string)
          : 10000;
      const skip = (page - 1) * limit;

      if (!student_id || !mongoose.Types.ObjectId.isValid(student_id as string)) {
        return res.status(400).json({
          status: false,
          message: "Invalid or missing student ID",
        });
      }

      const countPipeline = [
        {
          $match: {
            $or: [
              { status: "ACTIVE" },
              { students: new mongoose.Types.ObjectId(student_id as string) },
              {
                studentsDeactiveAccess: new mongoose.Types.ObjectId(
                  student_id as string
                ),
              },
            ],
          },
        },
        { $count: "total" },
      ];
      const countResult = await Course.aggregate(countPipeline);
      const total = countResult[0]?.total || 0;
      const totalPages = Math.ceil(total / limit);

      const pipeline = [
        {
          $match: {
            $or: [
              { status: "ACTIVE" },
              { students: new mongoose.Types.ObjectId(student_id as string) },
              {
                studentsDeactiveAccess: new mongoose.Types.ObjectId(
                  student_id as string
                ),
              },
            ],
          },
        },
        { $sort: { _id: 1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $lookup: {
            from: "lessons",
            let: { courseId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$course", "$$courseId"] },
                      { $eq: ["$status", "ACTIVE"] },
                    ],
                  },
                },
              },
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
            author: 1,
            archived: 1,
            status: 1,
            course: 1,
            createdAt: 1,
            updatedAt: 1,
            categoryId: { $arrayElemAt: ["$categoryId", 0] },
            lessonsCount: { $size: "$lessons" },
          },
        },
      ];

      const result = await Course.aggregate(pipeline);

      return res.status(200).json({
        status: true,
        message: "Course list success",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
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

  static async single(req: Request, res: Response) {
    const { id } = req.params;
    try {
      Course.aggregate([
        { $sort: { _id: 1 } },
        {
          $lookup: {
            from: "lessons",
            localField: "_id",
            foreignField: "course",
            as: "lessons",
          },
        },
        {
          $match: {
            _id: new mongoose.Types.ObjectId(id as string),
            status: "ACTIVE",
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
            course: 1,
            createdAt: 1,
            lessons: {
              $filter: {
                input: "$lessons",
                as: "lessons",
                cond: { $eq: ["$$lessons.status", "ACTIVE"] },
              },
            },
          },
        },
      ])
        .then((result) => {
          if (result.length > 0) {
            return res.status(201).json({
              status: true,
              message: "Course single success",
              response: result[0],
            });
          }
          return res.status(404).json({
            status: false,
            message: "Course not found",
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Course single failed",
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

  static async adminSingleV2(req: Request, res: Response) {
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
            linkedCourses: 1,
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

  static async adminSingle(req: Request, res: Response) {
    const { id } = req.params;
    try {
      Course.aggregate([
        { $sort: { _id: 1 } },
        {
          $lookup: {
            from: "lessons",
            localField: "_id",
            foreignField: "course",
            as: "lessons",
          },
        },
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
            course: 1,
            createdAt: 1,
            lessons: {
              $filter: {
                input: "$lessons",
                as: "lessons",
                cond: { $eq: ["$$lessons.status", "ACTIVE"] },
              },
            },
          },
        },
      ])
        .then((result) => {
          if (result.length > 0) {
            return res.status(201).json({
              status: true,
              message: "Course single success(ADMIN ONLY)",
              response: result[0],
            });
          }
          return res.status(404).json({
            status: false,
            message: "Course not found (ADMIN ONLY)",
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Course single failed (ADMIN ONLY)",
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

  static async userCourses(req: Request, res: Response) {
    const { email } = req.params;
    try {
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
                if (value?.course === undefined) return false;
                if (value?.course?.status === "ACTIVE") return true;
                return false;
              })
              .map((value) => value.course),
          });
        })
        .catch((error) => {
          console.log('error', error)
          return res.status(404).json({
            status: false,
            message: "Enrolled users failed",
          });
        });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
      });
    }
  }


  static async everything(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10000;
      const skip = (page - 1) * limit;

      const total = await Course.countDocuments();

      const result = await Course.aggregate([
        { $sort: { _id: 1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $lookup: {
            from: "lessons",
            localField: "_id",
            foreignField: "course",
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
            archived: 1,
            status: 1,
            course: 1,
            author: 1,
            createdAt: 1,
            updatedAt: 1,
            categoryId: { $arrayElemAt: ["$categoryId", 0] },
            lessons: {
              $filter: {
                input: "$lessons",
                as: "lesson",
                cond: { $eq: ["$$lesson.status", "ACTIVE"] },
              },
            },
          },
        },
        {
          $addFields: {
            lessonCount: { $size: "$lessons" },
          },
        },
        {
          $project: {
            lessons: 0,
          },
        },
      ]);

      return res.status(200).json({
        status: true,
        message: "Course list success",
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

  static async everythingSingle(req: Request, res: Response) {
    const { id } = req.params;
    try {
      Course.aggregate([
        { $sort: { _id: 1 } },
        {
          $lookup: {
            from: "lessons",
            localField: "_id",
            foreignField: "course",
            as: "lessons",
          },
        },
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
            course: 1,
            createdAt: 1,
            lessons: {
              $filter: {
                input: "$lessons",
                as: "lessons",
                cond: { $eq: ["$$lessons.status", "ACTIVE"] },
              },
            },
          },
        },
      ])
        .then((result) => {
          if (result.length > 0) {
            return res.status(201).json({
              status: true,
              message: "Course single success",
              response: result[0],
            });
          }
          return res.status(404).json({
            status: false,
            message: "Course not found",
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Course single failed",
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

  static async adminCourseAllV2(req: Request, res: Response) {
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

  static async addCourse(req: MulterRequest, res: Response) {
    const { title, desc, link, price, category, status, authorId } = req.body;
    if (!title || !status || !authorId) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        error: "Image file is required",
      });
    }

    const result = await uploadFile(file, "course");
      if (result) {
        const thumbnail = result.key;
        try {
          const course = Course({
            title,
            description: desc,
            thumbnail,
            link,
            price,
            categoryId: category,
            status,
            author: authorId,
          });
          course
            .save()
            .then((result) => {
              return res.status(201).json({
                status: true,
                message: "New Course added",
                response: result,
              });
            })
            .catch((error) => {
              return res.status(404).json({
                status: false,
                message: "Course adding failed",
                other: error,
              });
            });
        } catch (error) {
          return res.status(404).json({
            status: false,
            message: "Image too large",
            other: "Failed to remove previous",
          });
        }
      } else {
        return res.status(400).json({
          status: false,
          message: "Course image upload failed",
        });
      }
    
    
  }

  static async updateCourse(req: Request, res: Response) {
    const { id, title, desc, link, price, category, status } = req.body;

    if (!id || !title || !status) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    try {
      Course.findOneAndUpdate(
        { _id: id },
        { title, description: desc, link, price, categoryId: category, status },
        { upsert: false }
      )
        .then((result) => {
          return res.status(201).json({
            status: true,
            message: "Course update",
            response: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Course updating failed",
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

  static async updateThumbnailOld(req: MulterRequest, res: Response) {
    const { id, old_image } = req.body;
    const file = req.file;

    if (!file || !id) {
      return res.status(400).json({
        error: "Missing fields (id, file)",
      });
    }

    try {
      const thumbnail = req.file?.path;

      if (old_image !== undefined) {
        fs.unlink(old_image, () => {
          Course.findOneAndUpdate({ _id: id }, { thumbnail }, { upsert: true })
            .then(() => {
              return res.status(201).json({
                status: true,
                message: "Course image update",
                response: thumbnail,
              });
            })
            .catch((error) => {
              return res.status(404).json({
                status: false,
                message: "Course image updating failed",
                other: error,
              });
            });
        });
      } else {
        Course.findOneAndUpdate({ _id: id }, { thumbnail }, { upsert: true })
          .then(() => {
            return res.status(201).json({
              status: true,
              message: "Course image update",
              response: thumbnail,
            });
          })
          .catch((error) => {
            return res.status(404).json({
              status: false,
              message: "Course image updating failed",
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

  static async updateThumbnail(req: MulterRequest, res: Response) {
    const { id } = req.body;
    const file = req.file;

    if (!file || !id) {
      return res.status(400).json({
        error: "Missing fields (id, image-file-required)",
      });
    }
    const result = await uploadFile(file, "course");
    if (result) { 
      try {
        const thumbnail = result.key;
        Course.findOneAndUpdate({ _id: id }, { thumbnail }, { upsert: true })
          .then(() => {
            return res.status(201).json({
              status: true,
              message: "Course image update",
              response: thumbnail,
            });
          })
          .catch((error) => {
            return res.status(404).json({
              status: false,
              message: "Course image updating failed",
              other: error,
            });
          });
      } catch (error) {
        return res.status(500).json({
          status: false,
          message: "System Error",
        });
      }
    } else {
      return res.status(400).json({
        status: false,
        message: "Course image upload failed",
      });
    }
  }

  static async deleteCourse(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      Course.deleteOne({ _id: id })
        .then(() => {
          return res.status(201).json({
            status: true,
            message: "Course delete success",
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Course delete failed",
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

  static async updateStatus(req: Request, res: Response) {
    const { id, status } = req.body;
    if (!id || !status) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      Course.findOneAndUpdate({ _id: id }, { status }, { upsert: false })
        .then((result) => {
          return res.status(201).json({
            status: true,
            message: "Course status update",
            response: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Course status updating failed",
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

  static async updateArchive(req: Request, res: Response) {
    const { id, archived } = req.body;
    if (!id || archived === undefined) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      Course.findOneAndUpdate({ _id: id }, { archived }, { upsert: false })
        .then((result) => {
          return res.status(201).json({
            status: true,
            message: "Course archived update",
            response: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Course archived updating failed",
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

  static async addArchivedStudent(req: Request, res: Response) {
    const { id, student } = req.body;
    if (!id && !student) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }

    Course.findOneAndUpdate(
      { _id: id },
      { $addToSet: { students: student } },
      { new: true }
    )
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "Student added to Archived course success",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Failed to add student to Archived course",
          other: error,
        });
      });
  }

  static async removeArchivedStudent(req: Request, res: Response) {
    const { id, student } = req.body;
    if (!id && !student) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }

    Course.findOneAndUpdate(
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

  static async archivedByStudent(req: Request, res: Response) {
    const { id } = req.params;
    Course.find({ students: { $in: [id] } })
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: " Archived course success",
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Archived course failed",
          other: error,
        });
      });
  }

  static async addDeactivatedStudent(req: Request, res: Response) {
    const { id, student } = req.body;
    if (!id && !student) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }

    Course.findOneAndUpdate(
      { _id: id },
      { $addToSet: { studentsDeactiveAccess: student } },
      { new: true }
    )
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "Student added to deactived course success",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Failed to add student to deactived course",
          other: error,
        });
      });
  }

  static async removeDeactivatedStudent(req: Request, res: Response) {
    const { id, student } = req.body;
    if (!id && !student) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }

    Course.findOneAndUpdate(
      { _id: id },
      { $pull: { studentsDeactiveAccess: student } },
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

  static async deactivatedByStudent(req: Request, res: Response) {
    const { id } = req.params;
    Course.find({ studentsDeactiveAccess: { $in: [id] } })
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "Deactived course success",
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Deactived course failed",
          other: error,
        });
      });
  }

  static async linkCourses(req: Request, res: Response) {
    try {
      const { courseId, linkedCourses } = req.body;

      if (!courseId || !linkedCourses || !Array.isArray(linkedCourses)) {
        return res.status(400).json({
          status: false,
          message: "Invalid request data. Provide courseId and linkedCourses array.",
        });
      }

      const course = await Course.findById(courseId);
      if (!course) {
        return res.status(404).json({ status: false, message: "Course not found" });
      }

      const linkedCourseEntries = linkedCourses.map((linkedId: string) => ({
        course: new mongoose.Types.ObjectId(linkedId),
      }));

      await Course.findByIdAndUpdate(
        courseId,
        { linkedCourses: linkedCourseEntries },
        { new: true }
      );

      return res.status(200).json({
        status: true,
        message: "Courses linked successfully",
        linkedCourses: linkedCourseEntries,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
        error,
      });
    }
  }

  static async unlinkCourses(req: Request, res: Response) {
    try {
      const { courseId, linkedCourses } = req.body;

      if (!courseId || !linkedCourses || !Array.isArray(linkedCourses)) {
        return res.status(400).json({
          status: false,
          message: "Invalid request data. Provide courseId and linkedCourses array.",
        });
      }

      const course = await Course.findById(courseId);
      if (!course) {
        return res.status(404).json({ status: false, message: "Course not found" });
      }

      const updatedLinkedCourses = course.linkedCourses.filter(
        (entry: { course: { toString: () => string } }) =>
          !linkedCourses.includes(entry.course.toString())
      );

      await Course.findByIdAndUpdate(
        courseId,
        { linkedCourses: updatedLinkedCourses },
        { new: true }
      );

      return res.status(200).json({
        status: true,
        message: "Courses unlinked successfully",
        linkedCourses: updatedLinkedCourses,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
        error,
      });
    }
  }

  static async adminV2(req: Request, res: Response) {
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
            as: "categoryDetails",
          },
        },
        {
          $lookup: {
            from: "courses",
            localField: "linkedCourses.course",
            foreignField: "_id",
            as: "localLinkedCourses",
          },
        },
        {
          $lookup: {
            from: "categories",
            localField: "localLinkedCourses.categoryId",
            foreignField: "_id",
            as: "linkedCoursesCategories",
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
            categoryId: { $arrayElemAt: ["$categoryDetails", 0] },
            archived: 1,
            status: 1,
            author: 1,
            createdAt: 1,
            updatedAt: 1,
            lessons: 1,
            linkedCourses: {
              $map: {
                input: "$localLinkedCourses",
                as: "course",
                in: {
                  _id: "$$course._id",
                  title: "$$course.title",
                  description: "$$course.description",
                  thumbnail: "$$course.thumbnail",
                  link: "$$course.link",
                  price: "$$course.price",
                  archived: "$$course.archived",
                  status: "$$course.status",
                  categoryId: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: "$linkedCoursesCategories",
                          as: "cat",
                          cond: { $eq: ["$$cat._id", "$$course.categoryId"] },
                        },
                      },
                      0,
                    ],
                  },
                },
              },
            },
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
}
