import { Request, Response } from "express";
import mongoose from "mongoose";
import multer from "multer";
import FlashCard from "../schema/flashcard.schema";
import FlashCardCompletion from "../schema/flashcardLeaderboard.schema";
import { uploadFile } from "../../../helpers/s3";

interface MulterRequest extends Request {
  file?: multer.File;
  files?: {
    [fieldname: string]: multer.File[];
  };
}

export class AdminFlashcardV2Controller {
  static async adminAll(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) > 0 ? parseInt(req.query.page as string) : 1;
      const limit =
        parseInt(req.query.limit as string) > 0 ? parseInt(req.query.limit as string) : 10000;
      const skip = (page - 1) * limit;
      const search = (req.query.search as string | undefined)?.trim();

      const searchFilter = search
        ? {
            $or: [
              { title: { $regex: search, $options: "i" } },
              { description: { $regex: search, $options: "i" } },
            ],
          }
        : {};

      const total = await FlashCard.countDocuments({
        ...searchFilter,
        status: { $ne: "DELETED" },
      });

      const flashcards = await FlashCard.find({
        ...searchFilter,
        status: { $ne: "DELETED" },
      })
        .populate({
          path: "course",
          select: "title thumbnail status",
          match: { status: "ACTIVE" },
        })
        .populate("students", "firstname lastname email")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 });

      const totalPages = Math.ceil(total / limit);

      res.status(200).json({
        success: true,
        message: "Flashcards fetched successfully",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        flashcards,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch flashcards",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async byCourseOld(req: Request, res: Response) {
    try {
      const { courseId } = req.params;

      if (!courseId || !mongoose.Types.ObjectId.isValid(courseId as string)) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing courseId",
        });
      }

      const page = parseInt(req.query.page as string) > 0 ? parseInt(req.query.page as string) : 1;
      const limit =
        parseInt(req.query.limit as string) > 0 ? parseInt(req.query.limit as string) : 10000;
      const skip = (page - 1) * limit;

      const total = await FlashCard.countDocuments({
        course: courseId,
        status: "ACTIVE",
      });

      const flashcards = await FlashCard.find(
        { course: courseId, status: "ACTIVE" },
        { students: 0 }
      )
        .populate({
          path: "course",
          select: "title thumbnail status",
          match: { status: "ACTIVE" },
        })
        .populate("students", "firstname lastname email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const totalPages = Math.ceil(total / limit);

      res.status(200).json({
        success: true,
        message: "FlashCards fetched successfully",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        flashcards,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch FlashCards",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async create(req: MulterRequest, res: Response) {
    try {
      let thumbnail = null;

      if (req.file) {
        const result = await uploadFile(req.file, "flashcard");
        if (result) {
          thumbnail = `${result.key}`;
        }
      }

      const flashcardData = {
        ...req.body,
        thumbnail,
      };

      const flashcard = await FlashCard.create(flashcardData);

      res
        .status(201)
        .json({ success: true, message: "FlashCard created", flashcard });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: "Creation failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async updateThumbnail(req: MulterRequest, res: Response) {
    const { id } = req.body;
    const file = req.file;

    if (!file || !id) {
      return res.status(400).json({ error: "Missing fields" });
    }

    try {
      const result = await uploadFile(file, "flashcard");
      if (result) {
        const thumbnail = `${result.key}`;
        const flashcard = await FlashCard.findByIdAndUpdate(id, { thumbnail }, { new: true });

        return res.status(201).json({
          status: true,
          message: "FlashCard thumbnail updated",
          response: flashcard,
        });
      }
    } catch (error) {
      res.status(500).json({
        status: false,
        message: "System Error",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async addItem(req: MulterRequest, res: Response) {
    try {
      const { id } = req.params;
      const itemData = req.body;
      const files = req.files ?? {};

      if (files["termImage"]) {
        const result = await uploadFile(files["termImage"][0], "flashcard");
        if (result) {
          itemData.termImage = `${result.key}`;
        }
      }

      if (files["definitionImage"]) {
        const result = await uploadFile(files["definitionImage"][0], "flashcard");
        if (result) {
          itemData.definitionImage = `${result.key}`;
        }
      }

      const flashcard = await FlashCard.findByIdAndUpdate(
        id,
        { $push: { flashcardItems: itemData } },
        { new: true }
      );

      res.status(200).json({ success: true, message: "Item added", flashcard });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: "Failed to add item",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async addItems(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { replaceExisting } = req.body;
      const items = req.body.items.map((item: { term: string; definition: string }) => ({
        term: item.term,
        definition: item.definition,
      }));

      if (replaceExisting) {
        await FlashCard.findByIdAndUpdate(
          id,
          { flashcardItems: items },
          { new: true }
        );
        return res.status(200).json({
          success: true,
          message: "Items replaced",
          flashcard: await FlashCard.findById(id),
        });
      }

      const flashcard = await FlashCard.findByIdAndUpdate(
        id,
        { $push: { flashcardItems: { $each: items } } },
        { new: true }
      );
      res.status(200).json({ success: true, message: "Items added", flashcard });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: "Failed to add items",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async uploadItemImage(req: MulterRequest, res: Response) {
    const { flashcardId, itemId, type } = req.body;
    const file = req.file;

    if (!file || !flashcardId || !itemId || !type) {
      return res.status(400).json({
        error:
          "Missing fields: flashcardId, itemId, type, and file are required",
      });
    }

    if (!["termImage", "definitionImage"].includes(type)) {
      return res.status(400).json({
        error: "Invalid type, must be 'termImage' or 'definitionImage'",
      });
    }

    try {
      const result = await uploadFile(file, "flashcard");
      if (result) {
        const imageUrl = `${result.key}`;

        const update: Record<string, string> = {};
        update[`flashcardItems.$.${type}`] = imageUrl;

        const flashcard = await FlashCard.findOneAndUpdate(
          { _id: flashcardId, "flashcardItems._id": itemId },
          { $set: update },
          { new: true }
        );

        return res.status(200).json({
          status: true,
          message: "FlashCard item image updated",
          response: flashcard,
        });
      }
    } catch (error) {
      res.status(500).json({
        status: false,
        message: "System Error",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async update(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const flashcard = await FlashCard.findByIdAndUpdate(id, req.body, {
        new: true,
      });
      res
        .status(200)
        .json({ success: true, message: "FlashCard updated", flashcard });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: "Update failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await FlashCard.findByIdAndDelete(id);
      res.status(200).json({ success: true, message: "FlashCard deleted" });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: "Delete failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async updateItem(req: Request, res: Response) {
    try {
      const { flashcardId } = req.params;
      const { itemId, ...itemData } = req.body;

      const updateFields: Record<string, string> = {};
      for (const key in itemData) {
        updateFields[`flashcardItems.$.${key}`] = itemData[key];
      }

      const flashcard = await FlashCard.findOneAndUpdate(
        { _id: flashcardId, "flashcardItems._id": itemId },
        { $set: updateFields },
        { new: true }
      );

      return res.status(200).json({
        success: true,
        message: "FlashCard item updated",
        flashcard,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: "Update failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async deleteItem(req: Request, res: Response) {
    try {
      const { flashcardId } = req.params;
      const { itemId } = req.body;
      const flashcard = await FlashCard.findByIdAndUpdate(
        flashcardId,
        { $pull: { flashcardItems: { _id: itemId } } },
        { new: true }
      );
      res
        .status(200)
        .json({ success: true, message: "FlashCard item deleted", flashcard });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: "Delete failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async link(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { courseIds, studentIds } = req.body;

      const update: Record<string, unknown> = {};
      if (courseIds && courseIds.length > 0) {
        update.$addToSet = { course: { $each: courseIds } };
      }
      if (studentIds && studentIds.length > 0) {
        if (!update.$addToSet) update.$addToSet = {};
        (update.$addToSet as Record<string, unknown>).students = { $each: studentIds };
      }

      if (!update.$addToSet) {
        return res.status(400).json({
          success: false,
          message: "No courseIds or studentIds provided for linking.",
        });
      }

      const flashcard = await FlashCard.findByIdAndUpdate(id, update, { new: true });

      res
        .status(200)
        .json({ success: true, message: "Linked successfully", flashcard });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: "Linking failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async unlink(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { courseIds, studentIds } = req.body;

      const update: Record<string, unknown> = {};
      if (courseIds && courseIds.length > 0) {
        update.$pull = { course: { $in: courseIds } };
      }
      if (studentIds && studentIds.length > 0) {
        if (!update.$pull) update.$pull = {};
        (update.$pull as Record<string, unknown>).students = { $in: studentIds };
      }

      if (!update.$pull) {
        return res.status(400).json({
          success: false,
          message: "No courseIds or studentIds provided for unlinking.",
        });
      }

      const flashcard = await FlashCard.findByIdAndUpdate(id, update, { new: true });

      res
        .status(200)
        .json({ success: true, message: "Unlinked successfully", flashcard });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: "Unlinking failed",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async leaderboardComplete(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const leaderboard = await FlashCardCompletion.find({ flashcard: id })
        .populate("student", "firstname lastname email image")
        .sort({ completedAt: 1 })
        .limit(20)
        .lean();

      res.status(200).json({
        success: true,
        message: "Leaderboard fetched successfully",
        leaderboard,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to fetch leaderboard",
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  static async leaderboardReset(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await FlashCardCompletion.deleteMany({ flashcard: id });
      res.status(200).json({
        success: true,
        message: "FlashCard leaderboard reset successfully",
        deletedCount: result.deletedCount,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to reset leaderboard",
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}
