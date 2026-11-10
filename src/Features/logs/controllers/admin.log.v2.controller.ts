import { Request, Response } from "express";
import mongoose from "mongoose";
import RequestLog from "../schema/log.schema";

const parseDate = (value?: string): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const parseBoolean = (value?: string): boolean | undefined => {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
};

type LogFilterInput = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Builds the Mongo filter from the same query/body fields the list screen uses. */
const buildLogFilter = (input: LogFilterInput) => {
  const from = parseDate(text(input.from));
  const to = parseDate(text(input.to));
  const role = text(input.role);
  const userId = text(input.userId);
  const email = text(input.email);
  const method = text(input.method);
  const endpoint = text(input.endpoint);
  const success = parseBoolean(typeof input.success === "boolean" ? String(input.success) : text(input.success));
  const statusCode = input.statusCode ? parseInt(String(input.statusCode), 10) : undefined;

  const filter: Record<string, any> = {};
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }
  if (role) filter.role = role;
  if (userId) filter.userId = userId;
  if (email) filter.email = email;
  if (method) filter.method = method.toUpperCase();
  if (endpoint) filter.endpoint = { $regex: endpoint, $options: "i" };
  if (success !== undefined) filter.success = success;
  if (statusCode && !Number.isNaN(statusCode)) filter.statusCode = statusCode;

  return { filter, from, to, role, userId, email, method, endpoint, success, statusCode };
};

export class AdminLogV2Controller {
  static async all(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;
      const { filter, from, to, role, userId, email, method, endpoint, success, statusCode } = buildLogFilter(
        req.query as LogFilterInput
      );

      const [logs, total] = await Promise.all([
        RequestLog.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        RequestLog.countDocuments(filter),
      ]);

      const totalPages = Math.ceil(total / limit);

      return res.status(200).json({
        status: true,
        message: "Logs fetched successfully",
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
          role: role || null,
          userId: userId || null,
          email: email || null,
          method: method || null,
          endpoint: endpoint || null,
          success: success ?? null,
          statusCode: statusCode ?? null,
        },
        response: logs,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Logs fetch failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /** Deletes the logs whose ids are listed. Body: { ids: string[] } */
  static async removeMany(req: Request, res: Response) {
    try {
      const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
      const ids = [...new Set(raw.map((id: unknown) => String(id)))].filter((id) => mongoose.isValidObjectId(id));
      if (!ids.length) {
        return res.status(400).json({ status: false, message: "Choose at least one log to delete" });
      }
      if (ids.length > 5000) {
        return res.status(400).json({ status: false, message: "Delete at most 5,000 logs at a time" });
      }
      const result = await RequestLog.deleteMany({ _id: { $in: ids } });
      return res.status(200).json({
        status: true,
        message: "Logs deleted successfully",
        deleted: result.deletedCount ?? 0,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Logs delete failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Deletes every log that matches the filters (same fields as the list screen).
   * Body: { confirm: true, ...filters }. With no filters this clears all logs.
   */
  static async removeMatching(req: Request, res: Response) {
    try {
      if (req.body?.confirm !== true) {
        return res.status(400).json({ status: false, message: "Confirm the delete by sending confirm: true" });
      }
      const { filter } = buildLogFilter(req.body as LogFilterInput);
      const result = await RequestLog.deleteMany(filter);
      return res.status(200).json({
        status: true,
        message: "Logs deleted successfully",
        deleted: result.deletedCount ?? 0,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Logs delete failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}
