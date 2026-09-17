import { NextFunction, Request, Response } from "express";
import { Roles } from "../enums/roles.enum";
import {
  findOpenSubscription,
  isSubscriptionAccessActive,
} from "../Features/subscription/controllers/subscription.service";

export const requireActiveSubscription = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req["currentUser"] as
      | { id?: string; role?: string }
      | undefined;
    if (!user?.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    if (
      [
        Roles.ADMIN,
        Roles.AUDITOR,
        Roles.STAFF_JUNIOR,
        Roles.STAFF_SENIOR,
      ].includes(user.role as Roles)
    ) {
      next();
      return;
    }

    const subscription = await findOpenSubscription(user.id);
    if (!isSubscriptionAccessActive(subscription)) {
      res.status(403).json({
        status: false,
        success: false,
        message:
          "An active AI subscription is required to use these features.",
      });
      return;
    }

    req["subscription"] = subscription;
    next();
  } catch {
    res.status(500).json({
      status: false,
      success: false,
      message: "Could not verify subscription.",
    });
  }
};
