import * as express from "express";
import { Response, Request } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";
import { Roles } from "../../../enums/roles.enum";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import { QuizV2Controller } from "../controllers/quiz.v2.controller";

const Router = express.Router();

Router.get(
  "/",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "quiz:all" }),
  (req: Request, res: Response) => {
    QuizV2Controller.all(req, res);
  }
);

Router.get(
  "/by-student",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "quiz:by-student" }),
  (req: Request, res: Response) => {
    QuizV2Controller.byStudentV3(req, res);
  }
);

Router.patch(
  "/quiz-response/update",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  (req: Request, res: Response) => {
    QuizV2Controller.quizResponseUpdate(req, res);
  }
);

Router.post(
    "/quiz-response/add",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheInvalidation(["quiz"]),
  (req: Request, res: Response) => {
    QuizV2Controller.quizResponseAdd(req, res);
  }
);

Router.get(
  "/quiz-response/leaderboard/:quiz_id",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "quiz:leaderboard" }),
  (req: Request, res: Response) => {
    QuizV2Controller.quizResponseLeaderboard(req, res);
  }
);

Router.get(
  "/quiz-response/by-quiz-id/:quiz_id",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "quiz:response:by-quiz" }),
  (req: Request, res: Response) => {
    QuizV2Controller.quizResponseByQuizId(req, res);
  }
);

Router.get(
  "/by-course/:courseId/student",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "quiz:by-course" }),
  (req: Request, res: Response) => {
    QuizV2Controller.byCourseStudent(req, res);
  }
);

Router.get(
  "/:id",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "quiz:single" }),
  (req: Request, res: Response) => {
    QuizV2Controller.single(req, res);
  }
);

export default Router;
