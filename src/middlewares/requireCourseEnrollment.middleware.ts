import { NextFunction, Request, Response } from "express";
import Enrolled from "../Features/course/schema/enroll.schema";
import { Roles } from "../enums/roles.enum";

/**
 * After auth: students (USER) must have at least one ACTIVE course enrollment.
 * ADMIN bypasses (staff tooling / testing).
 */
export const requireActiveCourseEnrollment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    console.log('requireActiveCourseEnrollment')
    const user = req["currentUser"] as
      | { role?: string; email?: string }
      | undefined;
    if (!user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    if (user.role === Roles.AUDITOR) {
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
    console.log('email', email)
    const count = await Enrolled.countDocuments({
      email,
      status: "ACTIVE",
    });
    console.log('count', count)
    if (count < 1) {
      res.status(403).json({
        success: false,
        message:
          "You must be enrolled in at least one active course to use AI features.",
      });
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
