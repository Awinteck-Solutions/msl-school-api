import * as express from "express";
import { Response, Request } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { Roles } from "../../../enums/roles.enum";
import { CourseV2Controller } from "../controllers/course.v2.controller";
import { CacheTtl } from "../../../enums/cacheTtl.enum";

const Router = express.Router();

Router.get(
  "/user-courses",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  // cacheMiddleware({
  //   ttlSeconds: CacheTtl.ONE_HOUR,
  //   keyPrefix: "course:user",
  //   keyBuilder: (req) => {
  //     const query = new URLSearchParams(req.query as Record<string, string>);
  //     const userId =
  //       (req["currentUser"] as { id?: string } | undefined)?.id ?? "unknown";
  //     return `course:user:${req.method}:${req.baseUrl}${req.path}?${query.toString()}:user:${userId}`;
  //   },
  // }),
  (req: Request, res: Response) => {
    CourseV2Controller.userCoursesV2(req, res);
  }
);

Router.get(
  "/user-with-quizzes",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  // cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "course:user:quizzes" }),
  (req: Request, res: Response) => {
    CourseV2Controller.userCoursesWithQuizzes(req, res);
  }
);

Router.get(
  "/",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  // cacheMiddleware({ ttlSeconds: CacheTtl.TWO_MINUTES, keyPrefix: "course:all" }),
  (req: Request, res: Response) => {
    CourseV2Controller.courseAllV2(req, res);
  }
);


Router.get(
  "/:id",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  // cacheMiddleware({
  //   ttlSeconds: CacheTtl.ONE_HOUR,
  //   keyPrefix: "course:single",
  //   keyBuilder: (req) => {
  //     const query = new URLSearchParams(req.query as Record<string, string>);
  //     const userId =
  //       (req["currentUser"] as { id?: string } | undefined)?.id ?? "unknown";
  //     return `course:single:${req.method}:${req.baseUrl}${req.path}?${query.toString()}:user:${userId}`;
  //   },
  // }),
  (req: Request, res: Response) => {
    CourseV2Controller.singleV2(req, res);
  }
);

export default Router;
