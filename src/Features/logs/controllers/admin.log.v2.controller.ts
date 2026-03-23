import { Request, Response } from "express";
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

export class AdminLogV2Controller {
  static async all(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;
      const from = parseDate(req.query.from as string | undefined);
      const to = parseDate(req.query.to as string | undefined);
      const role = (req.query.role as string | undefined) || "";
      const userId = (req.query.userId as string | undefined) || "";
      const email = (req.query.email as string | undefined) || "";
      const method = (req.query.method as string | undefined) || "";
      const endpoint = (req.query.endpoint as string | undefined) || "";
      const success = parseBoolean(req.query.success as string | undefined);
      const statusCode = req.query.statusCode
        ? parseInt(req.query.statusCode as string, 10)
        : undefined;

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
}
