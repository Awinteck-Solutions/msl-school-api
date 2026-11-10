import { Request, Response } from "express";
import mongoose from "mongoose";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { uploadFile } from "../../../helpers/s3";
import { s3, bucketName } from "../../geminiAi/controllers/geminiAi.shared";
import Category from "../../category/schema/category.schema";
import {
  PastQuestionProcessStatus,
  PastQuestionStatus,
} from "../enums/pastQuestion.enum";
import PastQuestionInsight from "../schema/pastQuestionInsight.schema";
import PastQuestionItem from "../schema/pastQuestionItem.schema";
import PastQuestionPaper from "../schema/pastQuestionPaper.schema";
import {
  buildBrowseTree,
  buildPastQuestionAnalytics,
  deletePastQuestionVectors,
  findPapersNeedingFormat,
  getReformatJobState,
  processPastQuestionPaper,
  reformatPaperFromPdf,
  startReformatJob,
  publicFileUrl,
  replacePaperQuestions,
  serializePaper,
} from "./pastQuestion.service";

interface MulterRequest extends Request {
  file?: multer.File;
}

const processing = new Set<string>();

export class AdminPastQuestionV2Controller {
  static async create(req: MulterRequest, res: Response) {
    try {
      const {
        categoryId,
        year,
        sitting,
        level,
        title,
        paperCode,
      } = req.body as Record<string, string>;
      const file = req.file;
      if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({
          status: false,
          message: "Valid categoryId is required",
        });
      }
      if (!year || !level || !title) {
        return res.status(400).json({
          status: false,
          message: "year, level, and title are required",
        });
      }
      if (!file) {
        return res.status(400).json({
          status: false,
          message: "PDF file is required",
        });
      }
      const category = await Category.findById(categoryId).lean();
      if (!category) {
        return res.status(404).json({ status: false, message: "Category not found" });
      }

      const original = file.originalname.replace(/\s+/g, "_");
      const uploaded = await uploadFile(
        {
          buffer: file.buffer,
          originalname: `${uuidv4()}_${original}`,
        },
        "past-questions"
      );
      const currentUser = req["currentUser"] as { email?: string } | undefined;
      const paper = await PastQuestionPaper.create({
        categoryId,
        year: Number(year),
        sitting: sitting || "",
        level: String(level).trim(),
        title: title.trim(),
        paperCode: (paperCode || "").trim(),
        fileKey: uploaded.key,
        fileName: file.originalname,
        fileUrl: publicFileUrl(uploaded.key),
        fileSizeMB: Number((file.size / (1024 * 1024)).toFixed(2)),
        processStatus: PastQuestionProcessStatus.PENDING,
        uploadedBy: currentUser?.email || "admin",
      });

      const id = String(paper._id);
      processing.add(id);
      setImmediate(() => {
        processPastQuestionPaper(id)
          .catch((error) => {
            console.warn("[past-questions] process failed", error?.message || error);
          })
          .finally(() => processing.delete(id));
      });

      return res.status(201).json({
        status: true,
        message: "Past question uploaded. Extraction is running.",
        response: serializePaper(paper),
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to create past question",
        error: error?.message || error,
      });
    }
  }

  static async insightAnalytics(req: Request, res: Response) {
    try {
      const { categoryId } = req.query as Record<string, string>;
      const response = await buildPastQuestionAnalytics({
        admin: true,
        categoryId,
      });
      return res.status(200).json({
        status: true,
        message: "Past question insight analytics",
        response,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to build insight analytics",
        error: error?.message || error,
      });
    }
  }

  static async list(req: Request, res: Response) {
    try {
      const { categoryId, year, level, processStatus } = req.query as Record<
        string,
        string
      >;
      const filter: Record<string, unknown> = {};
      if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
        filter.categoryId = new mongoose.Types.ObjectId(categoryId);
      }
      if (year) filter.year = Number(year);
      if (level) filter.level = level;
      if (processStatus) filter.processStatus = processStatus;
      const papers = await PastQuestionPaper.find(filter)
        .populate({ path: "categoryId", select: "name status" })
        .sort({ year: -1, sitting: 1, level: 1, title: 1 })
        .lean();
      return res.status(200).json({
        status: true,
        message: "Past questions fetched",
        response: buildBrowseTree(papers),
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to list past questions",
        error: error?.message || error,
      });
    }
  }

  static async getOne(req: Request, res: Response) {
    try {
      const id = String(req.params.id || "");
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid id" });
      }
      const paper = await PastQuestionPaper.findById(id)
        .populate({ path: "categoryId", select: "name status" })
        .lean();
      if (!paper) {
        return res.status(404).json({ status: false, message: "Paper not found" });
      }
      const questions = await PastQuestionItem.find({ paper: paper._id })
        .sort({ order: 1 })
        .lean();
      return res.status(200).json({
        status: true,
        message: "Past question fetched",
        response: { ...serializePaper(paper), questions },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch past question",
        error: error?.message || error,
      });
    }
  }

  static async update(req: Request, res: Response) {
    try {
      const id = String(req.params.id || "");
      const body = req.body || {};
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid id" });
      }
      const paper = await PastQuestionPaper.findById(id);
      if (!paper) {
        return res.status(404).json({ status: false, message: "Paper not found" });
      }
      if (body.title !== undefined) paper.title = String(body.title).trim();
      if (body.paperCode !== undefined) paper.paperCode = String(body.paperCode).trim();
      if (body.sitting !== undefined) paper.sitting = String(body.sitting).trim();
      if (body.level !== undefined) paper.level = String(body.level).trim();
      if (body.year !== undefined) paper.year = Number(body.year);
      if (body.categoryId && mongoose.Types.ObjectId.isValid(body.categoryId)) {
        paper.categoryId = body.categoryId;
      }
      if (body.status === PastQuestionStatus.ACTIVE || body.status === PastQuestionStatus.DEACTIVE) {
        paper.status = body.status;
      }
      await paper.save();
      return res.status(200).json({
        status: true,
        message: "Past question updated",
        response: serializePaper(paper),
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to update past question",
        error: error?.message || error,
      });
    }
  }

  static async updateQuestions(req: Request, res: Response) {
    try {
      const id = String(req.params.id || "");
      const questions = Array.isArray(req.body?.questions) ? req.body.questions : [];
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid id" });
      }
      if (!questions.length) {
        return res.status(400).json({
          status: false,
          message: "questions array is required",
        });
      }
      const result = await replacePaperQuestions(id, questions);
      return res.status(200).json({
        status: true,
        message: "Questions updated. Insights regenerated.",
        response: {
          ...serializePaper(result.paper),
          questions: result.items,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to update questions",
        error: error?.message || error,
      });
    }
  }

  static async process(req: Request, res: Response) {
    try {
      const id = String(req.params.id || "");
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid id" });
      }
      if (processing.has(id)) {
        return res.status(202).json({
          status: true,
          message: "Extraction already running",
        });
      }
      processing.add(id);
      try {
        const paper = await processPastQuestionPaper(id);
        return res.status(200).json({
          status: true,
          message: "Past question processed",
          response: serializePaper(paper),
        });
      } finally {
        processing.delete(id);
      }
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to process past question",
        error: error?.message || error,
      });
    }
  }

  /** Re-read one paper's PDF and keep its tables, lists and formatting as HTML. */
  static async reformat(req: Request, res: Response) {
    try {
      const id = String(req.params.id || "");
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid id" });
      }
      const result = await reformatPaperFromPdf(id, { syncPlain: Boolean(req.body?.syncPlain) });
      const items = await PastQuestionItem.find({ paper: id }).sort({ order: 1 }).lean();
      return res.status(200).json({
        status: true,
        message: `Formatting kept for ${result.updated} of ${result.total} questions`,
        response: { ...result, questions: items },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: error?.message || "Failed to re-read the PDF",
        error: error?.message || error,
      });
    }
  }

  /** Background run over every paper that still has plain-text questions. */
  static async reformatAll(req: Request, res: Response) {
    try {
      const body = (req.body || {}) as { onlyUnformatted?: boolean; syncPlain?: boolean; concurrency?: number };
      const { started, total } = await startReformatJob({
        onlyUnformatted: body.onlyUnformatted !== false,
        syncPlain: Boolean(body.syncPlain),
        concurrency: Number(body.concurrency) || 3,
      });
      return res.status(started ? 202 : 409).json({
        status: started,
        message: started
          ? `Re-reading ${total} paper${total === 1 ? "" : "s"} in the background`
          : "A run is already in progress",
        response: getReformatJobState(),
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to start the run",
        error: error?.message || error,
      });
    }
  }

  static async reformatStatus(_req: Request, res: Response) {
    try {
      const [pending, formatted] = await Promise.all([
        findPapersNeedingFormat(),
        PastQuestionItem.countDocuments({ formatVersion: 1 }),
      ]);
      return res.status(200).json({
        status: true,
        message: "Status fetched",
        response: { ...getReformatJobState(), papersPending: pending.length, questionsFormatted: formatted },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to read status",
        error: error?.message || error,
      });
    }
  }

  /** Remove Qdrant vectors for a paper without deleting the paper itself. */
  static async deleteEmbeddings(req: Request, res: Response) {
    try {
      const id = String(req.params.id || "");
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid id" });
      }
      const paper = await PastQuestionPaper.findById(id).lean();
      if (!paper) {
        return res.status(404).json({ status: false, message: "Paper not found" });
      }

      await deletePastQuestionVectors(id);

      return res.status(200).json({
        status: true,
        message: "Past question embeddings deleted from Qdrant",
        response: { paperId: id },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to delete past question embeddings",
        error: error?.message || error,
      });
    }
  }

  static async remove(req: Request, res: Response) {
    try {
      const id = String(req.params.id || "");
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid id" });
      }
      const paper = await PastQuestionPaper.findById(id);
      if (!paper) {
        return res.status(404).json({ status: false, message: "Paper not found" });
      }
      await deletePastQuestionVectors(id).catch(() => {});
      if (paper.fileKey) {
        await s3
          .send(new DeleteObjectCommand({ Bucket: bucketName, Key: paper.fileKey }))
          .catch(() => {});
      }
      await PastQuestionItem.deleteMany({ paper: paper._id });
      await PastQuestionInsight.deleteMany({ paper: paper._id });
      await PastQuestionPaper.deleteOne({ _id: paper._id });
      return res.status(200).json({
        status: true,
        message: "Past question deleted",
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to delete past question",
        error: error?.message || error,
      });
    }
  }
}
