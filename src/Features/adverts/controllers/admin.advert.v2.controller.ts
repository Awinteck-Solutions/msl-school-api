import { Request, Response } from "express";
import multer from "multer";
import Advert from "../schema/advert.schema";
import { uploadFile } from "../../../helpers/s3";

interface MulterRequest extends Request {
  file?: multer.File;
}

const ALLOWED_STATUS = ["ACTIVE", "INACTIVE"] as const;

function normalizeStatus(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return ALLOWED_STATUS.includes(value as (typeof ALLOWED_STATUS)[number])
    ? value
    : undefined;
}

export class AdminAdvertV2Controller {
  static async add(req: MulterRequest, res: Response) {
    try {
      const { name } = req.body;
      if (
        req.body.status !== undefined &&
        req.body.status !== "" &&
        normalizeStatus(req.body.status) === undefined
      ) {
        return res.status(400).json({
          error: "Invalid status",
          message: "status must be ACTIVE or INACTIVE",
        });
      }
      const status = normalizeStatus(req.body.status) ?? "INACTIVE";

      if (!name) {
        return res.status(400).json({
          error: "Missing fields",
          message: "name is required",
        });
      }

      let image: string | undefined;
      if (req.file) {
        const result = await uploadFile(req.file, "adverts");
        image = result.key;
      } else if (typeof req.body.image === "string" && req.body.image.trim()) {
        image = req.body.image.trim();
      }

      if (!image) {
        return res.status(400).json({
          error: "Missing fields",
          message: "image file or image URL/key is required",
        });
      }

      const advert = Advert({ name, status, image });
      const result = await advert.save();
      return res.status(201).json({
        status: true,
        message: "Advert added",
        response: result,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Advert add failed",
        other: error instanceof Error ? error.message : error,
      });
    }
  }

  static async update(req: MulterRequest, res: Response) {
    try {
      const { id } = req.params;
      const { name } = req.body;

      if (!id) {
        return res.status(400).json({
          error: "Missing fields",
        });
      }

      const patch: Record<string, unknown> = {};
      if (name !== undefined) patch.name = name;
      if (req.body.status !== undefined && req.body.status !== "") {
        const st = normalizeStatus(req.body.status);
        if (st === undefined) {
          return res.status(400).json({
            error: "Invalid status",
            message: "status must be ACTIVE or INACTIVE",
          });
        }
        patch.status = st;
      }

      if (req.file) {
        const result = await uploadFile(req.file, "adverts");
        patch.image = result.key;
      } else if (
        typeof req.body.image === "string" &&
        req.body.image.trim() !== ""
      ) {
        patch.image = req.body.image.trim();
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({
          error: "No fields to update",
        });
      }

      const doc = await Advert.findOneAndUpdate({ _id: id }, patch, {
        upsert: false,
        new: true,
      });
      if (!doc) {
        return res.status(404).json({
          status: false,
          message: "Advert not found",
        });
      }
      return res.status(200).json({
        status: true,
        message: "Advert update success",
        response: doc,
      });
    } catch {
      return res.status(404).json({
        status: false,
        message: "Advert update failed",
      });
    }
  }

  static async delete(req: Request, res: Response) {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    return Advert.deleteOne({ _id: id })
      .then((r) => {
        if (r.deletedCount === 0) {
          return res.status(404).json({
            status: false,
            message: "Advert not found",
          });
        }
        return res.status(200).json({
          status: true,
          message: "Advert delete success",
        });
      })
      .catch(() => {
        return res.status(404).json({
          status: false,
          message: "Advert delete failed",
        });
      });
  }

  static async all(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;
      const statusFilter = (req.query.status as string) || "";
      const search = (req.query.search as string) || "";

      const query: Record<string, unknown> = {};
      if (statusFilter && ALLOWED_STATUS.includes(statusFilter as "ACTIVE" | "INACTIVE")) {
        query.status = statusFilter;
      }
      if (search) {
        query.name = { $regex: search, $options: "i" };
      }

      const [adverts, total] = await Promise.all([
        Advert.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
        Advert.countDocuments(query),
      ]);

      const totalPages = Math.ceil(total / limit);

      return res.status(200).json({
        status: true,
        message: "Advert list success",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        filters: {
          status: statusFilter || null,
          search: search || null,
        },
        response: adverts,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Advert list failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}
