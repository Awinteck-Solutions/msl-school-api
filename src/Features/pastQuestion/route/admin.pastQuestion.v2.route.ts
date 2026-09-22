import * as express from "express";
import { Request, Response } from "express";
import multer = require("multer");
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { AdminPastQuestionV2Controller } from "../controllers/admin.pastQuestion.v2.controller";

const Router = express.Router();

const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === "application/pdf" ||
      file.originalname.toLowerCase().endsWith(".pdf")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

Router.use(authentification, authorization([Roles.ADMIN]));

Router.post(
  "/",
  uploadPdf.single("file"),
  (req: Request, res: Response) => {
    AdminPastQuestionV2Controller.create(req, res);
  }
);

Router.get("/insights/analytics", (req: Request, res: Response) => {
  AdminPastQuestionV2Controller.insightAnalytics(req, res);
});

Router.get("/", (req: Request, res: Response) => {
  AdminPastQuestionV2Controller.list(req, res);
});

Router.get("/:id", (req: Request, res: Response) => {
  AdminPastQuestionV2Controller.getOne(req, res);
});

Router.patch("/:id", (req: Request, res: Response) => {
  AdminPastQuestionV2Controller.update(req, res);
});

Router.put("/:id/questions", (req: Request, res: Response) => {
  AdminPastQuestionV2Controller.updateQuestions(req, res);
});

Router.post("/:id/process", (req: Request, res: Response) => {
  AdminPastQuestionV2Controller.process(req, res);
});

Router.delete("/:id", (req: Request, res: Response) => {
  AdminPastQuestionV2Controller.remove(req, res);
});

export default Router;
