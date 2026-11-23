import { Request, Response } from "express";
import mongoose from "mongoose";
import * as path from "path";
import multer from "multer";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  bucketName,
  s3,
} from "../../geminiAi/controllers/geminiAi.shared";
import {
  SubscriptionResourceFileStatus,
  SubscriptionResourceType,
} from "../enums/subscription.enum";
import SubscriptionResource from "../schema/subscriptionResource.schema";
import SubscriptionResourceFile from "../schema/subscriptionResourceFile.schema";
import SubscriptionResourceLesson from "../schema/subscriptionResourceLesson.schema";
import { sanitizeVideoTimestamps } from "../../../helpers/videoTimestamps";
import {
  SUBSCRIPTION_LESSON_PDF_KEYS,
  SUBSCRIPTION_LESSON_VIDEO_KEYS,
  cloneCourseToSubscriptionResource,
  collectLessonMediaSlots,
  hydrateSubscriptionResources,
  migrateFlatFilesToLessonOne,
  serializeSubscriptionLesson,
  syncAllSubscriptionFilesForResource,
  syncSubscriptionFilesFromLesson,
} from "../subscriptionResourceLesson.service";

interface MulterRequest extends Request {
  file?: multer.File;
}

const nextEmptySlot = (
  lesson: Record<string, unknown>,
  kind: "pdf" | "video"
) => {
  const keys = kind === "pdf" ? SUBSCRIPTION_LESSON_PDF_KEYS : SUBSCRIPTION_LESSON_VIDEO_KEYS;
  for (const slot of keys) {
    const val = lesson[slot];
    if (!val || (typeof val === "string" && !val.trim())) return slot;
  }
  return null;
};

export class AdminSubscriptionLessonController {
  static async migrateLegacyFiles(_req: Request, res: Response) {
    try {
      const result = await migrateFlatFilesToLessonOne();
      return res.status(200).json({
        status: true,
        message: "Legacy flat files migrated where needed",
        response: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: error?.message || "Migration failed",
      });
    }
  }

  static async cloneFromCourse(req: Request, res: Response) {
    try {
      const { courseId, title, description, category } = req.body as {
        courseId?: string;
        title?: string;
        description?: string;
        category?: string;
      };
      if (!courseId) {
        return res.status(400).json({ status: false, message: "courseId is required" });
      }
      const currentUser = req["currentUser"] as { id?: string } | undefined;
      const result = await cloneCourseToSubscriptionResource({
        courseId,
        title,
        description,
        categoryId: category,
        authorId: currentUser?.id,
      });
      const [response] = await hydrateSubscriptionResources([
        typeof result.resource.toObject === "function"
          ? result.resource.toObject()
          : result.resource,
      ]);
      return res.status(201).json({
        status: true,
        message: `Course cloned with ${result.lessonCount} lesson(s)`,
        response,
      });
    } catch (error: any) {
      const status = error?.message === "Course not found" ? 404 : 500;
      return res.status(status).json({
        status: false,
        message: error?.message || "Clone failed",
      });
    }
  }

