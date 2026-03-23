import { Request, Response } from "express";
import Faq from "../schema/faq.schema";

export class AdminFaqV2Controller {
  static async add(req: Request, res: Response) {
    const { question, answer, status, order } = req.body;

    if (!question || !answer) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    const faq = Faq({
      question,
      answer,
      status,
      order,
    });

    faq
      .save()
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "FAQ added",
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "FAQ add failed",
          other: error,
        });
      });
  }

  static async update(req: Request, res: Response) {
    const { id } = req.params;
    const { question, answer, status, order } = req.body;

    if (!id) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    Faq.findOneAndUpdate(
      { _id: id },
      { question, answer, status, order },
      { upsert: false }
    )
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "FAQ update success",
        });
      })
      .catch(() => {
        return res.status(404).json({
          status: false,
          message: "FAQ update failed",
        });
      });
  }

  static async delete(req: Request, res: Response) {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    Faq.deleteOne({ _id: id })
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "FAQ delete success",
        });
      })
      .catch(() => {
        return res.status(404).json({
          status: false,
          message: "FAQ delete failed",
        });
      });
  }

  static async all(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;
      const status = (req.query.status as string) || "";
      const search = (req.query.search as string) || "";

      const query: Record<string, any> = {};
      if (status) query.status = status;
      if (search) {
        query.$or = [
          { question: { $regex: search, $options: "i" } },
          { answer: { $regex: search, $options: "i" } },
        ];
      }

      const [faqs, total] = await Promise.all([
        Faq.find(query)
          .sort({ order: 1, createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Faq.countDocuments(query),
      ]);

      const totalPages = Math.ceil(total / limit);

      return res.status(200).json({
        status: true,
        message: "FAQ list success",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        filters: {
          status: status || null,
          search: search || null,
        },
        response: faqs,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "FAQ list failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}
