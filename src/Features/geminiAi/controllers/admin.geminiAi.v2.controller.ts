import { Request, Response } from "express";
import * as path from "path";
import mongoose from "mongoose";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  COLLECTION_NAME,
  GEMINI_CHAT_MODEL,
  buildCollectionVectorConfig,
  buildPointVector,
  buildSearchVector,
  bucketName,
  calculateOptimalBatchSize,
  checkAiLimits,
  chunkText,
  downloadPDFfromS3,
  downloadFileFromS3,
  downloadFileFromUrl,
  embedText,
  ensurePayloadIndexesForGeminiCollection,
  getFileNameFromUrl,
  getMimeTypeForS3Key,
  getMimeTypeForUrl,
  handleQdrantOperation,
  estimateTokens,
  geminiChatModel,
  inferSourceTypeFromUrl,
  LESSON_FILES_BASE_URL,
  parsePdfText,
  resolveVectorFormat,
  transcribeVideoWithGemini,
  qdrant,
  s3,
} from "./geminiAi.shared";
import User from "../../user/schema/user.schema";
import GlobalAiLimit from "../../mslAi/schema/globalAiLimit.schema";
import AiUsage from "../../mslAi/schema/aiUsage.schema";
import Lesson from "../../lesson/schema/lesson.schema";
import Course from "../../course/schema/course.schema";
import ProcessedLessonFile from "../schema/processedLessonFile.schema";

interface MulterRequest extends Request {
  file?: multer.File;
  files?: multer.File[] | { [fieldname: string]: multer.File[] };
}

type PendingLessonFileRow = {
  courseId: string;
  lessonId: string;
  fileKey: string;
  fileType: "pdf" | "video";
  url: string;
};

const STRICT_SYSTEM_PROMPT =
  "You are a helpful AI assistant trained on MSL learning materials. Answer the question strictly based on the provided context return response in HTML format. If the context does not contain the answer, respond with 'I do not have enough information from the MSL materials to answer that question.'";

const buildStrictPrompt = (contextText: string, question: string) =>
  `${STRICT_SYSTEM_PROMPT}\n\nContext:\n${contextText}\n\nQuestion:\n${question}`;

/** In-memory state for course-lessons background job (single instance). */
const courseLessonsJobState = {
  isRunning: false,
  startedAt: null as Date | null,
  totalFiles: 0,
  processedCount: 0,
  lastError: null as string | null,
};

