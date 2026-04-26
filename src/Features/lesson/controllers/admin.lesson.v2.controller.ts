import { Request, Response } from "express";
import mongoose from "mongoose";
import multer from "multer";
import Lesson from "../schema/lesson.schema";
import Resource from "../schema/resource.schema";
import { uploadFile, getFileStream } from "../../../helpers/s3";

interface MulterRequest extends Request {
  file?: multer.File;
  files?: multer.File[];
}

export class AdminLessonV2Controller {
  static async upload(req: MulterRequest, res: Response) {
    const file = req.file;
    const { lesson_id } = req.body;

    if (!file || !lesson_id) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    try {
      const result = await uploadFile(file, "lesson");
      if (result) {
        const pdf = `/res/${result.key}`;
        return res.status(201).json({
          status: true,
          pdf,
          message: "upload success",
        });
      }

      return res.status(400).json({
        status: false,
        message: "PDF upload failed",
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
      });
    }
  }

  static async addPdf(req: MulterRequest, res: Response) {
    const file = req.file;
    const { lesson_id } = req.body;

    if (!file || !lesson_id) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    try {
      const pdf = req.file?.path;
      return Lesson.findOneAndUpdate({ _id: lesson_id }, { pdf }, { upsert: true })
        .then(() => {
          return res.status(200).json({
            status: true,
            message: "Lesson update success",
            response: pdf,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Lesson update failed",
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

  static async addVideo(req: MulterRequest, res: Response) {
    const file = req.file;
    const { lesson_id } = req.body;

    if (!file || !lesson_id) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    try {
      const video = req.file?.path;
      return Lesson.findOneAndUpdate({ _id: lesson_id }, { video }, { upsert: true })
        .then(() => {
          return res.status(200).json({
            status: true,
            message: "Lesson update success",
            response: video,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Lesson update failed",
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

  static async addVideoCompress(req: MulterRequest, res: Response) {
    const file = req.file;
    const { lesson_id, video_type } = req.body;

    if (!file || !lesson_id || !video_type) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    try {
      const video = req.file?.path;
      const updateVideo =
        video_type == "video_com"
          ? { video_com: video }
          : video_type == "video1_com"
          ? { video1_com: video }
          : video_type == "video2_com"
          ? { video2_com: video }
          : video_type == "video3_com"
          ? { video3_com: video }
          : { video4_com: video };

      return Lesson.findOneAndUpdate(
        { _id: lesson_id },
        { ...updateVideo },
        { upsert: true }
      )
        .then(() => {
          return res.status(200).json({
            status: true,
            message: "Lesson update success",
            response: video,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Lesson update failed",
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

  static async addVideoExtra(req: MulterRequest, res: Response) {
    const file = req.file;
    const { lesson_id, video_type } = req.body;

    if (!file || !lesson_id || !video_type) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    try {
      const video = req.file?.path;
      const updateVideo =
        video_type == "video1"
          ? { video1: video }
          : video_type == "video2"
          ? { video2: video }
          : video_type == "video3"
          ? { video3: video }
          : { video4: video };

      return Lesson.findOneAndUpdate(
        { _id: lesson_id },
        { ...updateVideo },
        { upsert: true }
      )
        .then(() => {
          return res.status(200).json({
            status: true,
            message: "Lesson update success",
            response: video,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Lesson update failed",
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

  static async addPdfExtra(req: MulterRequest, res: Response) {
    const file = req.file;
    const { lesson_id, pdf_type } = req.body;

    if (!file || !lesson_id || !pdf_type) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    try {
      const pdf = req.file?.path;
      const updatePdf =
        pdf_type == "pdf1"
          ? { pdf1: pdf }
          : pdf_type == "pdf2"
          ? { pdf2: pdf }
          : pdf_type == "pdf3"
          ? { pdf3: pdf }
          : { pdf4: pdf };

      return Lesson.findOneAndUpdate(
        { _id: lesson_id },
        { ...updatePdf },
        { upsert: true }
      )
        .then(() => {
          return res.status(200).json({
            status: true,
            message: "Lesson update success",
            response: pdf,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Lesson update failed",
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

  static async add(req: Request, res: Response) {
    const { course_id, title, desc, position, authorId } = req.body;

    if (!course_id || !title || !desc || !authorId) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      const lesson = Lesson({
        course: course_id,
        linkedCourses: [{ course: course_id, position: position || 1 }],
        title,
        position: position || 1,
        description: desc,
        author: authorId,
      });

      lesson
        .save()
        .then((result) => {
          return res.status(200).json({
            status: true,
            message: "Lesson saved success",
            response: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Lesson saved failed",
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

  static async addLesson(req: Request, res: Response) {
    const { course_id, title, desc, public: isPublic, position, authorId } = req.body;

    if (!course_id || !title || !desc || !authorId) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      const lesson = Lesson({
        course: course_id,
        linkedCourses: [{ course: course_id, position: position || 1 }],
        title,
        public: isPublic || false,
        position: position || 1,
        description: desc,
        author: authorId,
      });

      lesson
        .save()
        .then((result) => {
          return res.status(200).json({
            status: true,
            message: "Lesson saved success",
            response: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Lesson saved failed",
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

  static async linkToCourse(req: Request, res: Response) {
    const { course_id, lesson_id, position } = req.body;

    if (!course_id || !lesson_id) {
      return res.status(400).json({ error: "Missing fields" });
    }

    try {
      if (
        !mongoose.Types.ObjectId.isValid(course_id) ||
        !mongoose.Types.ObjectId.isValid(lesson_id)
      ) {
        return res.status(400).json({ error: "Invalid course_id or lesson_id" });
      }

      const courseObjectId = new mongoose.Types.ObjectId(course_id);

      const updatedLesson = await Lesson.findByIdAndUpdate(
        lesson_id,
        {
          $addToSet: { linkedCourses: { course: courseObjectId, position } },
        },
        { new: true }
      );

      if (!updatedLesson) {
        return res.status(404).json({
          status: false,
          message: "Lesson not found",
        });
      }

      return res.status(200).json({
        status: true,
        message: "Lesson saved successfully",
        response: updatedLesson,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "System Error",
        error: error.message,
      });
    }
  }

  static async unlinkFromCourse(req: Request, res: Response) {
    const { course_id, lesson_id } = req.body;

    if (!course_id || !lesson_id) {
      return res.status(400).json({ error: "Missing fields" });
    }

    try {
      if (
        !mongoose.Types.ObjectId.isValid(course_id) ||
        !mongoose.Types.ObjectId.isValid(lesson_id)
      ) {
        return res.status(400).json({ error: "Invalid course_id or lesson_id" });
      }

      const courseObjectId = new mongoose.Types.ObjectId(course_id);

      const updatedLesson = await Lesson.findByIdAndUpdate(
        lesson_id,
        { $pull: { linkedCourses: { course: courseObjectId } } },
        { new: true }
      );

      if (!updatedLesson) {
        return res.status(404).json({
          status: false,
          message: "Lesson not found",
        });
      }

      return res.status(200).json({
        status: true,
        message: "Course unlinked successfully",
        response: updatedLesson,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "System Error",
        error: error.message,
      });
    }
  }

  static async publicLessons(req: Request, res: Response) {
    try {
      const { page = 1, limit = 10000, search = "" } = req.query as {
        page?: string | number;
        limit?: string | number;
        search?: string;
      };

      const skip = (Number(page) - 1) * Number(limit);
      const filter = {
        public: true,
        $or: [
          { title: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
        ],
      };

      const total = await Lesson.countDocuments(filter);
      const publicLessons = await Lesson.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

      return res.status(200).json({
        status: true,
        message: "Public Lessons retrieved successfully",
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          pages: Math.ceil(total / Number(limit)),
        },
        response: publicLessons,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "System Error",
        error: error.message,
      });
    }
  }

  static async bulkUpdate(req: Request, res: Response) {
    const lessons = req.body.data;
    try {
      if (!Array.isArray(lessons) || lessons.length === 0) {
        return res.status(400).json({
          error: "Invalid request. Provide an array of lessons to update.",
        });
      }

      const updatePromises = lessons.map(
        ({ id, title, description, position, public: isPublic }) => {
          if (!id) {
            throw new Error("Missing ID for category");
          }
          return Lesson.findOneAndUpdate(
            { _id: id },
            { title, description, position, public: isPublic },
            { new: true }
          );
        }
      );

      const updatedLessons = await Promise.all(updatePromises);

      return res.status(200).json({
        status: true,
        message: "Lessons updated successfully",
        data: updatedLessons,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to update lessons",
        error: error.message,
      });
    }
  }

  static async addResource(req: MulterRequest, res: Response) {
    const file = req.file;
    const { lesson_id, type } = req.body;

    if (!file || !lesson_id || !type) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }
    try {
      const ress = req.file?.path;
      const resource = Resource({ lesson_id, file: ress, type });
      resource
        .save()
        .then(() => {
          return res.status(200).json({
            status: true,
            message:
              type == "VIDEO" ? "Video added to lesson" : "Pdf added to lesson",
            response: ress,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Failed to add video/pdf",
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

  static async deleteResource(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      Resource.deleteOne({ _id: id })
        .then(() => {
          return res.status(200).json({
            status: true,
            message: "Lesson Resource delete success",
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Lesson Resource delete failed",
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

  static async deletePdf(req: Request, res: Response) {
    const { lesson_id, filename, pdf_type } = req.body;
    if (!lesson_id || !filename || !pdf_type) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      const updatePdf =
        pdf_type == "pdf"
          ? { pdf: null }
          : pdf_type == "pdf1"
          ? { pdf1: null }
          : pdf_type == "pdf2"
          ? { pdf2: null }
          : pdf_type == "pdf3"
          ? { pdf3: null }
          : { pdf4: null };
      Lesson.findOneAndUpdate({ _id: lesson_id }, { ...updatePdf })
        .then((result) => { 
            return res.status(200).json({
              status: true,
              message: "Lesson PDF delete success",
              response: result,
            }); 
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Lesson PDF delete failed",
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

  static async deleteVideo(req: Request, res: Response) {
    const { lesson_id, filename, video_type } = req.body;

    if (!filename || !lesson_id || !video_type) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    try {
      const updateVideo =
        video_type == "video"
          ? { video: null }
          : video_type == "video1"
          ? { video1: null }
          : video_type == "video2"
          ? { video2: null }
          : video_type == "video3"
          ? { video3: null }
          : { video4: null };
      Lesson.findOneAndUpdate({ _id: lesson_id }, { ...updateVideo }, { upsert: true })
        .then((result) => {
          return res.status(200).json({
            status: true,
            message: "Lesson video delete success",
            response: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Lesson video delete failed",
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

  static async update(req: Request, res: Response) {
    const { id, title, desc } = req.body;
    if (!id || !title || !desc) {
      return res.status(400).json({ error: "Missing fields" });
    }

    try {
      Lesson.findOneAndUpdate(
        { _id: id },
        { id, title, description: desc },
        { upsert: true }
      )
        .then((result) => {
          return res.status(200).json({
            status: true,
            message: "Lesson update success",
            response: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Lesson update failed",
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

  static async delete(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      Lesson.deleteOne({ _id: id })
        .then(() => {
          return res.status(200).json({
            status: true,
            message: "Lesson delete success",
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Lesson delete failed",
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

  static async single(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      Lesson.findOne({ _id: id })
        .then((result) => {
          return res.status(200).json({
            status: true,
            message: "Lesson success",
            response: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Lesson failed",
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

  static async uploadVideoToBucket(req: MulterRequest, res: Response) {
    const file = req.file;
    const { lesson_id, video_type } = req.body;

    if (!file || !lesson_id || !video_type) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }
    try {
      const uploadResponse = await uploadFile(req.file, "users");
      if (uploadResponse) {
        const video = `${uploadResponse.key}`;
        const updateVideo =
          video_type == "video"
            ? { video: video }
            : video_type == "video1"
            ? { video1: video }
            : video_type == "video2"
            ? { video2: video }
            : video_type == "video3"
            ? { video3: video }
            : { video4: video };
        Lesson.findOneAndUpdate(
          { _id: lesson_id },
          { ...updateVideo },
          { upsert: true }
        )
          .then(() => {
            return res.status(200).json({
              status: true,
              message: "Lesson update success",
              response: video,
            });
          })
          .catch((error) => {
            return res.status(404).json({
              status: false,
              message: "Lesson update failed",
              other: error,
            });
          });
      } else {
        return res.status(400).json({
          status: false,
          message: "Failed to upload",
        });
      }
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
      });
    }
  }

  static async uploadFileToBucket(req: MulterRequest, res: Response) {
    const file = req.file;
    const { lesson_id, resource_type } = req.body;

    if (!file || !lesson_id || !resource_type) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }
    try {
      const uploadResponse = await uploadFile(
        req.file,
        resource_type.includes("video") ? "video" : "pdf"
      );
      if (uploadResponse) {
        const url = `${uploadResponse.key}`;
        const uploadedResource =
          resource_type == "video"
            ? { video: url }
            : resource_type == "video1"
            ? { video1: url }
            : resource_type == "video2"
            ? { video2: url }
            : resource_type == "video3"
            ? { video3: url }
            : resource_type == "video4"
            ? { video4: url }
            : resource_type == "video5"
            ? { video5: url }
            : resource_type == "video6"
            ? { video6: url }
            : resource_type == "video7"
            ? { video7: url }
            : resource_type == "video8"
            ? { video8: url }
            : resource_type == "video9"
            ? { video9: url }
            : resource_type == "video10"
            ? { video10: url }
            : resource_type == "pdf"
            ? { pdf: url }
            : resource_type == "pdf1"
            ? { pdf1: url }
            : resource_type == "pdf2"
            ? { pdf2: url }
            : resource_type == "pdf3"
            ? { pdf3: url }
            : resource_type == "pdf4"
            ? { pdf4: url }
            : resource_type == "pdf5"
            ? { pdf5: url }
            : resource_type == "pdf6"
            ? { pdf6: url }
            : resource_type == "pdf7"
            ? { pdf7: url }
            : resource_type == "pdf8"
            ? { pdf8: url }
            : resource_type == "pdf9"
            ? { pdf9: url }
            : { pdf10: url };

        Lesson.findOneAndUpdate(
          { _id: lesson_id },
          { ...uploadedResource },
          { upsert: true }
        )
          .then(() => {
            return res.status(200).json({
              status: true,
              message: "Lesson update success",
              response: url,
            });
          })
          .catch((error) => {
            return res.status(404).json({
              status: false,
              message: "Lesson update failed",
              other: error,
            });
          });
      } else {
        return res.status(400).json({
          status: false,
          message: "Failed to upload",
        });
      }
    } catch (error) {
      console.log('error :>> ', error);
      return res.status(500).json({
        status: false,
        message: "System Error",
      });
    }
  }

  static async s3Resource(req: Request, res: Response) {
    try {
      const { key } = req.query as { key?: string };
      if (!key) {
        return res.status(400).json({ message: "missing key" });
      }
      getFileStream(key, (response) => {
        res.set("Content-Length", response.contentLength.toString());
        response.stream.pipe(res);
      });
    } catch (e) {
      return res.status(500).json({ message: "failed", e });
    }
  }
}
