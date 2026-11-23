import { Request, Response } from "express";
import mongoose from "mongoose";
import RolePermission from "./schema/rolePermission.schema";
import AdminActionLog from "./schema/adminActionLog.schema";
import AiUsage from "../mslAi/schema/aiUsage.schema";
import User from "../user/schema/user.schema";
import GlobalAiLimit from "../mslAi/schema/globalAiLimit.schema";
import { clearPermissionCache, permissionsForRole } from "./access.service";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLE_NAMES } from "./permissions";

const DEFAULT_PAST_QUESTION_AI_LIMIT = 10;

const sourceFilter = (source: string) => {
  if (source === "subscription") return { source: "subscription" };
  if (source === "past-question") return { source: "past-question" };
  return { source: { $nin: ["subscription", "past-question"] } };
};

export class AdminAccessController {
  static async me(req: Request, res: Response) {
    const role = String(req["currentUser"]?.role || "");
    const permissions = await permissionsForRole(role);
    return res.status(200).json({
      status: true,
      response: { role, permissions, catalog: PERMISSIONS },
    });
  }

  static async roles(_req: Request, res: Response) {
    const stored = await RolePermission.find().lean();
    const byRole = new Map(stored.map((row: any) => [row.role, row]));
    return res.status(200).json({
      status: true,
      response: ROLE_NAMES.map((role) => ({
        role,
        permissions: {
          ...DEFAULT_ROLE_PERMISSIONS[role],
          ...((byRole.get(role) as any)?.grants || {}),
        },
        customized: Boolean(byRole.get(role)),
        updatedAt: (byRole.get(role) as any)?.updatedAt || null,
      })),
      catalog: PERMISSIONS,
    });
  }

  static async updateRole(req: Request, res: Response) {
    const role = String(req.params.role || "");
    if (!ROLE_NAMES.includes(role as any) || role === "ADMIN") {
      return res.status(400).json({ status: false, message: "This role cannot be edited." });
    }
    const incoming = req.body?.permissions;
    if (!incoming || typeof incoming !== "object") {
      return res.status(400).json({ status: false, message: "permissions are required" });
    }
    const grants: Record<string, boolean> = {};
    for (const item of PERMISSIONS) {
      if (typeof incoming[item.key] === "boolean") grants[item.key] = incoming[item.key];
    }
    const actor = req["currentUser"]?.email || "";
    await RolePermission.findOneAndUpdate(
      { role },
      { role, grants, updatedBy: actor },
      { upsert: true, new: true }
    );
    clearPermissionCache();
    return res.status(200).json({ status: true, message: "Role permissions saved" });
  }

  static async actions(req: Request, res: Response) {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "25"), 10) || 25));
    const role = String(req.query.role || "");
    const search = String(req.query.search || "").trim();
    const filter: Record<string, unknown> = {};
    if (role) filter.role = role;
    if (search) {
      filter.$or = [
        { summary: { $regex: search, $options: "i" } },
        { actorEmail: { $regex: search, $options: "i" } },
        { actorName: { $regex: search, $options: "i" } },
      ];
    }
    const [rows, total] = await Promise.all([
      AdminActionLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AdminActionLog.countDocuments(filter),
    ]);
    return res.status(200).json({
      status: true,
      response: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  }

  static async conversations(req: Request, res: Response) {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20));
    const source = String(req.query.source || "course");
    const search = String(req.query.search || "").trim();
    const filter: Record<string, unknown> = { ...sourceFilter(source) };
    if (search) filter.question = { $regex: search, $options: "i" };
    const [rows, total] = await Promise.all([
      AiUsage.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("student question queryType source model createdAt")
        .lean(),
      AiUsage.countDocuments(filter),
    ]);
    const ids = rows.map((row: any) => row.student).filter(Boolean);
    const users = await User.find({ _id: { $in: ids } }).select("firstname lastname email").lean();
    const byId = new Map(users.map((user: any) => [String(user._id), user]));
    return res.status(200).json({
      status: true,
      response: rows.map((row: any) => ({
        _id: row._id,
        question: String(row.question || "").slice(0, 240),
        queryType: row.queryType || "chat",
        source: row.source || "course",
        model: row.model || "",
        createdAt: row.createdAt,
        student: byId.get(String(row.student)) || null,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  }

  static async conversation(req: Request, res: Response) {
    const id = String(req.params.id || "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ status: false, message: "Invalid id" });
    }
    const row: any = await AiUsage.findById(id)
      .select("student question answer queryType source model createdAt metadata")
      .lean();
    if (!row) return res.status(404).json({ status: false, message: "Conversation not found" });
    const student = row.student
      ? await User.findById(row.student).select("firstname lastname email").lean()
      : null;
    return res.status(200).json({
      status: true,
      response: { ...row, student },
    });
  }

  static async pastQuestionUsage(req: Request, res: Response) {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20));
    const search = String(req.query.search || "").trim();
    const limits = await GlobalAiLimit.findOne().select("pastQuestionLifetimeLimit").lean();
    const lifetimeLimit = Number((limits as any)?.pastQuestionLifetimeLimit) || DEFAULT_PAST_QUESTION_AI_LIMIT;
    const grouped = await AiUsage.aggregate([
      { $match: { source: "past-question" } },
      { $group: { _id: "$student", used: { $sum: 1 }, lastAt: { $max: "$createdAt" } } },
      { $sort: { lastAt: -1 } },
    ]);
    const ids = grouped.map((row) => row._id).filter(Boolean);
    const userQuery: Record<string, unknown> = { _id: { $in: ids } };
    if (search) {
      userQuery.$or = [
        { email: { $regex: search, $options: "i" } },
        { firstname: { $regex: search, $options: "i" } },
        { lastname: { $regex: search, $options: "i" } },
      ];
    }
    const users = await User.find(userQuery).select("firstname lastname email").lean();
    const byId = new Map(users.map((user: any) => [String(user._id), user]));
    const matched = grouped.filter((row) => byId.has(String(row._id)));
    const slice = matched.slice((page - 1) * limit, page * limit);
    return res.status(200).json({
      status: true,
      response: slice.map((row) => ({
        key: String(row._id),
        student: byId.get(String(row._id)),
        used: row.used,
        limit: lifetimeLimit,
        remaining: Math.max(0, lifetimeLimit - row.used),
        lastAt: row.lastAt,
      })),
      pagination: { page, limit, total: matched.length, totalPages: Math.ceil(matched.length / limit) },
    });
  }
}
