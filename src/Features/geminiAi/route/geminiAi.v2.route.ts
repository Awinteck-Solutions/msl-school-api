import * as express from "express";
import { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import multer = require("multer");
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { requireActiveCourseEnrollment } from "../../../middlewares/requireCourseEnrollment.middleware";
import { Roles } from "../../../enums/roles.enum";
import { GeminiAiV2Controller } from "../controllers/geminiAi.v2.controller";

const Router = express.Router();

Router.use(
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  requireActiveCourseEnrollment
);

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
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

const rawAudio = express.raw({
  type: ["audio/*", "video/webm", "application/octet-stream"],
  limit: "25mb",
});

Router.post(
  "/query-general-stream",
  chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryGeneralStream(req, res);
  }
);

Router.get("/history", (req: Request, res: Response) => {
  GeminiAiV2Controller.history(req, res);
});

Router.get("/recent-activity", (req: Request, res: Response) => {
  GeminiAiV2Controller.nonChatHistory(req, res);
});

Router.get("/summaries", (req: Request, res: Response) => {
  GeminiAiV2Controller.summarizeHistory(req, res);
});

Router.get("/flashcards", (req: Request, res: Response) => {
  GeminiAiV2Controller.flashcardHistory(req, res);
});

Router.get("/quizzes", (req: Request, res: Response) => {
  GeminiAiV2Controller.quizHistory(req, res);
});

Router.post(
  "/query-general",
  chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryGeneral(req, res);
  }
);

Router.post(
  "/query-general-context",
  chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryGeneralWithContext(req, res);
  }
);

Router.post(
  "/query-general-context-stream",
  chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryGeneralWithContextStream(req, res);
  }
);

// returns chunks of text and then uses the fulltext to create audio chunks
Router.post(
  "/query-general-context-audio-stream",
  chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryGeneralWithContextAudioStream(req, res);
  }
);

Router.post(
  "/query-general-context-audio-binary",
  chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryGeneralWithContextAudioBinary(req, res);
  }
);

Router.post(
  "/query-general-context-audio-dual-stream",
  chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryGeneralWithContextAudioDualStream(req, res);
  }
);

// returns chunks of text and asynchronously uses it to create audio chunks
Router.post(
  "/query-general-context-audio-text-stream",
  chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryGeneralWithContextAudioTextStream(req, res);
  }
);

Router.post(
  "/query-general-context-text-stream-final-audio",
  chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryGeneralWithContextTextStreamFinalAudio(req, res);
  }
);

Router.post(
  "/query-image",
  chatLimiter,
  uploadImage.single("image"),
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryImage(req, res);
  }
);

Router.post(
  "/voice-to-text-stream",
  chatLimiter,
  upload.single("audio"),
  (req: Request, res: Response) => {
    GeminiAiV2Controller.voiceToTextStream(req, res);
  }
);

Router.post(
  "/voice-to-text-raw-stream",
  chatLimiter,
  rawAudio,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.voiceToTextRawStream(req, res);
  }
);

Router.post(
  "/voice-to-text",
  chatLimiter,
  upload.single("audio"),
  (req: Request, res: Response) => {
    GeminiAiV2Controller.voiceToText(req, res);
  }
);

Router.post(
  "/voice-to-text-raw",
  chatLimiter,
  rawAudio,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.voiceToTextRaw(req, res);
  }
);

Router.post(
  "/summarize",
  chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.summarize(req, res);
  }
);

Router.post(
  "/generate-flashcards",
  chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.generateFlashcards(req, res);
  }
);

Router.post(
  "/generate-quiz",
  chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.generateQuiz(req, res);
  }
);

export default Router;