  static async listLessons(req: Request, res: Response) {
    try {
      const { id } = req.params as { id?: string };
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid resource id" });
      }
      const lessons = await SubscriptionResourceLesson.find({ resource: id })
        .sort({ position: 1 })
        .lean();
      return res.status(200).json({
        status: true,
        message: "Lessons fetched",
        response: lessons.map((lesson) => serializeSubscriptionLesson(lesson)),
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: error?.message || "Failed to list lessons",
      });
    }
  }

  static async createLesson(req: Request, res: Response) {
    try {
      const { id } = req.params as { id?: string };
      const { title, description, position, status } = req.body as {
        title?: string;
        description?: string;
        position?: number;
        status?: string;
      };
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid resource id" });
      }
      const resource = await SubscriptionResource.findById(id);
      if (!resource) {
        return res.status(404).json({ status: false, message: "Resource not found" });
      }
      const maxPos = await SubscriptionResourceLesson.findOne({ resource: id })
        .sort({ position: -1 })
        .select("position")
        .lean();
      const nextPosition =
        typeof position === "number" && position > 0
          ? position
          : (maxPos?.position || 0) + 1;
      const lesson = await SubscriptionResourceLesson.create({
        resource: id,
        title: title?.trim() || `Lesson ${nextPosition}`,
        description: description?.trim() || null,
        position: nextPosition,
        public: false,
        status: status === "DEACTIVE" ? "DEACTIVE" : "ACTIVE",
        author: (req["currentUser"] as { id?: string } | undefined)?.id,
      });
      return res.status(201).json({
        status: true,
        message: "Lesson created",
        response: serializeSubscriptionLesson(lesson.toObject()),
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: error?.message || "Failed to create lesson",
      });
    }
  }

  static async updateLesson(req: Request, res: Response) {
    try {
      const { id, lessonId } = req.params as { id?: string; lessonId?: string };
      const body = req.body as Record<string, unknown>;
      if (
        !id ||
        !lessonId ||
        !mongoose.Types.ObjectId.isValid(id) ||
        !mongoose.Types.ObjectId.isValid(lessonId)
      ) {
        return res.status(400).json({ status: false, message: "Invalid id" });
      }
      const allowed = new Set([
        "title",
        "description",
        "position",
        "status",
        ...SUBSCRIPTION_LESSON_VIDEO_KEYS,
        ...SUBSCRIPTION_LESSON_PDF_KEYS,
      ]);
      const update: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) {
        if (!allowed.has(key)) continue;
        update[key] = value;
      }
      if (body.videoTimestamps !== undefined) {
        const markers = sanitizeVideoTimestamps(body.videoTimestamps);
        if (!markers) {
          return res.status(400).json({
            status: false,
            message: "videoTimestamps must be a list of { slot, seconds, text }",
          });
        }
        update.videoTimestamps = markers;
      }
      const lesson = await SubscriptionResourceLesson.findOneAndUpdate(
        { _id: lessonId, resource: id },
        { $set: update },
        { new: true }
      );
      if (!lesson) {
        return res.status(404).json({ status: false, message: "Lesson not found" });
      }
      const shared = Boolean(lesson.sourceLessonId);
      await syncSubscriptionFilesFromLesson(String(lesson._id), { sharedS3Key: shared });
      return res.status(200).json({
        status: true,
        message: "Lesson updated",
        response: serializeSubscriptionLesson(lesson.toObject()),
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: error?.message || "Failed to update lesson",
      });
    }
  }

  static async deleteLesson(req: Request, res: Response) {
    try {
      const { id, lessonId } = req.params as { id?: string; lessonId?: string };
      if (
        !id ||
        !lessonId ||
        !mongoose.Types.ObjectId.isValid(id) ||
        !mongoose.Types.ObjectId.isValid(lessonId)
      ) {
        return res.status(400).json({ status: false, message: "Invalid id" });
      }
      const lesson = await SubscriptionResourceLesson.findOne({
        _id: lessonId,
        resource: id,
      });
      if (!lesson) {
        return res.status(404).json({ status: false, message: "Lesson not found" });
      }
      await SubscriptionResourceFile.deleteMany({ lesson: lessonId });
      await SubscriptionResourceLesson.deleteOne({ _id: lessonId });
      return res.status(200).json({
        status: true,
        message: "Lesson deleted",
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: error?.message || "Failed to delete lesson",
      });
    }
  }

  static async uploadLessonMedia(req: MulterRequest, res: Response) {
    try {
      const { id, lessonId } = req.params as { id?: string; lessonId?: string };
      const resourceType = String(req.body?.resource_type || req.body?.resourceType || "")
        .toUpperCase()
        .trim();
      if (
        !id ||
        !lessonId ||
        !mongoose.Types.ObjectId.isValid(id) ||
        !mongoose.Types.ObjectId.isValid(lessonId)
      ) {
        return res.status(400).json({ status: false, message: "Invalid id" });
      }
      if (!req.file) {
        return res.status(400).json({ status: false, message: "upload file required" });
      }
      if (resourceType !== "PDF" && resourceType !== "VIDEO") {
        return res.status(400).json({
          status: false,
          message: "resource_type must be PDF or VIDEO",
        });
      }
      const lesson = await SubscriptionResourceLesson.findOne({
        _id: lessonId,
        resource: id,
      });
      if (!lesson) {
        return res.status(404).json({ status: false, message: "Lesson not found" });
      }
      const slot = nextEmptySlot(
        lesson.toObject() as Record<string, unknown>,
        resourceType === "PDF" ? "pdf" : "video"
      );
      if (!slot) {
        return res.status(400).json({
          status: false,
          message: "No empty media slot on this lesson",
        });
      }
      const originalName = req.file.originalname;
      const ext = path.extname(originalName).toLowerCase() || (resourceType === "PDF" ? ".pdf" : ".mp4");
      const uniqueFileName = `${path.basename(originalName, ext)}_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}${ext}`;
      const folder = resourceType === "PDF" ? "pdf" : "video";
      const fileKey = `subscription-ai/${id}/lessons/${lessonId}/${folder}/${uniqueFileName}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: fileKey,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        })
      );
      lesson.set(slot, fileKey);
      await lesson.save();
      await syncSubscriptionFilesFromLesson(String(lesson._id), {
        sharedS3Key: false,
      });
      return res.status(200).json({
        status: true,
        message: "Media uploaded",
        response: { slot, fileKey, lesson },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: error?.message || "Upload failed",
      });
    }
  }

  static async syncResourceFiles(req: Request, res: Response) {
    try {
      const { id } = req.params as { id?: string };
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid resource id" });
      }
      const result = await syncAllSubscriptionFilesForResource(id);
      return res.status(200).json({
        status: true,
        message: "Lesson media synced to indexable files",
        response: result,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: error?.message || "Sync failed",
      });
    }
  }

  /** Assign a flat SubscriptionResourceFile key onto lesson 1 if missing */
  static async ensureLessonForLegacyUpload(resourceId: string) {
    let lesson = await SubscriptionResourceLesson.findOne({ resource: resourceId })
      .sort({ position: 1 });
    if (!lesson) {
      lesson = await SubscriptionResourceLesson.create({
        resource: resourceId,
        title: "Lesson 1",
        position: 1,
        status: "ACTIVE",
      });
    }
    return lesson;
  }
}

export function attachMediaSummary(lesson: Record<string, unknown>) {
  const slots = collectLessonMediaSlots(lesson);
  return {
    ...lesson,
    mediaCount: slots.length,
  };
}