import { Request, Response } from "express";
import Category from "../schema/category.schema";

export class CategoryV2Controller {
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
