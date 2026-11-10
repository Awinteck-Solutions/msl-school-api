import { NextFunction, Request, Response } from "express";

/**
 * NoSQL-injection guard. Client input must never carry MongoDB operators: a body such as
 * `{ "email": { "$ne": null } }` would otherwise reach a query filter as an operator.
 *
 * This replaces Mongoose's global `sanitizeFilter`, which also rewrote the operators the server
 * itself writes (`{ role: { $ne: "USER" } }`, `$in`, ...) and made those queries fail.
 */
const hasOperatorKey = (value: unknown, depth = 0): boolean => {
  if (!value || typeof value !== "object" || depth > 12) return false;
  if (Array.isArray(value)) return value.some((item) => hasOperatorKey(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) => key.startsWith("$") || hasOperatorKey(nested, depth + 1)
  );
};

export const rejectOperatorKeys = (req: Request, res: Response, next: NextFunction) => {
  if (hasOperatorKey(req.body) || hasOperatorKey(req.query) || hasOperatorKey(req.params)) {
    return res.status(400).json({
      status: false,
      message: "Invalid request: keys starting with '$' are not allowed",
    });
  }
  return next();
};
