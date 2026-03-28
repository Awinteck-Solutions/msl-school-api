import { NextFunction, Request, Response } from "express";
import * as jwt from "jsonwebtoken";
import * as dotenv from "dotenv";
import { Roles } from "../enums/roles.enum";
import { recordStudentActivity } from "../Features/gamification/service/gamification.service";
dotenv.config();

export const authentification = (req: Request, res: Response, next: NextFunction): any => {
  try {
    const header = req.headers.authorization;
    if (!header) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const token = header.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const decode = jwt.verify(token, process.env.JWT_SECRET);
    if (!decode) {
      return res.status(401).json({ message: "Unauthorized" });
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
  } catch (error) {
      return res.status(401).json({ message: "Unauthorized" });
  }
  next();
};