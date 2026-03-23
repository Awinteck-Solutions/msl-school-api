import { Request, Response } from "express";
import Feedback from "../schema/feedback.schema";

export class FeedbackV2Controller {
  static async add(req: Request, res: Response) {
    const { type, user_id, phone, message } = req.body;
    if (!type || !user_id || !phone || !message) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      const feedback = Feedback({
        type,
        phone,
        message,
        user: user_id,
      });
      feedback
        .save()
        .then((result) => {
          return res.status(201).json({
            status: true,
            message: "Feedback success",
            response: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Feedback failed",
            other: error,
          });
        });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
      });
    }
  }
}