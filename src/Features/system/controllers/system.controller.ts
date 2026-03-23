import { Request, Response } from "express";
import System from "../schema/system.schema";

export class SystemController {
  static async add(req: Request, res: Response) {
    try {
      const {
        status,
        enforce,
        version,
        mainLink,
        subLink,
        message,
        isAvailable,
        previousVersion,
        osVersion,
      } = req.body;

      const system = await System.create({
        status,
        enforce,
        version,
        mainLink,
        subLink,
        message,
        isAvailable,
        previousVersion,
        osVersion,
      });

      return res.status(201).json({
        status: true,
        message: "System created",
        response: system,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "System error",
        error: error.message,
      });
    }
  }

  static async all(req: Request, res: Response) {
    try {
      const systems = await System.find().sort({ createdAt: -1 });
      return res.status(200).json({
        status: true,
        message: "System list",
        response: systems,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "System error",
        error: error.message,
      });
    }
  }

  static async latest(req: Request, res: Response) {
    try {
      const { osVersion } = req.query as { osVersion?: string };
      if (!osVersion) {
        return res.status(400).json({
          status: false,
          message: "Missing osVersion",
        });
      }

      const system = await System.findOne({ osVersion, isAvailable: true }).sort({
        createdAt: -1,
      });
      if (!system) {
        return res.status(404).json({
          status: false,
          message: "System not found",
        });
      }
      return res.status(200).json({
        status: true,
        message: "System latest",
        response: system,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "System error",
        error: error.message,
      });
    }
  }

  static async update(req: Request, res: Response) {
    try {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ status: false, message: "Missing id" });
      }

      const update = {
        status: req.body.status,
        enforce: req.body.enforce,
        version: req.body.version,
        mainLink: req.body.mainLink,
        subLink: req.body.subLink,
        message: req.body.message,
        isAvailable: req.body.isAvailable,
        previousVersion: req.body.previousVersion,
        osVersion: req.body.osVersion,
      };

      const system = await System.findOneAndUpdate({ _id: id }, update, {
        new: true,
      });

      if (!system) {
        return res.status(404).json({
          status: false,
          message: "System not found",
        });
      }

      return res.status(200).json({
        status: true,
        message: "System updated",
        response: system,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "System error",
        error: error.message,
      });
    }
  }
 
}