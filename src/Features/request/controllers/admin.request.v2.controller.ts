import { Request, Response } from "express";
import Requests from "../schema/request.schema";
import { sendFirebaseNotification } from "../../../helpers/firebase";
import { isUserNotificationEnabled } from "../../../helpers/notificationSettings";
import User from "../../user/schema/user.schema";
import Enrolled from "../../course/schema/enroll.schema";

export class AdminRequestV2Controller {
  static async all(req: Request, res: Response) {
    const search = (req.query.search as string | undefined)?.trim();
    const statusParamRaw = (req.query.status as string | undefined)?.trim();
    const statusParam = statusParamRaw ? statusParamRaw.toUpperCase() : undefined;
    const statusFilter =
      statusParam && ["ACTIVE", "DEACTIVE"].includes(statusParam) ? { status: statusParam } : {};

    const searchFilter = search
      ? {
          $or: [
            { email: { $regex: search, $options: "i" } },
            { status: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    const page =
      parseInt(req.query.page as string) > 0
        ? parseInt(req.query.page as string)
        : 1;
    const limit =
      parseInt(req.query.limit as string) > 0
        ? parseInt(req.query.limit as string)
        : 10000;
    const skip = (page - 1) * limit;

    const total = await Requests.countDocuments({ ...statusFilter, ...searchFilter });
    const totalPages = Math.ceil(total / limit);

    Requests.find({ ...statusFilter, ...searchFilter })
      .populate("course", "title")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "Request success",
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
          },
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Request failed",
          other: error,
        });
      });
  }

  static async allByStatus(req: Request, res: Response) {
    const search = (req.query.search as string | undefined)?.trim();
    const status = String((req.params as any).status ?? "").trim().toUpperCase();
    if (!["ACTIVE", "DEACTIVE"].includes(status)) {
      return res.status(400).json({
        status: false,
        message: "Invalid status. Use ACTIVE or DEACTIVE.",
      });
    }

    const searchFilter = search
      ? {
          $or: [
            { email: { $regex: search, $options: "i" } },
            { "course.title": { $regex: search, $options: "i" } },
          ],
        }
      : {};

    const page =
      parseInt(req.query.page as string) > 0
        ? parseInt(req.query.page as string)
        : 1;
    const limit =
      parseInt(req.query.limit as string) > 0
        ? parseInt(req.query.limit as string)
        : 10000;
    const skip = (page - 1) * limit;

    const total = await Requests.countDocuments({ ...searchFilter, status });
    const totalPages = Math.ceil(total / limit);

    Requests.find({ ...searchFilter, status })
      .populate("course", "title")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "Request success",
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
          },
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Request failed",
          other: error,
        });
      });
  }

  static async toggle(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      console.log("id::", id);
      console.log("status::", status);
    const normalizedStatus =
      typeof status === "string" ? status.trim().toUpperCase() : undefined;
    if (!id || !normalizedStatus) {
      return res.status(401).json({
        status: false,
        message: "Missing fields",
      });
    }
    if (!["ACTIVE", "DEACTIVE"].includes(normalizedStatus)) {
      return res.status(400).json({
        status: false,
        message: "Invalid status. Use ACTIVE or DEACTIVE.",
      });
    }
    Requests.findOneAndUpdate({ _id: id }, { status: normalizedStatus }, { upsert: false }).populate("course")
      .then(async (result: any) => {
        const course = result.course;
        // console.log("course::", course.title);
        // get the student's firebase token
        const student = await User.findOne({ email: result.email })
          .select("firebase_token notificationSettings")
          .lean();
        const firebaseToken = (student as any)?.firebase_token as string | undefined;
        console.log('student', result.email)
       
        if (normalizedStatus === "ACTIVE") {
          await Enrolled.findOneAndUpdate(
            { email: result.email, course: course._id },
            {
              $set: { status: "ACTIVE" },
              $setOnInsert: { email: result.email, course: course._id },
            },
            { upsert: true, new: true }
          );

          if (!firebaseToken) {
            return res.status(200).json({
              status: true,
              message: "Request approved but Student firebase token not found",
            });
          }
          if (isUserNotificationEnabled(student as any, "course_alerts")) {
            sendFirebaseNotification(firebaseToken, {
              title: "Course Request Approved",
              body: `Your enrollment request has been approved for ${course.title}`,
              data: { type: "request", event: "request_approved", course: course._id.toString() },
            });
          }

        }
        return res.status(201).json({
          status: true,
          message: "request approved and enrolled"
        });
      })
      .catch((error) => {
        console.log("error::", error);
        return res.status(404).json({
          status: false,
          message: "Request failed",
        });
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error - 2026-26-03",
        other: error,
      });
    }
  }

  static async delete(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      return res.status(401).json({
        status: false,
        message: "Missing field",
      });
    }
    Requests.deleteOne({ _id: id })
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "Request delete success",
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Request delete failed",
          other: error,
        });
      });
  }
}
