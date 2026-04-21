import { NextFunction, Request, Response } from "express";
import { Status } from "../enums/status.enum";
import { Roles } from "../enums/roles.enum";
import User from "../Features/user/schema/user.schema";

export const authorization = (roles: string[]): any => {
  const resolvedRoles = roles.includes(Roles.ADMIN)
    ? Array.from(
        new Set([
          ...roles,
          Roles.USER,
          Roles.STAFF_JUNIOR,
          Roles.STAFF_SENIOR,
          Roles.AUDITOR,
        ])
      )
    : roles;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
   
      const user = req["currentUser"] 
    if (!resolvedRoles.includes(user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (user.status !== Status.ACTIVE) {
      return res.status(403).json({ message: "Account not active" });
    }
    } catch (error) {
      return res.status(403).json({ message: "Denied (system error)" });
    }
    next();
  };
};