export class AdminGeminiAiV2Controller {
  static async listPdfs(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      if (page < 1) {
        return res.status(400).json({
          success: false,
          message: "Page number must be greater than 0",
        });
      }

      if (limit < 1 || limit > 100) {
        return res.status(400).json({
          success: false,
          message: "Limit must be between 1 and 100",
        });
      }

      const data = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: "pdf/",
        })
      );

      const allPdfFiles = (data.Contents ?? [])
        .filter((obj) => obj.Key?.toLowerCase().endsWith(".pdf"))
        .map((obj) => ({
          key: obj.Key,
          size: obj.Size,
          lastModified: obj.LastModified,
          fileName: obj.Key ? path.basename(obj.Key) : null,
        }));

      const total = allPdfFiles.length;
      const totalPages = Math.ceil(total / limit);
      const pdfFiles = allPdfFiles.slice(skip, skip + limit);

      return res.status(200).json({
        success: true,
        message: `Found ${total} PDF files in S3 bucket`,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        data: pdfFiles,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error listing PDF files from S3",
        error: error.message,
      });
    }
  }


  static async listVideos(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;
      const videoExtensions = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".mp3", ".m4a", ".wav", ".ogg"];

      if (page < 1) {
        return res.status(400).json({
          success: false,
          message: "Page number must be greater than 0",
        });
      }
      if (limit < 1 || limit > 100) {
        return res.status(400).json({
          success: false,
          message: "Limit must be between 1 and 100",
        });
      }

      const data = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: "video/",
        })
      );

      const allVideoFiles = (data.Contents ?? [])
        .filter((obj) => {
          const key = (obj.Key || "").toLowerCase();
          return videoExtensions.some((ext) => key.endsWith(ext));
        })
        .map((obj) => ({
          key: obj.Key,
          size: obj.Size,
          lastModified: obj.LastModified,
          fileName: obj.Key ? path.basename(obj.Key) : null,
        }));

      const total = allVideoFiles.length;
      const totalPages = Math.ceil(total / limit);
      const videoFiles = allVideoFiles.slice(skip, skip + limit);

      return res.status(200).json({
        success: true,
        message: `Found ${total} video/audio files in S3 bucket`,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        data: videoFiles,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error listing video files from S3",
        error: error.message,
      });
    }
  }

   

  /** Process a single PDF or video from a public URL: download, extract text/transcript, chunk, embed, upsert to Qdrant. */
  static async processSingleFromUrl(req: Request, res: Response) {
    try {
      const { url, type: requestedType } = req.body as {
        url?: string;
        type?: "pdf" | "video";
      };

      if (!url || typeof url !== "string" || !url.trim()) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: url (string).",
        });
      }

      const sourceUrl = url.trim();
      const type: "pdf" | "video" =
        requestedType === "pdf" || requestedType === "video"
          ? requestedType
          : inferSourceTypeFromUrl(sourceUrl);

      console.log(`[processSingleFromUrl] Fetching: ${sourceUrl} (type: ${type})`);

      const buffer = await downloadFileFromUrl(sourceUrl);
      const fileName = getFileNameFromUrl(sourceUrl);
      console.log(`[processSingleFromUrl] Downloaded: ${fileName} (${buffer.length} bytes)`);

      let allChunks: { sourceType: string; sourceUrl: string; fileName: string; chunkIndex: number; text: string; processedAt: string }[] = [];

      if (type === "pdf") {
        console.log(`[processSingleFromUrl] Parsing PDF: ${sourceUrl}`);
        const text = await parsePdfText(buffer);
        if (!text || text.length < 10) {
          console.log(`[processSingleFromUrl] Failed: PDF had no extractable text`);
          return res.status(400).json({
            success: false,
            message: "PDF contained no extractable text.",
          });
        }
        const chunks = chunkText(text, 500);
        chunks.forEach((chunk, index) => {
          allChunks.push({
            sourceType: "url",
            sourceUrl,
            fileName,
            chunkIndex: index,
            text: chunk,
            processedAt: new Date().toISOString(),
          });
        });
        console.log(`[processSingleFromUrl] PDF parsed: ${text.length} chars → ${chunks.length} chunks`);
      } else {
        const mimeType = getMimeTypeForUrl(sourceUrl);
        console.log(`[processSingleFromUrl] Transcribing video/audio (${mimeType}): ${sourceUrl}`);
        const transcript = await transcribeVideoWithGemini(buffer, mimeType);
        if (!transcript || transcript.length < 10) {
          console.log(`[processSingleFromUrl] Failed: no or minimal transcript`);
          return res.status(400).json({
            success: false,
            message: "Video/audio produced no or minimal transcript.",
          });
        }
        const chunks = chunkText(transcript, 500);
        chunks.forEach((chunk, index) => {
          allChunks.push({
            sourceType: "url",
            sourceUrl,
            fileName,
            chunkIndex: index,
            text: chunk,
            processedAt: new Date().toISOString(),
          });
        });
        console.log(`[processSingleFromUrl] Transcript done: ${transcript.length} chars → ${chunks.length} chunks`);
      }

      try {
        await qdrant.createCollection(COLLECTION_NAME, {
          vectors: buildCollectionVectorConfig(),
        });
      } catch (error: any) {
        if (
          error.status !== 409 &&
          !error.message?.includes("already exists") &&
          !error.data?.status?.error?.includes("already exists")
        ) {
          if (
            error.code === "UND_ERR_CONNECT_TIMEOUT" ||
            error.message?.includes("fetch failed")
          ) {
            return res.status(503).json({
              success: false,
              message: "Vector database service unavailable.",
            });
          }
          throw error;
        }
      }

      const batchSize = calculateOptimalBatchSize(allChunks, 8000);
      let totalUpserted = 0;
      console.log(`[processSingleFromUrl] Embedding and upserting ${allChunks.length} chunks (batch size: ${batchSize})`);

      for (let i = 0; i < allChunks.length; i += batchSize) {
        const batch = allChunks.slice(i, i + batchSize);
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        try {
          const embeddings = await Promise.all(
            batch.map((item: any) => embedText(item.text))
          );
          const vectorFormat = await resolveVectorFormat();
          const points = batch.map((item: any, idx: number) => ({
            id: uuidv4(),
            vector: buildPointVector(embeddings[idx], vectorFormat),
            payload: {
              sourceType: item.sourceType,
              sourceUrl: item.sourceUrl,
              fileName: item.fileName,
              chunkIndex: item.chunkIndex,
              text: item.text,
              processedAt: item.processedAt,
            },
          }));
          await qdrant.upsert(COLLECTION_NAME, { wait: true, points });
          totalUpserted += points.length;
          console.log(`[processSingleFromUrl] Upserted batch ${Math.floor(i / batchSize) + 1}: chunks ${i + 1}-${i + batch.length} (total: ${totalUpserted})`);
        } catch (embeddingError: any) {
          if (embeddingError.code === "rate_limit_exceeded") {
            console.log(`[processSingleFromUrl] Rate limited, waiting 60s then retrying batch`);
            await new Promise((resolve) => setTimeout(resolve, 60000));
            i -= batchSize;
            continue;
          }
          console.log(`[processSingleFromUrl] Failed on batch:`, embeddingError?.message ?? embeddingError);
          throw embeddingError;
        }
      }

      console.log(`[processSingleFromUrl] Done: ${sourceUrl} (${totalUpserted} chunks)`);

      return res.status(200).json({
        success: true,
        message: "Successfully processed file from URL and stored in Qdrant",
        response: {
          url: sourceUrl,
          type,
          fileName,
          totalChunks: allChunks.length,
          totalUpserted,
          collectionName: COLLECTION_NAME,
        },
      });
    } catch (error: any) {
      console.log(`[processSingleFromUrl] Error:`, error?.message ?? error);
      return res.status(500).json({
        success: false,
        message: "Error processing file from URL",
        error: error.message,
      });
    }
  }

  /** Normalize lesson file value to a consistent fileKey (path) and full URL for fetching. */
  private static lessonFileToKeyAndUrl(value: string): { fileKey: string; url: string } {
    const v = (value || "").trim();
    if (!v) return { fileKey: "", url: "" };
    if (v.startsWith("http://") || v.startsWith("https://")) {
      try {
        const u = new URL(v);
        const fileKey = u.pathname.startsWith("/") ? u.pathname.slice(1) : u.pathname;
        return { fileKey: fileKey || v, url: v };
      } catch {
        return { fileKey: v, url: LESSON_FILES_BASE_URL.replace(/\/$/, "") + "/" + v.replace(/^\//, "") };
      }
    }
    const fileKey = v.replace(/^\//, "");
    const base = LESSON_FILES_BASE_URL.replace(/\/$/, "");
    return { fileKey, url: `${base}/${fileKey}` };
  }

  /** Collect all (courseId, lessonId, fileKey, fileType) from lessons for given courseIds. */
  private static async collectLessonFiles(
    courseIds: mongoose.Types.ObjectId[]
  ): Promise<{ courseId: string; lessonId: string; fileKey: string; fileType: "pdf" | "video"; url: string }[]> {
    const lessons = await Lesson.find({ course: { $in: courseIds } })
      .select("_id course video video1 video2 video3 video4 video5 video6 video7 video8 video9 video10 pdf pdf1 pdf2 pdf3 pdf4 pdf5 pdf6 pdf7 pdf8 pdf9 pdf10")
      .lean();
    const videoKeys = ["video", "video1", "video2", "video3", "video4", "video5", "video6", "video7", "video8", "video9", "video10"];
    const pdfKeys = ["pdf", "pdf1", "pdf2", "pdf3", "pdf4", "pdf5", "pdf6", "pdf7", "pdf8", "pdf9", "pdf10"];
    const out: { courseId: string; lessonId: string; fileKey: string; fileType: "pdf" | "video"; url: string }[] = [];
    for (const lesson of lessons) {
      const lessonId = (lesson as any)._id.toString();
      const courseId = (lesson as any).course?.toString() || "";
      for (const k of videoKeys) {
        const v = (lesson as any)[k];
        if (v) {
          const { fileKey, url } = AdminGeminiAiV2Controller.lessonFileToKeyAndUrl(v);
          if (fileKey) out.push({ courseId, lessonId, fileKey, fileType: "video", url });
        }
      }
      for (const k of pdfKeys) {
        const v = (lesson as any)[k];
        if (v) {
          const { fileKey, url } = AdminGeminiAiV2Controller.lessonFileToKeyAndUrl(v);
          if (fileKey) out.push({ courseId, lessonId, fileKey, fileType: "pdf", url });
        }
      }
    }
    return out;
  }

  /** Shared: collect pending lesson files for embedding for the given course ObjectIds. */
  private static async preparePendingLessonFilesForCourses(
    objectIds: mongoose.Types.ObjectId[]
  ): Promise<{
    courseIds: string[];
    allFiles: PendingLessonFileRow[];
    pending: PendingLessonFileRow[];
    totalFiles: number;
    totalProcessedFiles: number;
  }> {
    const courseIds = objectIds.map((id) => id.toString());
    const allFiles = await AdminGeminiAiV2Controller.collectLessonFiles(objectIds);
    console.log('allFiles', allFiles)
    

    const alreadyProcessed = await ProcessedLessonFile.find({ status: "SUCCESS" })
      .select("lesson fileKey")
      .lean();
    const processedSet = new Set(
      (alreadyProcessed as { lesson: mongoose.Types.ObjectId; fileKey: string }[]).map(
        (r) => `${r.lesson}_${r.fileKey}`
      )
    );
    const pendingRaw = allFiles.filter((f) => !processedSet.has(`${f.lessonId}_${f.fileKey}`));
    const seen = new Set<string>();
    const pending = pendingRaw.filter((f) => {
      const key = `${f.lessonId}_${f.fileKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { courseIds, allFiles, pending , totalFiles: allFiles.length, totalProcessedFiles: alreadyProcessed.length };
  }

  /** Process course lessons for embedding: return 202 immediately and run job in background. */
  static async processCourseLessonsForEmbedding(req: Request, res: Response) {
    try {
      const { courseIds } = req.body as { courseIds?: string[] };
      if (!Array.isArray(courseIds) || courseIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Missing or invalid body: courseIds (non-empty array of course IDs).",
        });
      }
      const validIds = courseIds.filter(
        (id) => typeof id === "string" && id.trim() && mongoose.Types.ObjectId.isValid(id.trim())
      );
      if (validIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid course IDs provided.",
        });
      }
      const objectIds = validIds.map((id) => new mongoose.Types.ObjectId(id.trim()));

      const { courseIds: resolvedCourseIds, allFiles, pending, totalFiles } =
        await AdminGeminiAiV2Controller.preparePendingLessonFilesForCourses(objectIds);

      if (allFiles.length === 0) {
        return res.status(200).json({
          success: true,
          message: "No lesson PDFs or videos found for the given courses.",
          response: { courseIds: resolvedCourseIds, totalFilesToProcess: 0, totalFiles },
        });
      }

      if (pending.length === 0) {
        return res.status(200).json({
          success: true,
          message: "All lesson files for the given courses have already been processed.",
          response: {
            courseIds: resolvedCourseIds,
            totalFilesToProcess: 0,
            totalSkipped: allFiles.length,
            totalFiles,
          },
        });
      }

      res.status(202).json({
        success: true,
        message: "Processing started. Lesson files are being processed in the background.",
        response: {
          courseIds: resolvedCourseIds,
          totalFilesToProcess: pending.length,
          totalSkipped: allFiles.length - pending.length,
          totalFiles,
        },
      });

      setImmediate(() => {
        AdminGeminiAiV2Controller.runProcessCourseLessonsBackground(pending).catch((e) => {
          console.error("[processCourseLessonsForEmbedding] Background error:", e);
        });
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error starting course-lessons processing",
        error: error.message,
      });
    }
  }

  /**
   * Like processCourseLessonsForEmbedding but includes every course (any status: ACTIVE, DEACTIVE, AI-USE; includes archived).
   * No body required. Returns 202 and runs the same background embedding job.
   */
  static async processAllCoursesLessonsForEmbedding(req: Request, res: Response) {
    try {
      const courses = await Course.find({})
        .select("_id")
        .lean();
      const objectIds = (courses as { _id: mongoose.Types.ObjectId }[])
        .map((c) => c._id)
        .filter(Boolean);

      if (objectIds.length === 0) {
        return res.status(200).json({
          success: true,
          message: "No courses found in the database.",
          response: {
            scope: "all_courses_any_status",
            totalCourses: 0,
            totalFilesToProcess: 0,
          },
        });
      }

      const { courseIds, allFiles, pending, totalFiles, totalProcessedFiles } =
        await AdminGeminiAiV2Controller.preparePendingLessonFilesForCourses(objectIds);

      if (allFiles.length === 0) {
        return res.status(200).json({
          success: true,
          message: "No lesson PDFs or videos found across all courses.",
          response: {
            scope: "all_courses_any_status",
            totalCourses: courseIds.length,
            totalFilesToProcess: 0,
            totalFiles,
            totalProcessedFiles,
          },
        });
      }

      if (pending.length === 0) {
        return res.status(200).json({
          success: true,
          message: "All lesson files for all courses have already been processed.",
          response: {
            scope: "all_courses_any_status",
            totalCourses: courseIds.length,
            totalFilesToProcess: 0,
            totalSkipped: allFiles.length,
            totalFiles,
            totalProcessedFiles,
            },
        });
      }

      res.status(202).json({
        success: true,
        message:
          "Processing started for all courses (any status). Lesson files are being processed in the background.",
        response: {
          scope: "all_courses_any_status",
          totalCourses: courseIds.length,
          totalFilesToProcess: pending.length,
          totalSkipped: allFiles.length - pending.length,
          totalFiles,
          totalProcessedFiles,
        },
      });

      setImmediate(() => {
        AdminGeminiAiV2Controller.runProcessCourseLessonsBackground(pending).catch((e) => {
          console.error("[processAllCoursesLessonsForEmbedding] Background error:", e);
        });
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error starting all-courses lesson embedding",
        error: error.message,
      });
    }
  }

  /** List processed lesson files with optional filters and pagination. */
  static async getProcessedLessons(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
      const courseId = (req.query.courseId as string)?.trim();
      const lessonId = (req.query.lessonId as string)?.trim();
      const status = (req.query.status as string)?.trim();

      const filter: Record<string, unknown> = {};
      if (courseId && mongoose.Types.ObjectId.isValid(courseId)) {
        filter.course = new mongoose.Types.ObjectId(courseId);
      }
      if (lessonId && mongoose.Types.ObjectId.isValid(lessonId)) {
        filter.lesson = new mongoose.Types.ObjectId(lessonId);
      }
      if (status && ["SUCCESS", "FAILED", "PROCESSING"].includes(status)) {
        filter.status = status;
      }

      const total = await ProcessedLessonFile.countDocuments(filter);
      const totalPages = Math.ceil(total / limit);
      const skip = (page - 1) * limit;

      const items = await ProcessedLessonFile.find(filter)
        .populate("course", "title")
        .populate("lesson", "title position")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      return res.status(200).json({
        success: true,
        message: "Processed lesson files retrieved.",
        response: {
          data: items,
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
          },
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching processed lessons",
        error: error.message,
      });
    }
  }

  /** Background job: process each pending file, update ProcessedLessonFile. */
  static async runProcessCourseLessonsBackground(
    pending: { courseId: string; lessonId: string; fileKey: string; fileType: "pdf" | "video"; url: string }[]
  ): Promise<void> {
    courseLessonsJobState.isRunning = true;
    courseLessonsJobState.startedAt = new Date();
    courseLessonsJobState.totalFiles = pending.length;
    courseLessonsJobState.processedCount = 0;
    courseLessonsJobState.lastError = null;
    console.log(`[processCourseLessons] Starting background job: ${pending.length} file(s)`);

    try {
      try {
        await qdrant.createCollection(COLLECTION_NAME, { vectors: buildCollectionVectorConfig() });
    } catch (error: any) {
      if (
        error.status !== 409 &&
        !error.message?.includes("already exists") &&
        !error.data?.status?.error?.includes("already exists")
      ) {
        console.error("[processCourseLessons] Qdrant createCollection failed:", error?.message);
      }
    }

      await ensurePayloadIndexesForGeminiCollection();
      const vectorFormat = await resolveVectorFormat();

      for (const file of pending) {
      let doc: any = null;
      try {
        doc = await ProcessedLessonFile.findOneAndUpdate(
          { lesson: file.lessonId, fileKey: file.fileKey },
          {
            $set: {
              course: file.courseId,
              lesson: file.lessonId,
              fileKey: file.fileKey,
              fileType: file.fileType,
              fileSizeMB: 0,
              status: "PROCESSING",
              fileName: path.basename(file.fileKey),
            },
          },
          { upsert: true, new: true }
        );
        console.log(`[processCourseLessons] Processing: ${file.fileKey} (${file.fileType})`);

        const buffer = await downloadFileFromUrl(file.url);
        const fileSizeMB = buffer.length / (1024 * 1024);
        await ProcessedLessonFile.updateOne(
          { _id: doc._id },
          { $set: { fileSizeMB } }
        );

        let allChunks: { text: string; chunkIndex: number }[] = [];
        if (file.fileType === "pdf") {
          const text = await parsePdfText(buffer);
          if (!text || text.length < 10) {
            throw new Error("PDF contained no extractable text");
          }
          const chunks = chunkText(text, 500);
          allChunks = chunks.map((t, i) => ({ text: t, chunkIndex: i }));
        } else {
          const mimeType = getMimeTypeForUrl(file.url);
          const transcript = await transcribeVideoWithGemini(buffer, mimeType);
          if (!transcript || transcript.length < 10) {
            throw new Error("Video/audio produced no or minimal transcript");
          }
          const chunks = chunkText(transcript, 500);
          allChunks = chunks.map((t, i) => ({ text: t, chunkIndex: i }));
        }

        const batchSize = calculateOptimalBatchSize(allChunks.map((c) => ({ text: c.text })), 8000);
        let totalUpserted = 0;
        for (let i = 0; i < allChunks.length; i += batchSize) {
          const batch = allChunks.slice(i, i + batchSize);
          if (i > 0) await new Promise((r) => setTimeout(r, 2000));
          const embeddings = await Promise.all(batch.map((item) => embedText(item.text)));
          const points = batch.map((item, idx) => ({
            id: uuidv4(),
            vector: buildPointVector(embeddings[idx], vectorFormat),
            payload: {
              sourceType: "lesson",
              sourceUrl: file.url,
              s3Key: file.fileKey,
              courseId: file.courseId,
              lessonId: file.lessonId,
              fileName: path.basename(file.fileKey),
              chunkIndex: item.chunkIndex,
              text: item.text,
              processedAt: new Date().toISOString(),
            },
          }));
          await qdrant.upsert(COLLECTION_NAME, { wait: true, points });
          totalUpserted += points.length;
        }

        await ProcessedLessonFile.updateOne(
          { _id: doc._id },
          {
            $set: {
              status: "SUCCESS",
              chunksCount: totalUpserted,
              processedAt: new Date(),
              errorMessage: null,
            },
          }
        );
        console.log(`[processCourseLessons] Done: ${file.fileKey} (${totalUpserted} chunks)`);
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        console.log(`[processCourseLessons] Failed: ${file.fileKey}`, msg);
        courseLessonsJobState.lastError = msg;
        if (doc?._id) {
          await ProcessedLessonFile.updateOne(
            { _id: doc._id },
            {
              $set: {
                status: "FAILED",
                errorMessage: msg,
                processedAt: new Date(),
              },
            }
          );
        } else {
          await ProcessedLessonFile.findOneAndUpdate(
            { lesson: file.lessonId, fileKey: file.fileKey },
            {
              $set: {
                course: file.courseId,
                lesson: file.lessonId,
                fileKey: file.fileKey,
                fileType: file.fileType,
                fileSizeMB: 0,
                status: "FAILED",
                errorMessage: msg,
                processedAt: new Date(),
                fileName: path.basename(file.fileKey),
              },
            },
            { upsert: true }
          );
        }
      }
      courseLessonsJobState.processedCount += 1;
      }
      console.log(`[processCourseLessons] Background job finished`);
    } finally {
      courseLessonsJobState.isRunning = false;
    }
  }

  /** Get course-lessons background processing status (done vs pending). */
  static getCourseLessonsProcessingStatus(_req: Request, res: Response) {
    try {
      const status = courseLessonsJobState.isRunning ? "RUNNING" : "IDLE";
      return res.status(200).json({
        success: true,
        message: status === "RUNNING" ? "Background processing is in progress." : "No background processing in progress.",
        response: {
          status,
          isRunning: courseLessonsJobState.isRunning,
          startedAt: courseLessonsJobState.startedAt?.toISOString() ?? null,
          totalFiles: courseLessonsJobState.totalFiles,
          processedCount: courseLessonsJobState.processedCount,
          lastError: courseLessonsJobState.lastError,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching processing status",
        error: error?.message,
      });
    }
  }

  static async uploadPdf(req: MulterRequest, res: Response) {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({
          success: false,
          message: "No PDF file provided. Please upload a PDF file.",
        });
      }

      const originalName = file.originalname;
      const fileExtension = path.extname(originalName);
      const fileName = path.basename(originalName, fileExtension);
      const uniqueFileName = `${fileName}_${Date.now()}${fileExtension}`;
      const s3Key = `pdf/${uniqueFileName}`;

      await s3.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: s3Key,
          Body: file.buffer,
          ContentType: "application/pdf",
          Metadata: {
            originalName: originalName,
            uploadedAt: new Date().toISOString(),
            uploadedBy: (req.body?.uploadedBy as string) || "system",
          },
        })
      );

      const s3Url = bucketName
        ? `https://${bucketName}.s3.amazonaws.com/${s3Key}`
        : null;

      return res.status(200).json({
        success: true,
        message: "PDF uploaded successfully to S3",
        data: {
          originalName: originalName,
          s3Key: s3Key,
          s3Url: s3Url,
          fileSize: file.size,
          uploadedAt: new Date().toISOString(),
          bucket: bucketName,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error uploading PDF to S3",
        error: error.message,
      });
    }
  }

  static async uploadPdfs(req: MulterRequest, res: Response) {
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) {
        return res.status(400).json({
          success: false,
          message:
            "No PDF files provided. Please upload at least one PDF file.",
        });
      }

      const uploadResults: any[] = [];
      const failedUploads: any[] = [];

      for (const file of files) {
        try {
          const originalName = file.originalname;
          const fileExtension = path.extname(originalName);
          const fileName = path.basename(originalName, fileExtension);
          const uniqueFileName = `${fileName}_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 11)}${fileExtension}`;
          const s3Key = `pdf/${uniqueFileName}`;

          await s3.send(
            new PutObjectCommand({
              Bucket: bucketName,
              Key: s3Key,
              Body: file.buffer,
              ContentType: "application/pdf",
              Metadata: {
                originalName: originalName,
                uploadedAt: new Date().toISOString(),
                uploadedBy: (req.body?.uploadedBy as string) || "system",
              },
            })
          );

          const s3Url = bucketName
            ? `https://${bucketName}.s3.amazonaws.com/${s3Key}`
            : null;

          uploadResults.push({
            originalName: originalName,
            s3Key: s3Key,
            s3Url: s3Url,
            fileSize: file.size,
            uploadedAt: new Date().toISOString(),
          });
        } catch (error: any) {
          failedUploads.push({
            originalName: file.originalname,
            error: error.message,
          });
        }
      }

      return res.status(200).json({
        success: true,
        message: `Upload completed. ${uploadResults.length} files uploaded successfully, ${failedUploads.length} failed.`,
        summary: {
          totalFiles: files.length,
          successfulUploads: uploadResults.length,
          failedUploads: failedUploads.length,
        },
        data: {
          successful: uploadResults,
          failed: failedUploads,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error uploading PDFs to S3",
        error: error.message,
      });
    }
  }

 

  static async query(req: Request, res: Response) {
    try {
      const { question, studentId } = req.body;

      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }

      if (!studentId) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const limitCheck = await checkAiLimits(studentId);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          success: false,
          message: limitCheck.reason,
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage,
            monthlyLimit: limitCheck.monthlyLimit,
          },
        });
      }

      const embeddingVector = await embedText(question);
      const vectorFormat = await resolveVectorFormat();
      const searchResult = await qdrant.search(COLLECTION_NAME, {
        vector: buildSearchVector(embeddingVector, vectorFormat),
        limit: 5,
      });

      const contexts = searchResult.map((point) => point.payload?.text);
      const contextText = contexts.join("\n\n");
      const prompt = buildStrictPrompt(contextText, question);

      const completion = await geminiChatModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const response = completion.response;
      const answer = response.text();

      const usage = response.usageMetadata;
      const promptTokens = usage?.promptTokenCount ?? estimateTokens(prompt);
      const completionTokens =
        usage?.candidatesTokenCount ?? estimateTokens(answer);
      const totalTokens =
        usage?.totalTokenCount ?? promptTokens + completionTokens;

      const aiUsage = new AiUsage({
        student: studentId,
        course: null,
        question,
        answer,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        model: GEMINI_CHAT_MODEL,
        cost_estimate_usd: 0,
      });
      await aiUsage.save();

      return res.status(200).json({
        success: true,
        message: "Gemini AI response generated successfully.",
        response: {
          answer,
          context_used: contexts,
          metadata: {
            totalTokens: totalTokens,
            estimatedCost: 0,
            sources: searchResult.map((point) => ({
              fileName: point.payload?.fileName,
              chunkIndex: point.payload?.chunkIndex,
              score: point.score,
              courseId: point.payload?.courseId,
              lessonId: point.payload?.lessonId,
            })),
          },
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage + 1,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage + 1,
            monthlyLimit: limitCheck.monthlyLimit,
            remainingDaily: limitCheck.remainingDaily - 1,
            remainingMonthly: limitCheck.remainingMonthly - 1,
          },
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "System error during Gemini AI query.",
        error: error.message,
      });
    }
  }

  static async collectionInfo(req: Request, res: Response) {
    try {
      const collectionInfo = (await qdrant.getCollection(
        COLLECTION_NAME
      )) as any;

      return res.status(200).json({
        success: true,
        message: "Collection info retrieved successfully",
        data: {
          name: collectionInfo.name,
          pointsCount: collectionInfo.points_count,
          vectorsCount: collectionInfo.vectors_count,
          status: collectionInfo.status,
          config: collectionInfo.config,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving collection info",
        error: error.message,
      });
    }
  }

  static async deleteCollection(req: Request, res: Response) {
    try {
      await qdrant.deleteCollection(COLLECTION_NAME);

      return res.status(200).json({
        success: true,
        message: `Collection ${COLLECTION_NAME} deleted successfully`,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error deleting collection",
        error: error.message,
      });
    }
  }

  static async testQdrant(req: Request, res: Response) {
    try {
      const collections = await qdrant.getCollections();

      return res.status(200).json({
        success: true,
        message: "Qdrant connection successful",
        data: {
          qdrantUrl: process.env.QDRANT_URL_PROD,
          collections: collections.collections?.map((c: any) => c.name) || [],
          totalCollections: collections.collections?.length || 0,
        },
      });
    } catch (error: any) {
      let errorMessage = "Qdrant connection failed";
      let errorDetails: Record<string, unknown> = {};

      if (error.code === "UND_ERR_CONNECT_TIMEOUT") {
        errorMessage = "Qdrant connection timeout";
        errorDetails = {
          issue: "Connection timeout",
          suggestion: "Check if Qdrant server is running and accessible",
          qdrantUrl: process.env.QDRANT_URL_PROD,
        };
      } else if (error.message?.includes("fetch failed")) {
        errorMessage = "Qdrant server unreachable";
        errorDetails = {
          issue: "Network connectivity issue",
          suggestion: "Check network connection and Qdrant server status",
          qdrantUrl: process.env.QDRANT_URL_PROD,
        };
      } else {
        errorDetails = {
          issue: "Unknown error",
          suggestion: "Check Qdrant server logs",
          error: error.message,
        };
      }

      return res.status(503).json({
        success: false,
        message: errorMessage,
        error: error.message,
        details: errorDetails,
      });
    }
  }

  static async getGlobalLimits(req: Request, res: Response) {
    try {
      let globalLimits = await GlobalAiLimit.findOne({});

      if (!globalLimits) {
        globalLimits = await GlobalAiLimit.create({
          dailyLimit: 10,
          monthlyLimit: 100,
          description: "Default global AI limits",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Global AI limits retrieved successfully",
        data: globalLimits,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving global AI limits",
        error: error.message,
      });
    }
  }

  static async updateGlobalLimits(req: Request, res: Response) {
    try {
      const { dailyLimit, monthlyLimit, description, isActive, updatedBy } =
        req.body;

      if (!dailyLimit || !monthlyLimit) {
        return res.status(400).json({
          success: false,
          message: "dailyLimit and monthlyLimit are required",
        });
      }

      if (dailyLimit < 1 || monthlyLimit < 1) {
        return res.status(400).json({
          success: false,
          message: "Limits must be greater than 0",
        });
      }

      const updateData: Record<string, unknown> = {
        dailyLimit,
        monthlyLimit,
        updatedBy: updatedBy || "admin",
      };

      if (description !== undefined) updateData.description = description;
      if (isActive !== undefined) updateData.isActive = isActive;

      const globalLimits = await GlobalAiLimit.findOneAndUpdate({}, updateData, {
        upsert: true,
        new: true,
      });

      return res.status(200).json({
        success: true,
        message: "Global AI limits updated successfully",
        data: globalLimits,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error updating global AI limits",
        error: error.message,
      });
    }
  }

  static async updateStudentLimits(req: Request, res: Response) {
    try {
      const { studentIds, aiLimit } = req.body;

      if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "studentIds array is required and cannot be empty",
        });
      }

      if (!aiLimit) {
        return res.status(400).json({
          success: false,
          message: "aiLimit object is required",
        });
      }

      if (aiLimit.dailyLimit !== undefined && aiLimit.dailyLimit < 1) {
        return res.status(400).json({
          success: false,
          message: "dailyLimit must be greater than 0",
        });
      }

      if (aiLimit.monthlyLimit !== undefined && aiLimit.monthlyLimit < 1) {
        return res.status(400).json({
          success: false,
          message: "monthlyLimit must be greater than 0",
        });
      }

      const updateResults: any[] = [];
      const failedUpdates: any[] = [];

      for (const studentId of studentIds) {
        try {
          const user = await User.findById(studentId);
          if (!user) {
            failedUpdates.push({
              studentId,
              error: "User not found",
            });
            continue;
          }

          const updatedUser = await User.findByIdAndUpdate(
            studentId,
            {
              $set: {
                ai_limit: {
                  ...user.ai_limit,
                  ...aiLimit,
                },
              },
            },
            { new: true }
          );

          updateResults.push({
            studentId,
            email: updatedUser.email,
            firstname: updatedUser.firstname,
            lastname: updatedUser.lastname,
            aiLimit: updatedUser.ai_limit,
          });
        } catch (error: any) {
          failedUpdates.push({
            studentId,
            error: error.message,
          });
        }
      }

      return res.status(200).json({
        success: true,
        message: `AI limits update completed. ${updateResults.length} users updated successfully, ${failedUpdates.length} failed.`,
        summary: {
          totalStudents: studentIds.length,
          successfulUpdates: updateResults.length,
          failedUpdates: failedUpdates.length,
        },
        data: {
          successful: updateResults,
          failed: failedUpdates,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error updating student AI limits",
        error: error.message,
      });
    }
  }

  static async allStudentsUsage(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const search = (req.query.search as string) || "";
      const skip = (page - 1) * limit;

      if (page < 1) {
        return res.status(400).json({
          success: false,
          message: "Page number must be greater than 0",
        });
      }

      let globalLimits = await GlobalAiLimit.findOne({});
      if (!globalLimits) {
        globalLimits = {
          dailyLimit: 10,
          monthlyLimit: 100,
        } as any;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      );

      const monthlyUsageAgg = await AiUsage.aggregate([
        {
          $match: {
            createdAt: { $gte: startOfMonth, $lte: endOfMonth },
          },
        },
        {
          $group: {
            _id: "$student",
            count: { $sum: 1 },
          },
        },
      ]);

      const studentIdsWithUsage = monthlyUsageAgg.map((item) => item._id);

      if (studentIdsWithUsage.length === 0) {
        return res.status(200).json({
          success: true,
          message: "No students used AI this month",
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false,
          },
          data: [],
          summary: {
            globalLimits: globalLimits,
            totalStudents: 0,
            studentsWithCustomLimits: 0,
            studentsUsingGlobalLimits: 0,
          },
        });
      }

      const userQuery: Record<string, any> = {
        _id: { $in: studentIdsWithUsage },
      };

      if (search) {
        userQuery.$or = [
          { email: { $regex: search, $options: "i" } },
          { firstname: { $regex: search, $options: "i" } },
          { lastname: { $regex: search, $options: "i" } },
          {
            $expr: {
              $regexMatch: {
                input: { $concat: ["$firstname", " ", "$lastname"] },
                regex: search,
                options: "i",
              },
            },
          },
        ];
      }

      const totalUsers = await User.countDocuments(userQuery);

      const users = await User.find(userQuery)
        .select("_id email firstname lastname image ai_limit createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const userIds = users.map((user: any) => user._id);

      const dailyUsageAgg = await AiUsage.aggregate([
        {
          $match: {
            student: { $in: userIds },
            createdAt: { $gte: today, $lt: tomorrow },
          },
        },
        {
          $group: {
            _id: "$student",
            count: { $sum: 1 },
          },
        },
      ]);

      const monthlyUsageAggPage = await AiUsage.aggregate([
        {
          $match: {
            student: { $in: userIds },
            createdAt: { $gte: startOfMonth, $lte: endOfMonth },
          },
        },
        {
          $group: {
            _id: "$student",
            count: { $sum: 1 },
          },
        },
      ]);

      const totalUsageAgg = await AiUsage.aggregate([
        {
          $match: {
            student: { $in: userIds },
          },
        },
        {
          $group: {
            _id: "$student",
            count: { $sum: 1 },
          },
        },
      ]);

      const dailyUsageMap: Record<string, number> = {};
      dailyUsageAgg.forEach((item) => {
        dailyUsageMap[item._id.toString()] = item.count;
      });

      const monthlyUsageMap: Record<string, number> = {};
      monthlyUsageAggPage.forEach((item) => {
        monthlyUsageMap[item._id.toString()] = item.count;
      });

      const totalUsageMap: Record<string, number> = {};
      totalUsageAgg.forEach((item) => {
        totalUsageMap[item._id.toString()] = item.count;
      });

      const studentsWithUsage = users.map((user: any) => {
        const dailyLimit = user.ai_limit?.dailyLimit || globalLimits.dailyLimit;
        const monthlyLimit =
          user.ai_limit?.monthlyLimit || globalLimits.monthlyLimit;

        const dailyUsage = dailyUsageMap[user._id.toString()] || 0;
        const monthlyUsage = monthlyUsageMap[user._id.toString()] || 0;
        const totalUsage = totalUsageMap[user._id.toString()] || 0;

        return {
          student: {
            id: user._id,
            email: user.email,
            firstname: user.firstname,
            lastname: user.lastname,
            image: user.image,
            aiLimit: user.ai_limit,
            createdAt: user.createdAt,
          },
          usage: {
            daily: {
              used: dailyUsage,
              limit: dailyLimit,
              remaining: Math.max(0, dailyLimit - dailyUsage),
              percentage:
                dailyLimit > 0
                  ? Math.round((dailyUsage / dailyLimit) * 100)
                  : 0,
            },
            monthly: {
              used: monthlyUsage,
              limit: monthlyLimit,
              remaining: Math.max(0, monthlyLimit - monthlyUsage),
              percentage:
                monthlyLimit > 0
                  ? Math.round((monthlyUsage / monthlyLimit) * 100)
                  : 0,
            },
            total: totalUsage,
          },
          limits: {
            isUsingGlobalLimits:
              !user.ai_limit?.dailyLimit && !user.ai_limit?.monthlyLimit,
          },
        };
      });

      const totalPages = Math.ceil(totalUsers / limit);

      return res.status(200).json({
        success: true,
        message: "All students AI usage retrieved successfully",
        pagination: {
          page,
          limit,
          total: totalUsers,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        data: studentsWithUsage,
        summary: {
          globalLimits: globalLimits,
          totalStudents: totalUsers,
          studentsWithCustomLimits: studentsWithUsage.filter(
            (s) => !s.limits.isUsingGlobalLimits
          ).length,
          studentsUsingGlobalLimits: studentsWithUsage.filter(
            (s) => s.limits.isUsingGlobalLimits
          ).length,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving all students AI usage",
        error: error.message,
      });
    }
  }

  static async studentUsage(req: Request, res: Response) {
    try {
      const { studentId } = req.params;

      if (!studentId) {
        return res.status(400).json({
          success: false,
          message: "studentId is required",
        });
      }

      const user = await User.findById(studentId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      let globalLimits = await GlobalAiLimit.findOne({});
      if (!globalLimits) {
        globalLimits = {
          dailyLimit: 10,
          monthlyLimit: 100,
        } as any;
      }

      const dailyLimit = user.ai_limit?.dailyLimit || globalLimits.dailyLimit;
      const monthlyLimit =
        user.ai_limit?.monthlyLimit || globalLimits.monthlyLimit;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      );

      const [dailyUsage, monthlyUsage, totalUsage] = await Promise.all([
        AiUsage.countDocuments({
          student: studentId,
          createdAt: { $gte: today, $lt: tomorrow },
        }),
        AiUsage.countDocuments({
          student: studentId,
          createdAt: { $gte: startOfMonth, $lte: endOfMonth },
        }),
        AiUsage.countDocuments({ student: studentId }),
      ]);

      return res.status(200).json({
        success: true,
        message: "Student AI usage retrieved successfully",
        data: {
          student: {
            id: user._id,
            email: user.email,
            firstname: user.firstname,
            lastname: user.lastname,
            aiLimit: user.ai_limit,
          },
          usage: {
            daily: {
              used: dailyUsage,
              limit: dailyLimit,
              remaining: Math.max(0, dailyLimit - dailyUsage),
            },
            monthly: {
              used: monthlyUsage,
              limit: monthlyLimit,
              remaining: Math.max(0, monthlyLimit - monthlyUsage),
            },
            total: totalUsage,
          },
          limits: {
            isUsingGlobalLimits:
              !user.ai_limit?.dailyLimit && !user.ai_limit?.monthlyLimit,
            globalLimits: globalLimits,
          },
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving student AI usage",
        error: error.message,
      });
    }
  }

  static async history(req: Request, res: Response) {
    try {
      const { startDate, endDate, studentId } = req.query as {
        startDate?: string;
        endDate?: string;
        studentId?: string;
      };

      if (!studentId) {
        return res.status(400).json({
          success: false,
          message: "studentId cannot be empty",
        });
      }

      const start = startDate
        ? new Date(startDate)
        : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const end = endDate ? new Date(endDate) : new Date();

      const match = {
        createdAt: { $gte: start, $lte: end },
        student: new mongoose.Types.ObjectId(studentId),
      };

      const aggregation = await AiUsage.find(match);

      return res.status(200).json({
        success: true,
        message: "AI usage report generated successfully",
        response: aggregation,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error generating AI usage report",
        error: error.message,
      });
    }
  }
}
