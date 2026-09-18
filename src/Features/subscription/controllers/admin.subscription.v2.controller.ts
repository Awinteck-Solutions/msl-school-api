import { Request, Response } from "express";
import mongoose from "mongoose";
import * as path from "path";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { uploadFile } from "../../../helpers/s3";
import {
  SUBSCRIPTION_COLLECTION_NAME,
  bucketName,
  buildContentFilter,
  buildPointVector,
  calculateOptimalBatchSize,
  checkSubscriptionAiLimits,
  chunkText,
  downloadFileFromUrl,
  embedText,
  ensurePayloadIndexesForGeminiCollection,
  ensureQdrantCollection,
  getFileNameFromUrl,
  getMimeTypeForUrl,
  handleQdrantOperation,
  inferSourceTypeFromUrl,
  LESSON_FILES_BASE_URL,
  parsePdfText,
  qdrant,
  resolveVectorFormat,
  s3,
  transcribeVideoWithGemini,
} from "../../geminiAi/controllers/geminiAi.shared";
import {
  getOrCreateSubscriptionPlan,
  publicPlanPayload,
  serializeSubscription,
} from "./subscription.service";
import {
  SubscriptionContentStatus,
  SubscriptionResourceFileStatus,
  SubscriptionResourceType,
  SubscriptionStatus,
} from "../enums/subscription.enum";
import Subscription from "../schema/subscription.schema";
import SubscriptionInvoice from "../schema/subscriptionInvoice.schema";
import SubscriptionResource from "../schema/subscriptionResource.schema";
import SubscriptionResourceFile from "../schema/subscriptionResourceFile.schema";
import AiUsage from "../../mslAi/schema/aiUsage.schema";
import User from "../../user/schema/user.schema";

interface MulterRequest extends Request {
  file?: multer.File;
  files?: multer.File[] | { [fieldname: string]: multer.File[] };
}

const resourceJobState = {
  isRunning: false,
  startedAt: null as Date | null,
  totalFiles: 0,
  processedCount: 0,
  lastError: null as string | null,
};

const publicFileUrl = (fileKey: string) => {
  const base = (LESSON_FILES_BASE_URL || "").replace(/\/$/, "");
  if (fileKey.startsWith("http://") || fileKey.startsWith("https://")) return fileKey;
  return base ? `${base}/${fileKey}` : fileKey;
};

const extractS3Key = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^\//, "");
  }
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    const isOurBucket =
      Boolean(bucketName && host.startsWith(`${bucketName}.s3`.toLowerCase())) ||
      host.includes("amazonaws.com");
    if (!isOurBucket) return null;
    return decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
};

const listS3KeysWithPrefix = async (prefix: string): Promise<string[]> => {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const object of listed.Contents || []) {
      if (object.Key) keys.push(object.Key);
    }
    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return keys;
};

const deleteS3Keys = async (keys: Array<string | null | undefined>) => {
  const uniqueKeys = Array.from(
    new Set(keys.map((key) => extractS3Key(key)).filter(Boolean) as string[])
  );
  const result = {
    success: true,
    deletedKeys: [] as string[],
    failedKeys: [] as { key: string; error: string }[],
  };

  for (const key of uniqueKeys) {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: key,
        })
      );
      result.deletedKeys.push(key);
    } catch (error: any) {
      result.success = false;
      result.failedKeys.push({
        key,
        error: error?.message || String(error),
      });
    }
  }

  return result;
};

