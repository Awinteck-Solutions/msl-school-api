import { NextFunction, Request, Response } from "express";
import User from "../Features/user/schema/user.schema";

const getHeaderDeviceId = (req: Request): string => {
  const raw =
    req.headers["x-device-id"] ??
    req.headers["X-Device-Id"] ??
    req.headers["X-DEVICE-ID"];
  return typeof raw === "string" ? raw.trim() : "";
};

/**
 * After JWT auth: ensure `x-device-id` matches the user’s stored `device_id`
 * (same rules as UserService.verifyDevice).
 */
export async function verifyDeviceFromHeader(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = req["currentUser"] as { id?: string } | undefined;
  if (!user?.id) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const deviceId = getHeaderDeviceId(req);
  if (!deviceId) {
    res.status(404).json({
      status: false,
      message: "x-device-id header is required",
    });
    return;
  }

  try {
    
    const result = await User.findOne({
      _id: user.id,
      device_id: deviceId,
    })
      .select("_id")
      .lean();
     
    if (!result) {
      res.status(403).json({
        status: false,
        message: "You've been logged out",
      });
      return;
    }
  } catch {
    res.status(500).json({
      status: false,
      message: "Could not verify device",
    });
    return;
  }

  next();
}
