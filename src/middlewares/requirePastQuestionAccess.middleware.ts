import { NextFunction, Request, Response } from "express";
import { Roles } from "../enums/roles.enum";
import { countActiveCourseEnrollments } from "../helpers/enrollment";
import {
  findOpenSubscription,
  isSubscriptionAccessActive,
} from "../Features/subscription/controllers/subscription.service";

const staffRoles = [
  Roles.ADMIN,
  Roles.AUDITOR,
  Roles.STAFF_JUNIOR,
  Roles.STAFF_SENIOR,
];

export const requirePastQuestionAccess = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req["currentUser"] as
      | { id?: string; role?: string; email?: string }
      | undefined;
    if (!user?.id) {
      res.status(401).json({ status: false, message: "Unauthorized" });
      return;
    }
    if (staffRoles.includes(user.role as Roles)) {
      next();
      return;
    }

    const email = typeof user.email === "string" ? user.email.trim() : "";
    const enrolled = email ? await countActiveCourseEnrollments(email) : 0;
    if (enrolled > 0) {
      next();
      return;
    }

    const subscription = await findOpenSubscription(user.id);
    if (isSubscriptionAccessActive(subscription)) {
      next();
      return;
    }

    res.status(403).json({
      status: false,
      success: false,
      message:
        "Past questions require an active course enrollment or an active AI subscription.",
    });
  } catch {
    res.status(500).json({
      status: false,
      success: false,
      message: "Could not verify past question access.",
    });
  }
};