const deleteSubscriptionQdrantPoints = async (options: {
  resourceId?: string;
  s3Keys?: string[];
}): Promise<{ success: boolean; deletedPoints: number; error?: string }> => {
  const filter = buildContentFilter({
    resourceId: options.resourceId,
    s3Keys: options.s3Keys,
  });
  if (!filter) {
    return { success: true, deletedPoints: 0 };
  }

  try {
    const collections = (await handleQdrantOperation(
      async () => qdrant.getCollections(),
      "subscription collection lookup"
    )) as { collections?: { name: string }[] };

    const exists = Boolean(
      collections?.collections?.some(
        (col) => col.name === SUBSCRIPTION_COLLECTION_NAME
      )
    );
    if (!exists) {
      return { success: true, deletedPoints: 0 };
    }

    await ensurePayloadIndexesForGeminiCollection(SUBSCRIPTION_COLLECTION_NAME);

    const countRes = (await handleQdrantOperation(
      async () =>
        qdrant.count(SUBSCRIPTION_COLLECTION_NAME, {
          exact: true,
          filter: filter as any,
        }),
      "subscription qdrant count"
    )) as { count?: number };

    const deletedPoints = Number(countRes?.count || 0);
    if (deletedPoints > 0) {
      await handleQdrantOperation(
        async () =>
          qdrant.delete(SUBSCRIPTION_COLLECTION_NAME, {
            wait: true,
            filter: filter as any,
          }),
        "subscription qdrant delete"
      );
    }

    return { success: true, deletedPoints };
  } catch (error: any) {
    return {
      success: false,
      deletedPoints: 0,
      error:
        error?.data?.status?.error ||
        error?.message ||
        String(error),
    };
  }
};

export class AdminSubscriptionV2Controller {
  static async getPlan(req: Request, res: Response) {
    try {
      const plan = await getOrCreateSubscriptionPlan();
      return res.status(200).json({
        status: true,
        message: "Subscription plan fetched",
        response: plan,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch plan",
        error: error?.message || error,
      });
    }
  }

