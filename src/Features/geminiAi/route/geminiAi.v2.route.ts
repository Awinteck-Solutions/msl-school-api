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

// 
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

const rawAudio = express.raw({
  type: ["audio/*", "video/webm", "application/octet-stream"],
  limit: "25mb",
});

const withDetailedRequestLogging =
  (label: string, handler: (req: Request, res: Response) => void | Promise<void>) =>
  async (req: Request, res: Response): Promise<void> => {
    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();
    const requestId =
      (req.headers["x-request-id"] as string | undefined) ??
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const log = (step: string, details?: Record<string, unknown>) => {
      const elapsedMs = Date.now() - startedAt;
      // console.log(`[${label}] [${requestId}] ${step}`, {
      //   elapsedMs,
      //   method: req.method,
      //   path: req.originalUrl,
      //   ...(details ?? {}),
      // });
    };

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    const originalWriteHead = res.writeHead.bind(res);

    let bytesWritten = 0;
    let chunkCount = 0;
    let responseEnded = false;

    res.writeHead = ((...args: Parameters<Response["writeHead"]>) => {
      const statusCode = typeof args[0] === "number" ? args[0] : res.statusCode;
      log("response_headers_sent", { statusCode });
      return originalWriteHead(...args);
    }) as Response["writeHead"];

    res.write = ((...args: Parameters<Response["write"]>) => {
      const chunk = args[0];
      const size =
        typeof chunk === "string"
          ? Buffer.byteLength(chunk)
          : Buffer.isBuffer(chunk)
          ? chunk.length
          : 0;
      bytesWritten += size;
      chunkCount += 1;
      log("response_chunk_written", { chunkCount, chunkBytes: size, bytesWritten });
      return originalWrite(...args);
    }) as Response["write"];

    res.end = ((...args: Parameters<Response["end"]>) => {
      if (!responseEnded) {
        responseEnded = true;
        const chunk = args[0];
        const size =
          typeof chunk === "string"
            ? Buffer.byteLength(chunk)
            : Buffer.isBuffer(chunk)
            ? chunk.length
            : 0;
        bytesWritten += size;
        log("response_end_called", { finalChunkBytes: size, bytesWritten });
      }
      return originalEnd(...args);
    }) as Response["end"];

    res.on("finish", () => {
      log("response_finish", { statusCode: res.statusCode, bytesWritten, chunkCount });
    });

    res.on("close", () => {
      log("response_close", { statusCode: res.statusCode, bytesWritten, chunkCount });
    });

    res.on("error", (error) => {
      log("response_error", {
        error: error instanceof Error ? error.message : "unknown response error",
      });
    });

    req.on("aborted", () => {
      log("request_aborted_by_client");
    });

    req.on("error", (error) => {
      log("request_error", {
        error: error instanceof Error ? error.message : "unknown request error",
      });
    });

    log("request_started", {
      startedAtIso,
      contentType: req.headers["content-type"],
      contentLength: req.headers["content-length"],
    });

    try {
      await handler(req, res);
      log("controller_handler_resolved");
    } catch (error) {
      log("controller_handler_threw", {
        error: error instanceof Error ? error.message : "unknown controller error",
      });
      throw error;
    } finally {
      log("request_lifecycle_complete", {
        totalDurationMs: Date.now() - startedAt,
        headersSent: res.headersSent,
        writableEnded: res.writableEnded,
      });
    }
  };

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
  // chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryGeneral(req, res);
  }
);

Router.post(
  "/query-general-context",
  // chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryGeneralWithContext(req, res);
  }
);

// IN-USE FOR DESKTOP APP
Router.post(
  "/query-general-context-stream",
  // chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryGeneralWithContextStream(req, res);
  }
);

// returns chunks of text and then uses the fulltext to create audio chunks
Router.post(
  "/query-general-context-audio-stream",
  // chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryGeneralWithContextAudioStream(req, res);
  }
);

Router.post(
  "/query-general-context-audio-binary",
  // chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryGeneralWithContextAudioBinary(req, res);
  }
);

Router.post(
  "/query-general-context-audio-dual-stream",
  // chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryGeneralWithContextAudioDualStream(req, res);
  }
);

// IN-USE FOR DESKTOP APP
// returns chunks of text and asynchronously uses it to create audio chunks
Router.post(
  "/query-general-context-audio-text-stream",
  // chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryGeneralWithContextAudioTextStream(req, res);
  }
);

Router.post(
  "/query-general-context-text-stream-final-audio",
  // chatLimiter,
  // withDetailedRequestLogging(
  //   "query-general-context-text-stream-final-audio",
    async (req: Request, res: Response) => {
      await GeminiAiV2Controller.queryGeneralWithContextTextStreamFinalAudio(req, res);
    }
  // )
);

// IN-USE FOR DESKTOP APP
Router.post(
  "/query-image",
  // chatLimiter,
  uploadImage.single("image"),
  (req: Request, res: Response) => {
    GeminiAiV2Controller.queryImage(req, res);
  }
);

Router.post(
  "/voice-to-text-stream",
  // chatLimiter,
  upload.single("audio"),
  (req: Request, res: Response) => {
    GeminiAiV2Controller.voiceToTextStream(req, res);
  }
);

Router.post(
  "/voice-to-text-raw-stream",
  // chatLimiter,
  rawAudio,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.voiceToTextRawStream(req, res);
  }
);

// IN-USE FOR DESKTOP APP
Router.post(
  "/voice-to-text",
  // chatLimiter,
  upload.single("audio"),
  (req: Request, res: Response) => {
    GeminiAiV2Controller.voiceToText(req, res);
  }
);

Router.post(
  "/voice-to-text-raw",
  // chatLimiter,
  rawAudio,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.voiceToTextRaw(req, res);
  }
);

Router.post(
  "/summarize",
  // chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.summarize(req, res);
  }
);

Router.post(
  "/generate-flashcards",
  // chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.generateFlashcards(req, res);
  }
);

Router.post(
  "/generate-quiz",
  // chatLimiter,
  (req: Request, res: Response) => {
    GeminiAiV2Controller.generateQuiz(req, res);
  }
);

export default Router;
