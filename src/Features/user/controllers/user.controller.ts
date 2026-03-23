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
export class UserController {
  static async register(req: Request, res: Response) {
    try {
      const {firstname, lastname, email, password, device_id} = req.body;
      if (!email || !password) {
        return res.status(400).json({
          status: false,
          message: "email/password can't be empty",
        });
      }

      const hashedPassword = await encrypt.encryptpass(password);
      const otp = getRandomInt(999, 9999);

      const user = User({
        firstname,
        lastname,
        email,
        otp,
        password: hashedPassword,
        device_id,
      });

      user
        .save()
        .then((result) => {
          return res.status(201).json({
            status: true,
            message: "New User registered",
            user: result,
          });
        })
        .catch((error) => {
          return res.status(404).json({
            status: false,
            message: "Unsuccessful registration",
            other: error,
          });
        });
    } catch (error) {
      return res.status(500).json({message: "Internal server error"});
    }
  }

  static async login(req: Request, res: Response) {
    const {email, password} = req.body;
    if (!email || !password) {
      return res.status(404).json({
        status: false,
        message: "Enter all login details!",
      });
    }

    User.findOne({email})
      .then((response) => {
        if (!response) {
          return res.status(404).json({
            status: false,
            message: "User not found",
          });
        }

        const remotePassword = response.password;
        const isMatch = encrypt.comparepassword(remotePassword, password);
        if (isMatch === true) {
          return res.json({
            status: true,
            message: "Login success",
            response,
          });
        }
        return res.status(404).json({
          status: false,
          message: "password incorrect!",
        });
      })
      .catch(() => {
        return res.status(404).json({
          status: false,
          message: "password incorrect!",
        });
      });
  }

  static async loginNew(req: Request, res: Response) {
    const {email, password, device_id} = req.body;
    if (!email || !password) {
      return res.status(404).json({
        status: false,
        message: "Enter all login details!",
      });
    }

    User.findOne({email})
      .then((response) => {
        if (!response) {
          return res.status(404).json({
            status: false,
            message: "User not found",
          });
        }

        const remotePassword = response.password;
        const isMatch = encrypt.comparepassword(remotePassword, password);
        if (isMatch === true) {
          User.updateOne({_id: response._id}, {device_id}, {upsert: false})
            .then(() => {
              return res.json({
                status: true,
                message:
                  response.device_id !== device_id
                    ? "You were logged out of previous device"
                    : "Login success",
                response,
              });
            })
            .catch(() => {
              return res.json({
                status: true,
                message: "Login success",
                response,
              });
            });
          return;
        }
        return res.status(404).json({
          status: false,
          message: "password incorrect!",
        });
      })
      .catch(() => {
        return res.status(404).json({
          status: false,
          message: "password incorrect!",
        });
      });
  }

  static async verifyDevice(req: Request, res: Response) {
    const {user_id, device_id} = req.body;
    if (!device_id || !user_id) {
      return res.status(401).json({
        status: false,
        message: "device_id/user_id can't be empty",
      });
    }

    User.findOne({_id: user_id, device_id})
      .then((result) => {
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
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "You've been logged out",
          other: error,
        });
      });
  }

  static async forgotPassword(req: Request, res: Response) {
    const {email} = req.body;
    if (!email) {
      return res.status(401).json({
        status: false,
        message: "email can't be empty",
      });
    }

    User.findOne({email})
      .then((result) => {
        if (!result) {
          return res.status(404).json({
            status: false,
            message: "User not found",
          });
        }

        const otp = result.otp;
        sendMail(
          email,
          result.firstname || "",
          "Password Reset",
          "resetHtml",
          otp,
        );
        return res.status(200).json({
          status: true,
          message: "Reset Password code sent to your Email",
          otp,
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "User update failed",
          other: error,
        });
      });
  }

  static async resetPassword(req: Request, res: Response) {
    const {otp, password} = req.body;
    if (!otp || !password) {
      return res.status(401).json({
        status: false,
        message: "otp_code/password can't be empty",
      });
    }

    const hashedPassword = await encrypt.encryptpass(password);
    User.updateOne({otp}, {password: hashedPassword}, {upsert: false})
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "User update password success",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "User update password failed",
          other: error,
        });
      });
  }

  static async changePassword(req: Request, res: Response) {
    const {id} = req["currentUser"];
    const {password} = req.body;
    if (!id || !password) {
      return res.status(401).json({
        status: false,
        message: "user_id/password can't be empty",
      });
    }

    const hashedPassword = await encrypt.encryptpass(password);
    User.updateOne({_id: id}, {password: hashedPassword}, {upsert: false})
      .then(() => {
        return res.status(201).json({
          status: true,
          message: "User update success",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "User update failed",
          other: error,
        });
      });
  }

}
