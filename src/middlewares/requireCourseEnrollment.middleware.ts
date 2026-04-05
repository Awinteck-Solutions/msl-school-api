import { NextFunction, Request, Response } from "express";
import Enrolled from "../Features/course/schema/enroll.schema";
import { Roles } from "../enums/roles.enum";

/**
 * After auth: students must have at least one enrollment where both the
 * enrollment and the linked course are ACTIVE (course not archived).
 * ADMIN / AUDITOR bypass.
 */
export const requireActiveCourseEnrollment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req["currentUser"] as
      | { role?: string; email?: string }
      | undefined;
    if (!user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    if ([Roles.ADMIN, Roles.AUDITOR, Roles.STAFF_JUNIOR, Roles.STAFF_SENIOR].includes(user.role as Roles)) {
      next();
      return;
    }
    const email = typeof user.email === "string" ? user.email.trim() : "";
    if (!email) {
      res.status(403).json({
        success: false,
        message: "Enrollment required: account email is missing.",
      });
      return;
    }

    const counted = (await Enrolled.aggregate([
      { $match: { email, status: "ACTIVE" } },
      {
        $lookup: {
          from: "courses",
          localField: "course",
          foreignField: "_id",
          as: "courseDoc",
        },
      },
      { $unwind: "$courseDoc" },
      {
        $match: {
          "courseDoc.status": "ACTIVE",
          "courseDoc.archived": { $ne: true },
        },
      },
      { $count: "total" },
    ])) as { total?: number }[];

    const count = counted[0]?.total ?? 0;

    if (count < 1) {
      const path = (req.originalUrl || req.url || "").split("?")[0];
      const isGeminiHistory = path.includes("/gemini-ai/history");
      if (isGeminiHistory) {
        res.status(200).json({status: true, response: []});
        return;
      }
      res.status(200).send('You must be enrolled in at least one active course to use AI features.')
      return;
    }
    next();
  } catch {
    res.status(500).json({
      success: false,
      message: "Could not verify course enrollment.",
    });
  }
};
