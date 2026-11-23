import { NextFunction, Request, Response } from "express";
import { authentification } from "./authentication.middleware";
import { permissionForRequest } from "../Features/access/permissions";
import { roleHasPermission } from "../Features/access/access.service";
import AdminActionLog from "../Features/access/schema/adminActionLog.schema";

const LOGGED_ROLES = new Set(["ADMIN", "STAFF_JUNIOR", "STAFF_SENIOR"]);

const summaryFor = (req: Request) => {
  const path = String(req.originalUrl || "").split("?")[0];
  const status = String((req.body as any)?.status || "").toUpperCase();
  if (path.includes("/admin/request/") && path.endsWith("/toggle")) {
    return status === "ACTIVE"
      ? "Approved a course access request"
      : "Updated a course access request";
  }
  if (path.includes("/admin/course") && req.method === "DELETE") return "Tried to delete a course";
  if (path.includes("/admin/user") && req.method === "DELETE") return "Tried to delete a user";
  if (path.includes("/admin/lesson") && req.method === "DELETE") return "Deleted a lesson";
  if (path.includes("/admin/lesson")) return "Updated a lesson";
  if (path.includes("/admin/quiz") && req.method === "DELETE") return "Deleted a quiz";
  if (path.includes("/admin/flashcard") && req.method === "DELETE") return "Deleted a flashcard";
  return `${req.method} ${path.replace(/^\/v2/, "")}`;
};

const recordAction = (req: Request, res: Response) => {
  const user = req["currentUser"] as { id?: string; role?: string; email?: string; firstname?: string; lastname?: string };
  if (!user || !LOGGED_ROLES.has(String(user.role))) return;
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return;
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    const name = [user.firstname, user.lastname].filter(Boolean).join(" ");
    AdminActionLog.create({
      actorId: user.id || "",
      actorName: name,
      actorEmail: user.email || "",
      role: user.role,
      method: req.method,
      path: String(req.originalUrl || "").split("?")[0],
      summary: summaryFor(req),
      statusCode: res.statusCode,
    }).catch((error) => console.error("[admin-action] log failed", error));
  });
};

export const adminAccessGate = (req: Request, res: Response, next: NextFunction) => {
  authentification(req, res, () => {
    void (async () => {
      const user = req["currentUser"] as { role?: string } | undefined;
      const role = String(user?.role || "");
      if (role === "ADMIN") {
        recordAction(req, res);
        next();
        return;
      }
      if (role !== "STAFF_JUNIOR" && role !== "STAFF_SENIOR" && role !== "AUDITOR") {
        res.status(403).json({ status: false, message: "You do not have access to the admin tools." });
        return;
      }
      const key = permissionForRequest(req.method, req.originalUrl || req.url);
      const allowed = await roleHasPermission(role, key);
      if (!allowed) {
        res.status(403).json({ status: false, message: "Your role does not allow this." });
        return;
      }
      recordAction(req, res);
      next();
    })().catch((error) => {
      console.error("[admin-access] failed", error);
      if (!res.headersSent) {
        res.status(500).json({ status: false, message: "Could not check permissions." });
      }
    });
  });
};
