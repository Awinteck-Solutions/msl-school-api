import { Request, Response } from "express";
import Requests from "../schema/request.schema";

export class RequestV2Controller {
  static async add(req: Request, res: Response) {
    const { email, courseId } = req.body;
    if (!email && !courseId) {
      return res.status(401).json({
        status: false,
        message: "missing fields",
      });
    }

    try {
      const existingDoc = await Requests.findOne({
        email: email,
        course: courseId,
      });
      if (!existingDoc) {
        const requests = Requests({ email, course: courseId });
        requests
          .save()
          .then(() => {
            return res.status(201).json({
              status: true,
              message: "Request saved success",
            });
          })
          .catch((error) => {
            return res.status(500).json({
              status: false,
              message: "Failed to create request",
              other: error,
            });
          });
      } else {
        return res.status(409).json({
          status: false,
          message: "Duplicate request exists",
        });
      }
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System Error",
      });
    }
  }
}
