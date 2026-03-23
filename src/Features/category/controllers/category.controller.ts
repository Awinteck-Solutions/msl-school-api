import { Request, Response } from "express";
import Category from "../schema/category.schema";

export class CategoryController {
  static async add(req: Request, res: Response) {
    const { name, adminId, position = "100" } = req.body;

    if (!name || !adminId) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    const category = Category({
      name,
      author: adminId,
      position,
    });

    category
      .save()
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "New category added",
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "category adding failed",
          other: error,
        });
      });
  }

  static async update(req: Request, res: Response) {
    const { id } = req.params;
    const { name, position } = req.body;

    if (!id) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    Category.findOneAndUpdate({ _id: id }, { name, position })
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "update category success",
        });
      })
      .catch(() => {
        return res.status(404).json({
          status: false,
          message: "update category failed",
        });
      });
  }

  static async bulkUpdate(req: Request, res: Response) {
    const categories = req.body.categories;
    try {
      if (!Array.isArray(categories) || categories.length === 0) {
        return res.status(400).json({
          error: "Invalid request. Provide an array of categories to update.",
        });
      }

      const updatePromises = categories.map(({ id, name, position }) => {
        if (!id) {
          throw new Error("Missing ID for category");
        }
        return Category.findOneAndUpdate(
          { _id: id },
          { name, position },
          { new: true }
        );
      });

      const updatedCategories = await Promise.all(updatePromises);

      return res.status(200).json({
        status: true,
        message: "Categories updated successfully",
        data: updatedCategories,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Failed to update categories",
        error: error instanceof Error ? error.message : error,
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

    Category.deleteOne({ _id: id })
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "delete category success",
        });
      })
      .catch(() => {
        return res.status(404).json({
          status: false,
          message: "delete category failed",
        });
      });
  }

  static async single(req: Request, res: Response) {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    Category.findOne({ _id: id })
      .then((result) => {
        if (result) {
          return res.status(200).json({
            status: true,
            message: "category success",
            response: result,
          });
        }
        return res.status(404).json({
          status: true,
          message: "categoryId not found",
        });
      })
      .catch((error) => {
        return res.status(400).json({
          status: false,
          message: "category failed",
          other: error,
        });
      });
  }

  static async all(req: Request, res: Response) {
    Category.find()
      .then((result) => {
        return res.status(200).json({
          status: true,
          message: "category success",
          response: result,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "category failed",
          other: error,
        });
      });
  }
}