  static async updatePlan(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as { email?: string } | undefined;
      const body = (req.body || {}) as Record<string, unknown>;
      const plan = await getOrCreateSubscriptionPlan();

      const numericFields = [
        "amount",
        "intervalDays",
        "gracePeriodDays",
        "reminderDaysBeforeExpiry",
        "dailyAiLimit",
        "monthlyAiLimit",
      ] as const;

      for (const field of numericFields) {
        if (body[field] === undefined) continue;
        const value = Number(body[field]);
        if (!Number.isFinite(value) || value < 0) {
          return res.status(400).json({
            status: false,
            message: `${field} must be a valid number`,
          });
        }
        if (
          (field === "dailyAiLimit" ||
            field === "monthlyAiLimit" ||
            field === "intervalDays") &&
          value < 1
        ) {
          return res.status(400).json({
            status: false,
            message: `${field} must be greater than 0`,
          });
        }
        (plan as any)[field] = value;
      }

      if (typeof body.currency === "string" && body.currency.trim()) {
        plan.currency = body.currency.trim().toUpperCase();
      }
      if (typeof body.description === "string") {
        plan.description = body.description;
      }
      if (typeof body.isActive === "boolean") {
        plan.isActive = body.isActive;
      }
      plan.updatedBy = currentUser?.email || "admin";
      await plan.save();

      return res.status(200).json({
        status: true,
        message: "Subscription plan updated",
        response: plan,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to update plan",
        error: error?.message || error,
      });
    }
  }

  static async listSubscriptions(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;
      const status = (req.query.status as string) || "";
      const email = (req.query.email as string) || "";
      const userId = (req.query.userId as string) || "";

      const filter: Record<string, any> = {};
      if (status) filter.status = status;
      if (email) filter.email = { $regex: email.trim(), $options: "i" };
      if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        filter.userId = new mongoose.Types.ObjectId(userId);
      }

      const [items, total] = await Promise.all([
        Subscription.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate({
            path: "userId",
            select: "firstname lastname email role status",
          })
          .lean(),
        Subscription.countDocuments(filter),
      ]);
      const totalPages = Math.ceil(total / limit);

      return res.status(200).json({
        status: true,
        message: "Subscriptions fetched",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        response: items.map((item: any) => ({
          ...item,
          hasAccess: serializeSubscription(item)?.hasAccess,
        })),
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch subscriptions",
        error: error?.message || error,
      });
    }
  }

  static async listInvoices(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;
      const status = (req.query.status as string) || "";
      const email = (req.query.email as string) || "";
      const userId = (req.query.userId as string) || "";

      const filter: Record<string, any> = {};
      if (status) filter.status = status;
      if (email) filter.email = { $regex: email.trim(), $options: "i" };
      if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        filter.userId = new mongoose.Types.ObjectId(userId);
      }

      const [items, total] = await Promise.all([
        SubscriptionInvoice.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        SubscriptionInvoice.countDocuments(filter),
      ]);
      const totalPages = Math.ceil(total / limit);

      return res.status(200).json({
        status: true,
        message: "Invoices fetched",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        response: items,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch invoices",
        error: error?.message || error,
      });
    }
  }

  static async createResource(req: MulterRequest, res: Response) {
    try {
      const { title, desc, category, status } = req.body as {
        title?: string;
        desc?: string;
        category?: string;
        status?: string;
      };
      const authorId = req["currentUser"]?._id;
      if (!title) {
        return res.status(400).json({
          status: false,
          message: "title is required",
        });
      }

      const file = req.file;
      const thumbnail = file
        ? (await uploadFile(file, "subscription-ai")).key
        : null;

      const resource = await SubscriptionResource.create({
        title,
        description: desc || null,
        thumbnail,
        category: category || null,
        categoryId:
          category && mongoose.Types.ObjectId.isValid(category)
            ? category
            : undefined,
        status:
          status === SubscriptionContentStatus.DEACTIVE
            ? SubscriptionContentStatus.DEACTIVE
            : SubscriptionContentStatus.ACTIVE,
        authorId,
      });

      return res.status(201).json({
        status: true,
        message: "New subscription resource added",
        response: resource,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to create resource",
        error: error?.message || error,
      });
    }
  }

  static async updateResource(req: Request, res: Response) {
    try {
      const { id, title, desc, link, price, category, status } = req.body as {
        id?: string;
        title?: string;
        desc?: string;
        link?: string;
        price?: string;
        category?: string;
        status?: string;
      };
      if (!id || !title || !status) {
        return res.status(400).json({
          status: false,
          message: "id, title, and status are required",
        });
      }
      const updated = await SubscriptionResource.findOneAndUpdate(
        { _id: id },
        {
          title,
          description: desc || null,
          link: link || null,
          price: price || null,
          category: category || null,
          categoryId:
            category && mongoose.Types.ObjectId.isValid(category)
              ? category
              : undefined,
          status,
        },
        { new: true }
      );
      if (!updated) {
        return res.status(404).json({ status: false, message: "Resource not found" });
      }
      return res.status(200).json({
        status: true,
        message: "Subscription resource updated",
        response: updated,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to update resource",
        error: error?.message || error,
      });
    }
  }

  static async updateResourceThumbnail(req: MulterRequest, res: Response) {
    try {
      const { id } = req.body as { id?: string };
      const file = req.file;
      if (!id || !file) {
        return res.status(400).json({
          status: false,
          message: "id and image file are required",
        });
      }
      const uploaded = await uploadFile(file, "subscription-ai");
      const updated = await SubscriptionResource.findOneAndUpdate(
        { _id: id },
        { thumbnail: uploaded.key },
        { new: true }
      );
      if (!updated) {
        return res.status(404).json({ status: false, message: "Resource not found" });
      }
      return res.status(200).json({
        status: true,
        message: "Thumbnail updated",
        response: updated,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to update thumbnail",
        error: error?.message || error,
      });
    }
  }

  static async getResource(req: Request, res: Response) {
    try {
      const { id } = req.params as { id?: string };
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid resource id" });
      }
      const resource = await SubscriptionResource.findById(id)
        .populate({ path: "categoryId", select: "name status" })
        .lean();
      if (!resource) {
        return res.status(404).json({ status: false, message: "Resource not found" });
      }
      const files = await SubscriptionResourceFile.find({ resource: id })
        .sort({ createdAt: -1 })
        .lean();
      return res.status(200).json({
        status: true,
        message: "Resource fetched",
        response: { ...resource, files },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch resource",
        error: error?.message || error,
      });
    }
  }

  static async deleteResource(req: Request, res: Response) {
    try {
      const { id } = req.params as { id?: string };
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid resource id" });
      }

      const [resource, files] = await Promise.all([
        SubscriptionResource.findById(id),
        SubscriptionResourceFile.find({ resource: id }).lean(),
      ]);

      let prefixKeys: string[] = [];
      try {
        prefixKeys = await listS3KeysWithPrefix(`subscription-ai/${id}/`);
      } catch (error: any) {
        prefixKeys = [];
        console.error(
          "[subscription-ai] failed to list S3 prefix",
          `subscription-ai/${id}/`,
          error
        );
      }

      const qdrantResult = await deleteSubscriptionQdrantPoints({ resourceId: id });
      const s3Result = await deleteS3Keys([
        resource?.thumbnail,
        ...files.map((file) => file.fileKey),
        ...prefixKeys,
      ]);

      if (resource) {
        await SubscriptionResource.deleteOne({ _id: id });
      }
      await SubscriptionResourceFile.deleteMany({ resource: id });

      if (!resource && files.length === 0 && qdrantResult.deletedPoints === 0 && s3Result.deletedKeys.length === 0) {
        return res.status(404).json({
          status: false,
          message: "Resource not found",
          qdrant: qdrantResult,
          s3: s3Result,
        });
      }

      const overallSuccess = qdrantResult.success && s3Result.success;
      return res.status(overallSuccess ? 200 : 207).json({
        status: overallSuccess,
        message: overallSuccess
          ? "Resource deleted from database, S3, and Qdrant"
          : "Resource deleted from database, but S3 or Qdrant cleanup failed",
        response: {
          resourceId: id,
          filesRemoved: files.length,
          qdrant: qdrantResult,
          s3: s3Result,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to delete resource",
        error: error?.message || error,
      });
    }
  }

  static async deleteResourceFile(req: Request, res: Response) {
    try {
      const { id, fileId } = req.params as { id?: string; fileId?: string };
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid resource id" });
      }
      if (!fileId || !mongoose.Types.ObjectId.isValid(fileId)) {
        return res.status(400).json({ status: false, message: "Invalid file id" });
      }

      const file = await SubscriptionResourceFile.findOne({
        _id: fileId,
        resource: id,
      });
      if (!file) {
        return res.status(404).json({ status: false, message: "File not found" });
      }

      const qdrantResult = await deleteSubscriptionQdrantPoints({
        resourceId: id,
        s3Keys: [file.fileKey],
      });
      const s3Result = await deleteS3Keys([file.fileKey]);

      await SubscriptionResourceFile.deleteOne({ _id: file._id });

      const overallSuccess = qdrantResult.success && s3Result.success;
      return res.status(overallSuccess ? 200 : 207).json({
        status: overallSuccess,
        message: overallSuccess
          ? "File deleted from database, S3, and Qdrant"
          : "File deleted from database, but S3 or Qdrant cleanup failed",
        response: {
          resourceId: id,
          fileId,
          fileKey: file.fileKey,
          fileType: file.fileType,
          qdrant: qdrantResult,
          s3: s3Result,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to delete file",
        error: error?.message || error,
      });
    }
  }

  static async uploadResourceFiles(req: MulterRequest, res: Response) {
    try {
      const { id } = req.params as { id?: string };
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid resource id" });
      }
      const resource = await SubscriptionResource.findById(id);
      if (!resource) {
        return res.status(404).json({ status: false, message: "Resource not found" });
      }

      const files = Array.isArray(req.files)
        ? req.files
        : req.file
        ? [req.file]
        : [];
      if (!files.length) {
        return res.status(400).json({
          status: false,
          message: "Upload at least one PDF or video file",
        });
      }

      const uploaded = [];
      for (const file of files) {
        const originalName = file.originalname;
        const ext = path.extname(originalName).toLowerCase();
        const fileType =
          ext === ".pdf"
            ? SubscriptionResourceType.PDF
            : SubscriptionResourceType.VIDEO;
        const uniqueFileName = `${path.basename(originalName, ext)}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}${ext}`;
        const folder = fileType === SubscriptionResourceType.PDF ? "pdf" : "video";
        const fileKey = `subscription-ai/${id}/${folder}/${uniqueFileName}`;

        await s3.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: fileKey,
            Body: file.buffer,
            ContentType: file.mimetype,
            Metadata: {
              originalName,
              uploadedAt: new Date().toISOString(),
            },
          })
        );

        const saved = await SubscriptionResourceFile.create({
          resource: id,
          fileKey,
          fileName: originalName,
          fileType,
          fileSizeMB: file.size / (1024 * 1024),
          url: publicFileUrl(fileKey),
          status: SubscriptionResourceFileStatus.PENDING,
          uploadedBy:
            (req["currentUser"] as { email?: string } | undefined)?.email ||
            "admin",
        });
        uploaded.push(saved);
      }

      return res.status(200).json({
        status: true,
        message: "Files uploaded",
        response: uploaded,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to upload files",
        error: error?.message || error,
      });
    }
  }

  static async listResources(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;
      const status = (req.query.status as string) || "";
      const filter: Record<string, any> = {};
      if (status) filter.status = status;

      const [items, total] = await Promise.all([
        SubscriptionResource.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate({ path: "categoryId", select: "name status" })
          .lean(),
        SubscriptionResource.countDocuments(filter),
      ]);
      const resourceIds = items.map((item: any) => item._id);
      const files = await SubscriptionResourceFile.find({
        resource: { $in: resourceIds },
      })
        .sort({ createdAt: -1 })
        .lean();
      const filesByResource = new Map<string, any[]>();
      for (const file of files) {
        const key = String(file.resource);
        const list = filesByResource.get(key) || [];
        list.push(file);
        filesByResource.set(key, list);
      }
      const totalPages = Math.ceil(total / limit);

      return res.status(200).json({
        status: true,
        message: "Resources fetched",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        response: items.map((item: any) => ({
          ...item,
          files: filesByResource.get(String(item._id)) || [],
        })),
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch resources",
        error: error?.message || error,
      });
    }
  }

  static async processFromUrl(req: Request, res: Response) {
    try {
      const { id } = req.params as { id?: string };
      const { sourceUrl } = req.body as { sourceUrl?: string };
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid resource id" });
      }
      if (!sourceUrl) {
        return res.status(400).json({
          status: false,
          message: "sourceUrl is required",
        });
      }
      const resource = await SubscriptionResource.findById(id);
      if (!resource) {
        return res.status(404).json({ status: false, message: "Resource not found" });
      }
      const fileType = inferSourceTypeFromUrl(sourceUrl);
      const fileName = getFileNameFromUrl(sourceUrl);
      const saved = await SubscriptionResourceFile.create({
        resource: id,
        fileKey: sourceUrl,
        fileName,
        fileType:
          fileType === "pdf"
            ? SubscriptionResourceType.PDF
            : SubscriptionResourceType.VIDEO,
        url: sourceUrl,
        status: SubscriptionResourceFileStatus.PENDING,
        uploadedBy:
          (req["currentUser"] as { email?: string } | undefined)?.email ||
          "admin",
      });

      res.status(202).json({
        status: true,
        message: "Processing started",
        response: saved,
      });

      setImmediate(() => {
        AdminSubscriptionV2Controller.runProcessResourcesBackground([
          saved,
        ]).catch((error) => {
          console.error("[subscription-ai] process-from-url failed", error);
        });
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to process URL",
        error: error?.message || error,
      });
    }
  }

  static async processResources(req: Request, res: Response) {
    try {
      const { ids, resourceId } = (req.body || {}) as {
        ids?: string[];
        resourceId?: string;
      };
      const paramId = (req.params as { id?: string }).id;
      const filter: Record<string, any> = {
        status: {
          $in: [
            SubscriptionResourceFileStatus.PENDING,
            SubscriptionResourceFileStatus.FAILED,
          ],
        },
      };
      const scopedResourceId = resourceId || paramId;
      if (scopedResourceId && mongoose.Types.ObjectId.isValid(scopedResourceId)) {
        filter.resource = new mongoose.Types.ObjectId(scopedResourceId);
      }
      if (Array.isArray(ids) && ids.length > 0) {
        const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
        filter._id = { $in: validIds.map((id) => new mongoose.Types.ObjectId(id)) };
      }

      const pending = await SubscriptionResourceFile.find(filter).lean();
      if (pending.length === 0) {
        return res.status(200).json({
          status: true,
          message: "No pending subscription files to process",
          response: { totalFilesToProcess: 0 },
        });
      }

      res.status(202).json({
        status: true,
        message: "Processing started. Files are being trained in the background.",
        response: { totalFilesToProcess: pending.length },
      });

      setImmediate(() => {
        AdminSubscriptionV2Controller.runProcessResourcesBackground(pending).catch(
          (error) => {
            console.error("[subscription-ai] process resources failed", error);
          }
        );
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to start processing",
        error: error?.message || error,
      });
    }
  }

  static async processingStatus(_req: Request, res: Response) {
    return res.status(200).json({
      status: true,
      message: "Processing status",
      response: resourceJobState,
    });
  }

  static async runProcessResourcesBackground(pending: any[]): Promise<void> {
    resourceJobState.isRunning = true;
    resourceJobState.startedAt = new Date();
    resourceJobState.totalFiles = pending.length;
    resourceJobState.processedCount = 0;
    resourceJobState.lastError = null;

    try {
      await ensureQdrantCollection(SUBSCRIPTION_COLLECTION_NAME);
      await ensurePayloadIndexesForGeminiCollection(SUBSCRIPTION_COLLECTION_NAME);
      const vectorFormat = await resolveVectorFormat();

      for (const file of pending) {
        try {
          await SubscriptionResourceFile.findByIdAndUpdate(
            file._id,
            { $set: { status: SubscriptionResourceFileStatus.PROCESSING } },
            { new: true }
          );
          const url = file.url || publicFileUrl(file.fileKey);
          const buffer = await downloadFileFromUrl(url);
          const fileSizeMB = buffer.length / (1024 * 1024);
          await SubscriptionResourceFile.updateOne(
            { _id: file._id },
            { $set: { fileSizeMB, url } }
          );

          let allChunks: { text: string; chunkIndex: number }[] = [];
          if (file.fileType === SubscriptionResourceType.PDF) {
            const text = await parsePdfText(buffer);
            if (!text || text.length < 10) {
              await SubscriptionResourceFile.updateOne(
                { _id: file._id },
                {
                  $set: {
                    status: SubscriptionResourceFileStatus.SKIPPED,
                    chunksCount: 0,
                    errorMessage: "Skipped: PDF has no extractable text",
                    processedAt: new Date(),
                  },
                }
              );
              resourceJobState.processedCount += 1;
              continue;
            }
            allChunks = chunkText(text, 500).map((t, i) => ({
              text: t,
              chunkIndex: i,
            }));
          } else {
            const mimeType = getMimeTypeForUrl(url);
            const transcript = await transcribeVideoWithGemini(buffer, mimeType);
            if (!transcript || transcript.length < 10) {
              throw new Error("Video/audio produced no or minimal transcript");
            }
            allChunks = chunkText(transcript, 500).map((t, i) => ({
              text: t,
              chunkIndex: i,
            }));
          }

          const batchSize = calculateOptimalBatchSize(
            allChunks.map((c) => ({ text: c.text })),
            8000
          );
          let totalUpserted = 0;
          const resourceId = String(file.resource || "");
          for (let i = 0; i < allChunks.length; i += batchSize) {
            const batch = allChunks.slice(i, i + batchSize);
            if (i > 0) await new Promise((r) => setTimeout(r, 2000));
            const embeddings = await Promise.all(
              batch.map((item) => embedText(item.text))
            );
            const points = batch.map((item, idx) => ({
              id: uuidv4(),
              vector: buildPointVector(embeddings[idx], vectorFormat),
              payload: {
                sourceType: "subscription",
                sourceUrl: url,
                resourceId,
                s3Key: file.fileKey,
                pdfKey:
                  file.fileType === SubscriptionResourceType.PDF
                    ? file.fileKey
                    : undefined,
                fileName: file.fileName || path.basename(file.fileKey),
                chunkIndex: item.chunkIndex,
                text: item.text,
                processedAt: new Date().toISOString(),
              },
            }));
            await qdrant.upsert(SUBSCRIPTION_COLLECTION_NAME, {
              wait: true,
              points,
            });
            totalUpserted += points.length;
          }

          await SubscriptionResourceFile.updateOne(
            { _id: file._id },
            {
              $set: {
                status: SubscriptionResourceFileStatus.SUCCESS,
                chunksCount: totalUpserted,
                processedAt: new Date(),
                errorMessage: null,
              },
            }
          );
        } catch (err: any) {
          const msg = err?.message ?? String(err);
          resourceJobState.lastError = msg;
          await SubscriptionResourceFile.updateOne(
            { _id: file._id },
            {
              $set: {
                status: SubscriptionResourceFileStatus.FAILED,
                errorMessage: msg,
                processedAt: new Date(),
              },
            }
          );
        }
        resourceJobState.processedCount += 1;
      }
    } finally {
      resourceJobState.isRunning = false;
    }
  }

  static async collectionInfo(_req: Request, res: Response) {
    try {
      await ensureQdrantCollection(SUBSCRIPTION_COLLECTION_NAME);
      const info = await qdrant.getCollection(SUBSCRIPTION_COLLECTION_NAME);
      return res.status(200).json({
        status: true,
        message: "Subscription AI collection info",
        response: {
          collectionName: SUBSCRIPTION_COLLECTION_NAME,
          info,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch collection info",
        error: error?.message || error,
      });
    }
  }

  static async getLimits(_req: Request, res: Response) {
    try {
      const plan = await getOrCreateSubscriptionPlan();
      return res.status(200).json({
        status: true,
        message: "Subscription AI limits fetched",
        response: {
          dailyAiLimit: plan.dailyAiLimit,
          monthlyAiLimit: plan.monthlyAiLimit,
          plan: publicPlanPayload(plan),
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch limits",
        error: error?.message || error,
      });
    }
  }

  static async updateLimits(req: Request, res: Response) {
    try {
      const { dailyAiLimit, monthlyAiLimit } = req.body as {
        dailyAiLimit?: number;
        monthlyAiLimit?: number;
      };
      if (!dailyAiLimit || !monthlyAiLimit) {
        return res.status(400).json({
          status: false,
          message: "dailyAiLimit and monthlyAiLimit are required",
        });
      }
      if (dailyAiLimit < 1 || monthlyAiLimit < 1) {
        return res.status(400).json({
          status: false,
          message: "Limits must be greater than 0",
        });
      }
      const plan = await getOrCreateSubscriptionPlan();
      plan.dailyAiLimit = dailyAiLimit;
      plan.monthlyAiLimit = monthlyAiLimit;
      plan.updatedBy =
        (req["currentUser"] as { email?: string } | undefined)?.email || "admin";
      await plan.save();
      return res.status(200).json({
        status: true,
        message: "Subscription AI limits updated",
        response: {
          dailyAiLimit: plan.dailyAiLimit,
          monthlyAiLimit: plan.monthlyAiLimit,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to update limits",
        error: error?.message || error,
      });
    }
  }

  static async usage(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;
      const studentId = (req.query.studentId as string) || "";
      const filter: Record<string, any> = { source: "subscription" };
      if (studentId && mongoose.Types.ObjectId.isValid(studentId)) {
        filter.student = new mongoose.Types.ObjectId(studentId);
      }

      const [items, total] = await Promise.all([
        AiUsage.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate({ path: "student", select: "firstname lastname email" })
          .lean(),
        AiUsage.countDocuments(filter),
      ]);
      const totalPages = Math.ceil(total / limit);

      return res.status(200).json({
        status: true,
        message: "Subscription AI usage fetched",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        response: items,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch usage",
        error: error?.message || error,
      });
    }
  }

  static async studentUsage(req: Request, res: Response) {
    try {
      const { studentId } = req.params as { studentId?: string };
      if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
        return res.status(400).json({
          status: false,
          message: "Invalid studentId",
        });
      }
      const user = await User.findById(studentId)
        .select("firstname lastname email")
        .lean();
      if (!user) {
        return res.status(404).json({ status: false, message: "User not found" });
      }
      const limitCheck = await checkSubscriptionAiLimits(studentId);
      const subscription = await Subscription.findOne({
        userId: new mongoose.Types.ObjectId(studentId),
        status: {
          $in: [
            SubscriptionStatus.PENDING,
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.PAST_DUE,
            SubscriptionStatus.CANCELLED,
            SubscriptionStatus.EXPIRED,
          ],
        },
      }).sort({ createdAt: -1 });

      return res.status(200).json({
        status: true,
        message: "Student subscription AI usage fetched",
        response: {
          user,
          subscription: serializeSubscription(subscription),
          limits: limitCheck,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch student usage",
        error: error?.message || error,
      });
    }
  }
}
