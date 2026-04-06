import * as express from "express";
import { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import multer = require("multer");
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { AdminGeminiAiV2Controller } from "../controllers/admin.geminiAi.v2.controller";

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
    AdminGeminiAiV2Controller.listPdfs(req, res);
  }
); 

Router.get(
  "/list-videos",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.listVideos(req, res);
  }
);
 
// USE THIS
Router.post(
  "/process-from-url",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.processSingleFromUrl(req, res);
  }
);

// USE THIS
Router.post(
  "/process-course-lessons-for-embedding",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.processCourseLessonsForEmbedding(req, res);
  }
);

Router.post(
  "/process-course-lessons-pdfs-for-embedding",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.processCourseLessonsPdfsForEmbedding(req, res);
  }
);

Router.post(
  "/process-all-courses-lessons-for-embedding",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.processAllCoursesLessonsForEmbedding(req, res);
  }
);

Router.post(
  "/process-all-courses-lessons-pdfs-for-embedding",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.processAllCoursesLessonsPdfsForEmbedding(req, res);
  }
);

// USE THIS
Router.get(
  "/course-lessons-processing-status",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.getCourseLessonsProcessingStatus(req, res);
  }
);

Router.get(
  "/course-lessons-processing-progress",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.getCourseLessonsProcessingProgress(req, res);
  }
);

// USE THIS
Router.get(
  "/processed-lessons",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.getProcessedLessons(req, res);
  }
);

Router.post(
  "/upload-pdf",
  authentification,
  authorization([Roles.ADMIN]),
  upload.single("pdf"),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.uploadPdf(req, res);
  }
);

Router.post(
  "/upload-pdfs",
  authentification,
  authorization([Roles.ADMIN]),
  upload.array("pdfs", 10),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.uploadPdfs(req, res);
  }
);


Router.post(
  "/query",
  authentification,
  authorization([Roles.ADMIN]),
  chatLimiter,
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.query(req, res);
  }
);

Router.get(
  "/collection-info",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.collectionInfo(req, res);
  }
);

// Router.delete(
//   "/collection",
//   authentification,
//   authorization([Roles.ADMIN]),
//   (req: Request, res: Response) => {
//     AdminGeminiAiV2Controller.deleteCollection(req, res);
//   }
// );

Router.get(
  "/test-qdrant",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.testQdrant(req, res);
  }
);

Router.get(
  "/global-limits",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.getGlobalLimits(req, res);
  }
);

Router.put(
  "/global-limits",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.updateGlobalLimits(req, res);
  }
);

Router.put(
  "/student-limits",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.updateStudentLimits(req, res);
  }
);

Router.get(
  "/all-students-usage",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.allStudentsUsage(req, res);
  }
);

Router.get(
  "/student-usage/:studentId",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.studentUsage(req, res);
  }
);

Router.get(
  "/ai/history",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminGeminiAiV2Controller.history(req, res);
  }
);

export default Router;
