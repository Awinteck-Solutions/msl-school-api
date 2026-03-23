import { Request, Response } from "express";
import getRandomInt from "../../../helpers/random";
import GenerateModel from "../schema/windows.schema";
import UserModel from "../../user/schema/user.schema";
import { encrypt } from "../../../helpers/tokenizer";

export class WindowsV2Controller {
  static async generateCode(req: Request, res: Response) {
    const { device_id, device_name, device_meta } = req.body;

    if (!device_id || !device_name) {
      return res.status(404).json({
        status: false,
        message: "Enter all required details!",
      });
    }

    const generateCode = GenerateModel({
      device_id,
      device_name,
      device_meta,
      code: getRandomInt(100000, 999999),
    });

    generateCode
      .save()
      .then((result) => {
        return res.status(201).json({
          status: true,
          message: "New Device registered",
          response: result,
        });
      })
      .catch(() => {
        return res.status(404).json({
          status: false,
          message: "Unsuccessful device registration",
        });
      });
  }

  static async validateCode(req: Request, res: Response) {
      const { id } = req['currentUser'] as { id: string };
      const { code } = req.body;
    if (!code) {
      return res.status(404).json({
        status: false,
        message: "Enter code required!",
      });
    }

    GenerateModel.findOneAndUpdate(
      { code, status: "DEACTIVE" },
      { $set: { user_id: id }, status: "ACTIVE" },
      { upsert: false }
    )
      .then((result) => {
        if (result !== null) {
          UserModel.updateOne(
            { _id: id },
            { device_id: result.device_id, auth_type: "QRCODE" },
            { upsert: false }
          )
            .then(() => {
              return res.status(201).json({
                status: true,
                message: "Device has been linked successfully",
              });
            })
            .catch(() => {
              return res.status(404).json({
                status: false,
                message: "Device link failed",
              });
            });
        } else {
          return res.status(404).json({
            status: true,
            message: "Code is Invalid or Expired",
          });
        }
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "Device link failed",
          other: error,
        });
      });
  }

  static async listCodes(req: Request, res: Response) {
    const { id } = req['currentUser'] as { id: string };

    GenerateModel.find({ user_id: id, status: "ACTIVE" })
      .then((result) => {
        if (result !== null) {
          return res.status(201).json({
            status: true,
            message: "Linked devices",
            response: result,
          });
        }
        return res.status(404).json({
          status: false,
          message: "No Linked devices",
        });
      })
      .catch((error) => {
        return res.status(404).json({
          status: false,
          message: "No Linked devices",
          other: error,
        });
      });
  }

  static async loginWithCode(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      return res.status(404).json({
        status: false,
        message: "code ID required!",
      });
    }

    GenerateModel.findOne({ _id: id, status: "ACTIVE" })
      .then((result) => {
        if (result !== null) {
          UserModel.findOne({ _id: result.user_id })
            .then((value) => {
              // generate token
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
                message: "Login success",
                response: {...value.toObject(), token},
              });
            })
            .catch(() => {
              return res.status(404).json({
                status: false,
                message: "User not found",
              });
            });
        } else {
          return res.status(404).json({
            status: false,
            message: "Code is Invalid or Expired",
          });
        }
      })
      .catch((error) => {
        return res.status(500).json({
          status: false,
          message: "Device link failed",
          other: error,
        });
      });
  }
}
