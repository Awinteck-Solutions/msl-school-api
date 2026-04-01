import { Request, Response } from "express";
import Advert from "../schema/advert.schema";

export class AdvertV2Controller {
  /** Authenticated users: only adverts with status ACTIVE */
  static async activeList(req: Request, res: Response) {
    try {
      const adverts = await Advert.find({ status: "ACTIVE" }).sort({
        createdAt: -1,
      });

      return res.status(200).json({
        status: true,
        message: "Active adverts",
        response: adverts,
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Failed to load adverts",
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}
