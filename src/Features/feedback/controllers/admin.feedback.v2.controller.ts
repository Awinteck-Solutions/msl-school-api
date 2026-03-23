import { Request, Response } from "express";
import Feedback from "../schema/feedback.schema";

export class AdminFeedbackV2Controller {
  static async all(req: Request, res: Response) {
    try {
      Feedback.find()
        .then((result) => {
          return res.status(200).json({
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

  static async single(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      Feedback.findOne({ _id: id })
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

  static async delete(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      Feedback.deleteOne({ _id: id })
        .then((result) => {
          return res.status(201).json({
            status: true,
            message: "Feedback delete success",
            response: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Feedback delete failed",
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

  static async updateStatus(req: Request, res: Response) {
    const { id, status } = req.body;
    if (!id || !status) {
      return res.status(400).json({ error: "Missing fields" });
    }
    try {
      Feedback.findOneAndUpdate({ _id: id }, { status }, { upsert: false })
        .then((result) => {
          return res.status(201).json({
            status: true,
            message: "Feedback status success",
            response: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Feedback status failed",
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
