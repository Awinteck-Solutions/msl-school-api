import * as express from "express";
import { Response, Request } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";
import { Roles } from "../../../enums/roles.enum";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import { FlashcardV2Controller } from "../controllers/flashcard.v2.controller";

const Router = express.Router();

Router.get(
  "/user-with-flashcards",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "flashcard:user:with" }),
  (req: Request, res: Response) => {
    FlashcardV2Controller.userCoursesWithFlashcards(req, res);
  }
);

Router.get(
  "/by-course/:courseId/student",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "flashcard:by-course" }),
  (req: Request, res: Response) => {
    FlashcardV2Controller.byCourseStudent(req, res);
  }
);

Router.get(
  "/by-student",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "flashcard:by-student" }),
  (req: Request, res: Response) => {
    FlashcardV2Controller.byStudent(req, res);
  }
);

Router.get(
  "/:id",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "flashcard:single" }),
  (req: Request, res: Response) => {
    FlashcardV2Controller.single(req, res);
  }
);

Router.post(
  "/:id/complete",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheInvalidation(["flashcard"]),
  (req: Request, res: Response) => {
    FlashcardV2Controller.complete(req, res);
  }
);

Router.post(
  "/:id/progress",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheInvalidation(["flashcard"]),
  (req: Request, res: Response) => {
    FlashcardV2Controller.progress(req, res);
  }
);

Router.get(
  "/:id/leaderboard",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "flashcard:leaderboard" }),
  (req: Request, res: Response) => {
    FlashcardV2Controller.leaderboard(req, res);
  }
);

export default Router;
