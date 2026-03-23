import { Request, Response } from "express";
import mongoose from "mongoose";
import Payment from "../schema/payment.schema";

export class AdminPaymentV2Controller {
  static async all(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;

      const from = req.query.from ? new Date(req.query.from as string) : null;
      const to = req.query.to ? new Date(req.query.to as string) : null;
      const status = (req.query.status as string) || "";
      const userId = (req.query.userId as string) || "";
      const email = (req.query.email as string) || "";
      const courseId = (req.query.courseId as string) || "";
      const reference = (req.query.reference as string) || "";

      const filter: Record<string, any> = {};
      if (from || to) {
        filter.createdAt = {};
        if (from) filter.createdAt.$gte = from;
        if (to) filter.createdAt.$lte = to;
      }
      if (status) filter.status = status;
      if (userId) filter.userId = userId;
      if (email) filter.email = email;
      if (reference) filter.reference = reference;
      if (courseId && mongoose.Types.ObjectId.isValid(courseId)) {
        filter.courseId = new mongoose.Types.ObjectId(courseId);
      }

      const [payments, total] = await Promise.all([
        Payment.aggregate([
          { $match: filter },
          { $sort: { createdAt: -1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: "users",
              let: { userId: "$userId" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: [{ $toString: "$_id" }, "$$userId"],
                    },
                  },
                },
              ],
              as: "user",
            },
          },
          { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: "courses",
              localField: "courseId",
              foreignField: "_id",
              as: "course",
            },
          },
          { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 1,
              amount: 1,
              currency: 1,
              reference: 1,
              status: 1,
              createdAt: 1,
              user: {
                _id: "$user._id",
                firstname: "$user.firstname",
                lastname: "$user.lastname",
                email: "$user.email",
                role: "$user.role",
              },
              course: {
                _id: "$course._id",
                title: "$course.title",
                price: "$course.price",
              },
            },
          },
        ]),
        Payment.countDocuments(filter),
      ]);

      const totalPages = Math.ceil(total / limit);

      return res.status(200).json({
        status: true,
        message: "Payments fetched successfully",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        filters: {
          from: from ? from.toISOString() : null,
          to: to ? to.toISOString() : null,
          status: status || null,
          userId: userId || null,
          email: email || null,
          courseId: courseId || null,
          reference: reference || null,
        },
        response: payments,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Payments fetch failed",
        error: error?.message || error,
      });
    }
  }
}
