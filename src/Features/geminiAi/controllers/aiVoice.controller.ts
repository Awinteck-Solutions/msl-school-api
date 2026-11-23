import { Request, Response } from "express";
import {
  createPrebuiltVoice,
  createReplicatedVoice,
  deleteVoice,
  listAdminVoices,
  listEnabledVoices,
  updateVoice,
} from "./aiVoice.service";

function fail(res: Response, error: any, status = 400) {
  const message = error?.message || "Request failed";
  const code = /duplicate key/i.test(message) ? 409 : status;
  return res.status(code).json({
    success: false,
    message: /duplicate key/i.test(message) ? "A voice with that name already exists" : message,
  });
}

export class AiVoiceController {
  static async list(_req: Request, res: Response) {
    try {
      const voices = await listAdminVoices();
      return res.status(200).json({ success: true, response: voices });
    } catch (error) {
      return fail(res, error, 500);
    }
  }

  static async listEnabled(_req: Request, res: Response) {
    try {
      const voices = await listEnabledVoices();
      return res.status(200).json({ success: true, response: voices });
    } catch (error) {
      return fail(res, error, 500);
    }
  }

  static async createPrebuilt(req: Request, res: Response) {
    try {
      const voice = await createPrebuiltVoice(req.body || {});
      return res.status(201).json({ success: true, response: voice });
    } catch (error) {
      return fail(res, error);
    }
  }

  static async createReplicated(req: Request, res: Response) {
    try {
      const files = (req as Request & {
        files?: { source?: { buffer: Buffer }[]; consent?: { buffer: Buffer }[] };
      }).files;
      const source = files?.source?.[0]?.buffer;
      const consent = files?.consent?.[0]?.buffer;
      const voice = await createReplicatedVoice({
        name: req.body?.name,
        source,
        consent,
      });
      return res.status(201).json({ success: true, response: voice });
    } catch (error) {
      return fail(res, error);
    }
  }

  static async update(req: Request, res: Response) {
    try {
      const voice = await updateVoice(String(req.params.id), req.body || {});
      return res.status(200).json({ success: true, response: voice });
    } catch (error) {
      const status = error?.message === "Voice not found" ? 404 : 400;
      return fail(res, error, status);
    }
  }

  static async remove(req: Request, res: Response) {
    try {
      await deleteVoice(String(req.params.id));
      return res.status(200).json({ success: true, message: "Voice deleted" });
    } catch (error) {
      const status = error?.message === "Voice not found" ? 404 : 400;
      return fail(res, error, status);
    }
  }
}
