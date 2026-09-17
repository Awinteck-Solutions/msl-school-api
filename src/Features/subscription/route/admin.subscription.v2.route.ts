import * as express from "express";
import { Request, Response } from "express";
import multer = require("multer");
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { AdminSubscriptionV2Controller } from "../controllers/admin.subscription.v2.controller";
import { upload } from "../../../helpers/uploader";

const Router = express.Router();

const uploadFiles = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowed =
      file.mimetype === "application/pdf" ||
      file.mimetype.startsWith("video/") ||
      file.mimetype.startsWith("audio/");
    if (allowed) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, video, or audio files are allowed"));
    }
  },
});

Router.get(
  "/plan",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.getPlan(req, res);
  }
);

Router.put(
  "/plan",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.updatePlan(req, res);
  }
);

Router.get(
  "/",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.listSubscriptions(req, res);
  }
);

Router.get(
  "/invoices",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.listInvoices(req, res);
  }
);

Router.post(
  "/resources",
  authentification,
  authorization([Roles.ADMIN]),
  upload.single("upload"),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.createResource(req, res);
  }
);

Router.patch(
  "/resources",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.updateResource(req, res);
  }
);

Router.patch(
  "/resources/thumbnail",
  authentification,
  authorization([Roles.ADMIN]),
  upload.single("upload"),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.updateResourceThumbnail(req, res);
  }
);

Router.get(
  "/resources",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.listResources(req, res);
  }
);

Router.get(
  "/resources/processing-status",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.processingStatus(req, res);
  }
);

Router.post(
  "/resources/process",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.processResources(req, res);
  }
);

Router.post(
  "/resources/:id/files",
  authentification,
  authorization([Roles.ADMIN]),
  uploadFiles.array("files", 10),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.uploadResourceFiles(req, res);
  }
);

Router.delete(
  "/resources/:id/files/:fileId",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.deleteResourceFile(req, res);
  }
);

Router.post(
  "/resources/:id/process-from-url",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.processFromUrl(req, res);
  }
);

Router.post(
  "/resources/:id/process",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.processResources(req, res);
  }
);

Router.get(
  "/resources/:id",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.getResource(req, res);
  }
);

Router.delete(
  "/resources/:id",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.deleteResource(req, res);
  }
);

Router.get(
  "/ai/collection-info",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.collectionInfo(req, res);
  }
);

Router.get(
  "/ai/limits",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.getLimits(req, res);
  }
);

Router.put(
  "/ai/limits",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.updateLimits(req, res);
  }
);

Router.get(
  "/ai/usage",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.usage(req, res);
  }
);

Router.get(
  "/ai/usage/:studentId",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminSubscriptionV2Controller.studentUsage(req, res);
  }
);

export default Router;
