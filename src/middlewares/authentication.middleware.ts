import { NextFunction, Request, Response } from "express";
import * as jwt from "jsonwebtoken";
import * as dotenv from "dotenv";
import { Roles } from "../enums/roles.enum";
import { recordStudentActivity } from "../Features/gamification/service/gamification.service";
import { verifyDeviceFromHeader } from "./verifyDeviceHeader.middleware";
dotenv.config();

export const authentification = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const header = req.headers.authorization;
    if (!header) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const token = header.split(" ")[1];
    if (!token) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    const decode = jwt.verify(token, process.env.JWT_SECRET);
    if (!decode) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    req["currentUser"] = decode;
    const role = (decode as any)?.role;
    const userId = (decode as any)?.id as string | undefined;
    const headerTimeZone = req.headers["x-timezone"] as string | undefined;
    if (userId && role === Roles.USER) {
      recordStudentActivity(userId, "auth_activity", undefined, {
        timeZone: headerTimeZone,
      }).catch(() => {});
    }

    // void verifyDeviceFromHeader(req, res, next).catch((err) => {
    //   console.error("[authentification] verifyDeviceFromHeader failed", err);
    //   if (!res.headersSent) {
    //     res.status(500).json({
    //       status: false,
    //       message: "Could not verify device",
    //     });
    //   }
    // });
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
  }
};
