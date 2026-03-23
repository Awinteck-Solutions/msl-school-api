import * as express from "express";
import { Response, Request } from "express";
import { uploadToMemory } from "../../../helpers/uploader";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";
import { Roles } from "../../../enums/roles.enum";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import { AdminQuizV2Controller } from "../controllers/admin.quiz.v2.controller";
import multer from "multer";

interface MulterRequest extends Request {
  file?: multer.File;
  files?: multer.File[];
}

const Router = express.Router();

Router.patch(
  "/thumbnail",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  uploadToMemory.single("upload"),
  (req: MulterRequest, res: Response) => {
    AdminQuizV2Controller.updateThumbnail(req, res);
  }
);

Router.get(
  "/all",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "admin:quiz:all" }),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.adminAll(req, res);
  }
);

Router.get(
  "/single/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "admin:quiz:single" }),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.single(req, res);
  }
);

Router.get(
  "/by-course/:course",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "admin:quiz:by-course" }),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.byCourse(req, res);
  }
);

Router.patch(
  "/toggle/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.toggle(req, res);
  }
);

Router.patch(
  "/info",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.updateInfo(req, res);
  }
);

Router.delete(
  "/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.delete(req, res);
  }
);

Router.post(
  "/add",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.add(req, res);
  }
);

Router.patch(
  "/update",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.update(req, res);
  }
);

Router.post(
  "/quiz-item",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.addQuizItem(req, res);
  }
);

Router.post(
  "/quiz-item-with-objective-image",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  uploadToMemory.array("objectiveImages", 4),
  (req: MulterRequest, res: Response) => {
    AdminQuizV2Controller.addQuizItemWithObjectiveImage(req, res);
  }
);

Router.put(
  "/quiz-item-with-objective-image",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  uploadToMemory.array("objectiveImages", 4),
  (req: MulterRequest, res: Response) => {
    AdminQuizV2Controller.updateQuizItemWithObjectiveImage(req, res);
  }
);

Router.put(
  "/quiz-item-with-objective-image/v2",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  uploadToMemory.array("objectiveImages", 4),
  (req: MulterRequest, res: Response) => {
    AdminQuizV2Controller.updateQuizItemWithObjectiveImageV2(req, res);
  }
);

Router.put(
  "/quiz-item",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.updateQuizItem(req, res);
  }
);

Router.patch(
  "/quiz-item/thumbnail",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  uploadToMemory.single("upload"),
  (req: MulterRequest, res: Response) => {
    AdminQuizV2Controller.updateQuizItemThumbnail(req, res);
  }
);

Router.delete(
  "/quiz-item",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.deleteQuizItem(req, res);
  }
);

Router.patch(
  "/course",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz", "course"]),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.addCourse(req, res);
  }
);

Router.patch(
  "/course-to-many-quiz",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz", "course"]),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.courseToManyQuiz(req, res);
  }
);

Router.delete(
  "/course",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz", "course"]),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.removeCourse(req, res);
  }
);

Router.patch(
  "/student",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.addStudent(req, res);
  }
);

Router.delete(
  "/student",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.removeStudent(req, res);
  }
);

Router.get(
  "/by-student/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.TWO_MINUTES, keyPrefix: "admin:quiz:by-student" }),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.byStudent(req, res);
  }
);

Router.patch(
  "/quiz-item-answernotes/thumbnail",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  uploadToMemory.single("upload"),
  (req: MulterRequest, res: Response) => {
    AdminQuizV2Controller.updateQuizItemAnswerNotesImage(req, res);
  }
);

Router.delete(
  "/quiz-item-answernotes/thumbnail/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.deleteQuizItemAnswerNotesImage(req, res);
  }
);

Router.get(
  "/by-course/:course/student/:studentId",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.TWO_MINUTES, keyPrefix: "admin:quiz:by-course-student" }),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.byCourseStudentV(req, res);
  }
);

Router.get(
  "/quiz-response/all",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "admin:quiz:response:all" }),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.quizResponseAll(req, res);
  }
);

Router.delete(
  "/quiz_response/delete/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.quizResponseDelete(req, res);
  }
);

Router.get(
  "/quiz-response/leaderboard",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "admin:quiz:response:leaderboard" }),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.quizResponseLeaderboardAll(req, res);
  }
);

Router.delete(
  "/quiz-response/leaderboard/:quiz_id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  (req: Request, res: Response) => {
    AdminQuizV2Controller.quizResponseLeaderboardDelete(req, res);
  }
);

export default Router;
