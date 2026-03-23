import * as express from "express";
import { Response, Request } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";
import { Roles } from "../../../enums/roles.enum";
import { LessonV2Controller } from "../controllers/lesson.v2.controller";

const Router = express.Router();

Router.patch(
  "/complete/:lessonId",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheInvalidation(["course", "lesson"]),
  (req: Request, res: Response) => {
    LessonV2Controller.completeLesson(req, res);
  }
);

export default Router;
