import {Request, response, Response} from "express";
import {encrypt} from "../../../helpers/tokenizer";
import getRandomInt from "../../../helpers/random";
import {sendMail} from "../../../helpers/emailer";
import User from "../schema/user.schema";
import {Status} from "../../../enums/status.enum";
import multer from "multer";

interface MulterRequest extends Request {
  file?: multer.File;
  files?: multer.File[];
}
export class UserV2Controller {
  static async refreshToken(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      if (!id) {
        return res.status(401).json({
          status: false,
          message: "Unauthorized",
        });
      }

      const user = await User.findById(id).lean();
      if (!user) {
        return res.status(404).json({
          status: false,
          message: "User not found",
        });
      }
      if (user.status !== Status.ACTIVE) {
        return res.status(403).json({
          status: false,
          message: "User inactive",
        });
      }

      const token = encrypt.generateToken({
        id: user._id,
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        role: user.role,
        status: user.status,
        timezone: user.timezone,
      });

      return res.status(200).json({
        status: true,
        message: "Token refreshed",
        user: { id: user._id, email: user.email, firstname: user.firstname, lastname: user.lastname, role: user.role, status: user.status, token },
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "System error",
        other: error,
      });
    }
  }

  static async socialAuth(req: Request, res: Response) {
    try {
      const body =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : ({} as Record<string, unknown>);

      const {
        firstname,
        lastname,
        email,
        auth_type,
        device_id,
        apple_user_id,
        firebase_token,
        timezone,
      } = body as {
        firstname?: string;
        lastname?: string;
        email?: string;
        auth_type?: string;
        device_id?: string;
        apple_user_id?: string;
        firebase_token?: string;
        timezone?: string;
      };

      const otp = String(getRandomInt(999, 9999));

      if (!auth_type) {
        return res
          .status(400)
          .json({ status: false, message: "missing fields {auth_type}" });
      }

      if (auth_type === "APPLE") {
        if (!apple_user_id) {
          return res.status(400).json({
            status: false,
            message: "APPLE LOGIN requires apple_user_id",
          });
        }

        const existing = await User.findOneAndUpdate(
          { apple_user_id },
          { device_id, firebase_token, timezone },
          { upsert: false, new: false },
        );

        if (existing) {
          const token = encrypt.generateToken({
            id: existing._id,
            email: existing.email,
            firstname: existing.firstname,
            lastname: existing.lastname,
            role: existing.role,
            status: existing.status,
            timezone: existing.timezone,
            firebase_token: existing.firebase_token,
          });

          return res.status(200).json({
            status: true,
            message:
              existing.device_id !== device_id
                ? "You were logged out of previous device"
                : "Login success(apple)",
            user: { ...existing.toObject(), token },
          });
        }

        const created = await User({
          firstname,
          lastname,
          email,
          otp,
          auth_type,
          device_id,
          apple_user_id,
          firebase_token,
          timezone,
        }).save();

        const token = encrypt.generateToken({
          id: created._id,
          email: created.email,
          firstname: created.firstname,
          lastname: created.lastname,
          role: created.role,
          status: created.status,
          timezone: created.timezone,
          firebase_token: created.firebase_token,
        });

        return res.status(200).json({
          status: true,
          message: "User created(apple)",
          user: { ...created.toObject(), token },
        });
      }

      if (auth_type === "GOOGLE") {
        if (!firstname || !email) {
          return res.status(400).json({
            status: false,
            message: "missing fields {firstname, email}",
          });
        }

        const result = await User.findOneAndUpdate(
          { email },
          {
            firstname,
            lastname,
            email,
            otp,
            auth_type,
            device_id,
            firebase_token,
            timezone,
          },
          { upsert: true, new: true },
        );

        if (!result) {
          return res.status(500).json({
            status: false,
            message: "System error",
          });
        }

        const token = encrypt.generateToken({
          id: result._id,
          email: result.email,
          firstname: result.firstname,
          lastname: result.lastname,
          role: result.role,
          status: result.status,
          timezone: result.timezone,
          firebase_token: result.firebase_token,
        });

        return res.status(200).json({
          status: true,
          message:
            result?.device_id !== device_id
              ? "You were logged out of previous device"
              : "Login success(google)",
          user: { ...result.toObject(), token },
        });
      }

      return res
        .status(400)
        .json({ status: false, message: "auth_type {APPLE, GOOGLE}" });
    } catch (error) {
      console.log("socialAuth error :>> ", error);
      return res.status(500).json({
        status: false,
        message: "System error",
        other: error,
      });
    }
  }
}
