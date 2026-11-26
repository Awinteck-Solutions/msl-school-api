import * as express from "express";
import { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { PastQuestionV2Controller } from "../controllers/pastQuestion.v2.controller";

const Router = express.Router();

Router.use(authentification, authorization([Roles.USER, Roles.ADMIN]));

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many requests, please try again later.",
});

Router.get("/", (req: Request, res: Response) => {
  PastQuestionV2Controller.tree(req, res);
});

Router.get("/insights/analytics", (req: Request, res: Response) => {
  PastQuestionV2Controller.insightAnalytics(req, res);
});

Router.get("/insights", (req: Request, res: Response) => {
  PastQuestionV2Controller.courseInsights(req, res);
});

Router.get("/ai-quota", (req: Request, res: Response) => {
  PastQuestionV2Controller.aiQuota(req, res);
});

Router.get("/history", (req: Request, res: Response) => {
  PastQuestionV2Controller.history(req, res);
});

Router.post("/chat", chatLimiter, (req: Request, res: Response) => {
  PastQuestionV2Controller.chat(req, res);
});

Router.post("/chat-audio-stream", chatLimiter, (req: Request, res: Response) => {
  PastQuestionV2Controller.chatAudioStream(req, res);
});

Router.get("/:id/insights", (req: Request, res: Response) => {
  PastQuestionV2Controller.paperInsights(req, res);
});

Router.get("/:id/similar", (req: Request, res: Response) => {
  PastQuestionV2Controller.similar(req, res);
});

Router.get("/:id", (req: Request, res: Response) => {
  PastQuestionV2Controller.getPaper(req, res);
});

export default Router;
