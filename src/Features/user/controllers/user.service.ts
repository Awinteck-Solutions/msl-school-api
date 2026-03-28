import {Request, response, Response} from "express";
import {encrypt} from "../../../helpers/tokenizer";
import getRandomInt from "../../../helpers/random";
import {sendMail} from "../../../helpers/emailer";
import User from "../schema/user.schema";
import {Status} from "../../../enums/status.enum";
import multer from "multer";
import { uploadFile } from "../../../helpers/s3";

interface MulterRequest extends Request {
  file?: multer.File;
  files?: multer.File[];
}
export class UserService {
 
  static async verifyDevice(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      const body =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : ({} as Record<string, unknown>);
      const { device_id } = body as { device_id?: string };

      if (!device_id) {
        return res.status(401).json({
          status: false,
          message: "device_id can't be empty",
        });
      }

      const result = await User.findOne({ _id: id, device_id }).lean();
      if (result) {
        return res.status(200).json({
          status: true,
          message: "Keep logged in",
          response: result,
        });
      }

      return res.status(404).json({
        status: false,
        message: "You've been logged out",
      });
    } catch (error) {
      console.log("verifyDevice error :>> ", error);
      return res.status(500).json({
        status: false,
        message: "System error",
        other: error,
      });
    }
  }

  static async updateProfile(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      const body =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : ({} as Record<string, unknown>);
      const { firstname, lastname } = body as {
        firstname?: string;
        lastname?: string;
      };

      await User.updateOne({ _id: id }, { firstname, lastname }, { upsert: false });
      return res.status(201).json({
        status: true,
        message: "User update success",
      });
    } catch (error) {
      console.log("updateProfile error :>> ", error);
      return res.status(500).json({
        status: false,
        message: "User update failed",
        other: error,
      });
    }
  }

  static async uploadImage(req: MulterRequest, res: Response) {
    const {id} = req["currentUser"];
    const file = req.file;

    try {
      if (!file) {
        return res.status(400).json({
          status: false,
          message: "File is required",
        });
      }
       // new code
    let image_name = null;
  
    if (file) {
      const result = await uploadFile(file, "users");
      if (result) {
        image_name = `${result}`;
      }
    }
  
      const image = image_name;
      await User.updateOne({ _id: id }, { image }, { upsert: true });
      return res.status(201).json({
        status: true,
        message: "User update success",
        response: image,
      });
    } catch (error) {
      console.log("uploadImage error :>> ", error);
      return res.status(500).json({
        status: false,
        message: "System error",
        other: error,
      });
    }
  }

  static async profile(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      if (!id) {
        return res.status(401).json({
          status: false,
          message: "user id can't be empty",
        });
      }

      const result = await User.findOne({ _id: id });
      if (!result) {
        return res.status(404).json({
          status: false,
          message: "User not found",
        });
      }

      return res.status(201).json({
        status: true,
        message: "User success",
        response: result.toObject(),
      });
    } catch (error) {
      console.log("profile error :>> ", error);
      return res.status(500).json({
        status: false,
        message: "User failed",
        other: error,
      });
    }
  }

  static async delete(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      if (!id) {
        return res.status(401).json({
          status: false,
          message: "user id can't be empty",
        });
      }
      // update status to deleted
      await User.updateOne(
        { _id: id },
        { status: Status.DELETED },
        { upsert: false },
      );
      return res.status(201).json({
        status: true,
        message: "User delete success",
      });
    } catch (error) {
      console.log("delete error :>> ", error);
      return res.status(500).json({
        status: false,
        message: "User delete failed",
        other: error,
      });
    }
  }
}
