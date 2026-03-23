import * as express from "express";
import { Response, Request } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";
import { Roles } from "../../../enums/roles.enum";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import { AdminFeedbackV2Controller } from "../controllers/admin.feedback.v2.controller";

const Router = express.Router();

Router.get(
  "/",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "admin:feedback:all" }),
  (req: Request, res: Response) => {
    AdminFeedbackV2Controller.all(req, res);
  }
);

Router.delete(
  "/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["feedback"]),
  (req: Request, res: Response) => {
    AdminFeedbackV2Controller.delete(req, res);
  }
);

Router.patch(
  "/update-status",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["feedback"]),
  (req: Request, res: Response) => {
    AdminFeedbackV2Controller.updateStatus(req, res);
  }
);

Router.get(
  "/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "admin:feedback:single" }),
  (req: Request, res: Response) => {
    AdminFeedbackV2Controller.single(req, res);
  }
);

export default Router;
