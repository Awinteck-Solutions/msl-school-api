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
    const {firstname, lastname, email, auth_type, device_id, apple_user_id} =
      req.body;
    const otp = getRandomInt(999, 9999);

    if (!auth_type) {
      return res
        .status(404)
        .json({status: false, message: "missing fields {auth_type}"});
    }

    if (auth_type === "APPLE") {
      if (!apple_user_id) {
        return res.status(404).json({
          status: false,
          message: "APPLE LOGIN requires apple_user_id",
        });
      }

      return User.findOneAndUpdate(
        {apple_user_id},
        {device_id},
        {upsert: false},
      )
        .then((value) => {
          if (value) {
            const token = encrypt.generateToken({
              id: value._id,
              email: value.email,
              firstname: value.firstname,
              lastname: value.lastname,
              role: value.role,
              status: value.status,
            });

            return res.status(200).json({
              status: true,
              message:
                value.device_id !== device_id
                  ? "You were logged out of previous device"
                  : "Login success(apple)",
              user: {...value.toObject(), token},
            });
          }

          const user = User({
            firstname,
            lastname,
            otp,
            auth_type,
            device_id,
            apple_user_id,
          });
          return user
            .save()
            .then((result) => {
              const token = encrypt.generateToken({
                id: result._id,
                email: result.email,
                firstname: result.firstname,
                lastname: result.lastname,
                role: result.role,
                status: result.status,
              });
              return res.status(200).json({
                status: true,
                message: "User created(apple)",
                user: {...result.toObject(), token},
              });
            })
            .catch(() => {
              return res.status(404).json({
                status: false,
                message: "Email required(apple)",
              });
            });
        })
        .catch((error) => {
          console.log("error :>> ", error);
          return res.status(500).json({
            status: false,
            message: "System error",
            other: error,
          });
        });
    }

    if (auth_type === "GOOGLE") {
      if (!firstname || !email) {
        return res
          .status(404)
          .json({status: false, message: "missing fields {firstname, email}"});
      }

      return User.findOneAndUpdate(
        {email},
        {firstname, lastname, email, otp, auth_type, device_id},
        {upsert: true, new: true},
      )
        .then((result) => {
          const token = encrypt.generateToken({
            id: result._id,
            email: result.email,
            firstname: result.firstname,
            lastname: result.lastname,
            role: result.role,
            status: result.status,
          });
          return res.status(200).json({
            status: true,
            message:
              result?.device_id !== device_id
                ? "You were logged out of previous device"
                : "Login success",
            user: {...result.toObject(), token},
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Unsuccessful",
            other: error,
          });
        });
    }

    return res
      .status(404)
      .json({status: false, message: "auth_type {APPLE, GOOGLE}"});
  }
}
