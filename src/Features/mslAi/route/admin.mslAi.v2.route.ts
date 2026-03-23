import * as express from "express";
import { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import multer = require("multer");
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { AdminMslAiV2Controller } from "../controllers/admin.mslAi.v2.controller";

const Router = express.Router();

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: "Too many requests, please try again later.",
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

Router.get(
  "/list-pdfs",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminMslAiV2Controller.listPdfs(req, res);
  }
);

Router.get(
  "/process-pdfs",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminMslAiV2Controller.processPdfs(req, res);
  }
);

Router.get(
  "/process-new-pdfs",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminMslAiV2Controller.processNewPdfs(req, res);
  }
);

Router.post(
  "/upload-pdf",
  authentification,
  authorization([Roles.ADMIN]),
  upload.single("pdf"),
  (req: Request, res: Response) => {
    AdminMslAiV2Controller.uploadPdf(req, res);
  }
);

Router.post(
  "/upload-pdfs",
  authentification,
  authorization([Roles.ADMIN]),
  upload.array("pdfs", 10),
  (req: Request, res: Response) => {
    AdminMslAiV2Controller.uploadPdfs(req, res);
  }
);

Router.delete(
  "/delete-pdf/old",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminMslAiV2Controller.deletePdfOld(req, res);
  }
);

Router.post(
  "/query",
  authentification,
  authorization([Roles.ADMIN]),
  chatLimiter,
  (req: Request, res: Response) => {
    AdminMslAiV2Controller.query(req, res);
  }
);

Router.get(
  "/collection-info",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminMslAiV2Controller.collectionInfo(req, res);
  }
);

Router.delete(
  "/collection",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminMslAiV2Controller.deleteCollection(req, res);
  }
);

Router.get(
  "/test-qdrant",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminMslAiV2Controller.testQdrant(req, res);
  }
);

Router.get(
  "/global-limits",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminMslAiV2Controller.getGlobalLimits(req, res);
  }
);

Router.put(
  "/global-limits",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminMslAiV2Controller.updateGlobalLimits(req, res);
  }
);

Router.put(
  "/student-limits",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminMslAiV2Controller.updateStudentLimits(req, res);
  }
);

Router.get(
  "/all-students-usage",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminMslAiV2Controller.allStudentsUsage(req, res);
  }
);

Router.get(
  "/student-usage/:studentId",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminMslAiV2Controller.studentUsage(req, res);
  }
);

Router.get(
  "/ai/history",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminMslAiV2Controller.history(req, res);
  }
);

export default Router;
