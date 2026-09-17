import * as express from "express";
import { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import multer = require("multer");
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { requireActiveSubscription } from "../../../middlewares/requireActiveSubscription.middleware";
import { Roles } from "../../../enums/roles.enum";
import { SubscriptionAiV2Controller } from "../controllers/subscriptionAi.v2.controller";

const Router = express.Router();

Router.use(
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  requireActiveSubscription
);

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many requests, please try again later.",
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("audio/") || file.mimetype === "video/webm") {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed"));
    }
  },
});

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

Router.post(
  "/query-general-stream",
  chatLimiter,
  (req: Request, res: Response) => {
    SubscriptionAiV2Controller.queryGeneralStream(req, res);
  }
);

Router.post("/query-general", (req: Request, res: Response) => {
  SubscriptionAiV2Controller.queryGeneral(req, res);
});

Router.post("/query-general-context", (req: Request, res: Response) => {
  SubscriptionAiV2Controller.queryGeneralWithContext(req, res);
});

Router.post("/query-general-context-stream", (req: Request, res: Response) => {
  SubscriptionAiV2Controller.queryGeneralWithContextStream(req, res);
});

Router.post(
  "/query-general-context-audio-text-stream",
  (req: Request, res: Response) => {
    SubscriptionAiV2Controller.queryGeneralWithContextAudioTextStream(req, res);
  }
);

Router.post(
  "/query-image",
  uploadImage.single("image"),
  (req: Request, res: Response) => {
    SubscriptionAiV2Controller.queryImage(req, res);
  }
);

Router.post(
  "/voice-to-text",
  upload.single("audio"),
  (req: Request, res: Response) => {
    SubscriptionAiV2Controller.voiceToText(req, res);
  }
);

Router.get("/history", (req: Request, res: Response) => {
  SubscriptionAiV2Controller.history(req, res);
});

Router.get("/recent-activity", (req: Request, res: Response) => {
  SubscriptionAiV2Controller.nonChatHistory(req, res);
});

Router.get("/summaries", (req: Request, res: Response) => {
  SubscriptionAiV2Controller.summarizeHistory(req, res);
});

Router.get("/flashcards", (req: Request, res: Response) => {
  SubscriptionAiV2Controller.flashcardHistory(req, res);
});

Router.get("/quizzes", (req: Request, res: Response) => {
  SubscriptionAiV2Controller.quizHistory(req, res);
});

Router.post("/summarize", (req: Request, res: Response) => {
  SubscriptionAiV2Controller.summarize(req, res);
});

Router.post("/generate-flashcards", (req: Request, res: Response) => {
  SubscriptionAiV2Controller.generateFlashcards(req, res);
});

Router.post("/generate-quiz", (req: Request, res: Response) => {
  SubscriptionAiV2Controller.generateQuiz(req, res);
});

export default Router;
