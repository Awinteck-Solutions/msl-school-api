import * as express from "express";
import { Request, Response } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import { AdminAnalyticsV2Controller } from "../controllers/admin.analytics.v2.controller";

const Router = express.Router();

Router.get(
  "/dashboard",
  // authentification,
  // authorization([Roles.ADMIN]),
  cacheMiddleware({
    ttlSeconds: CacheTtl.FIVE_MINUTES,
    keyPrefix: "admin:analytics:dashboard",
  }),
  (req: Request, res: Response) => {
    AdminAnalyticsV2Controller.dashboard(req, res);
  }
);

Router.get(
  "/students",
  // authentification,
  // authorization([Roles.ADMIN]),
  cacheMiddleware({
    ttlSeconds: CacheTtl.FIVE_MINUTES,
    keyPrefix: "admin:analytics:students",
  }),
  (req: Request, res: Response) => {
    AdminAnalyticsV2Controller.students(req, res);
  }
);

Router.get(
  "/enrollments",
  // authentification,
  // authorization([Roles.ADMIN]),
  cacheMiddleware({
    ttlSeconds: CacheTtl.FIVE_MINUTES,
    keyPrefix: "admin:analytics:enrollments",
  }),
  (req: Request, res: Response) => {
    AdminAnalyticsV2Controller.enrollments(req, res);
  }
);

Router.get(
  "/conversions",
  // authentification,
  // authorization([Roles.ADMIN]),
  cacheMiddleware({
    ttlSeconds: CacheTtl.FIVE_MINUTES,
    keyPrefix: "admin:analytics:conversions",
  }),
  (req: Request, res: Response) => {
    AdminAnalyticsV2Controller.conversions(req, res);
  }
);

Router.get(
  "/unique-active-course-students",
  // authentification,
  // authorization([Roles.ADMIN]),
  // cacheMiddleware({
  //   ttlSeconds: CacheTtl.FIVE_MINUTES,
  //   keyPrefix: "admin:analytics:unique-active-course-students",
  // }),
  (req: Request, res: Response) => {
    AdminAnalyticsV2Controller.uniqueActiveCourseStudents(req, res);
  }
);

Router.get(
  "/top-courses",
  // authentification,
  // authorization([Roles.ADMIN]),
  cacheMiddleware({
    ttlSeconds: CacheTtl.FIVE_MINUTES,
    keyPrefix: "admin:analytics:top-courses",
  }),
  (req: Request, res: Response) => {
    AdminAnalyticsV2Controller.topCourses(req, res);
  }
);

Router.get(
  "/top-quizzes",
  // authentification,
  // authorization([Roles.ADMIN]),
  cacheMiddleware({
    ttlSeconds: CacheTtl.FIVE_MINUTES,
    keyPrefix: "admin:analytics:top-quizzes",
  }),
  (req: Request, res: Response) => {
    AdminAnalyticsV2Controller.topQuizzes(req, res);
  }
);

Router.get(
  "/top-flashcards",
  // authentification,
  // authorization([Roles.ADMIN]),
  cacheMiddleware({
    ttlSeconds: CacheTtl.FIVE_MINUTES,
    keyPrefix: "admin:analytics:top-flashcards",
  }),
  (req: Request, res: Response) => {
    AdminAnalyticsV2Controller.topFlashcards(req, res);
  }
);

Router.get(
  "/top-students",
  authentification,
  // authorization([Roles.ADMIN]),
  cacheMiddleware({
    ttlSeconds: CacheTtl.FIVE_MINUTES,
    keyPrefix: "admin:analytics:top-students",
  }),
  (req: Request, res: Response) => {
    AdminAnalyticsV2Controller.topStudents(req, res);
  }
);

export default Router;
