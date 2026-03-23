import * as express from "express";
import { Response, Request } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";
import { Roles } from "../../../enums/roles.enum";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import { AdminFaqV2Controller } from "../controllers/admin.faq.v2.controller";

const Router = express.Router();

Router.get(
  "/",
  authentification,
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "admin:faq:all" }),
  (req: Request, res: Response) => {
    AdminFaqV2Controller.all(req, res);
  }
);

Router.post(
  "/",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["faq"]),
  (req: Request, res: Response) => {
    AdminFaqV2Controller.add(req, res);
  }
);

Router.patch(
  "/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["faq"]),
  (req: Request, res: Response) => {
    AdminFaqV2Controller.update(req, res);
  }
);

Router.delete(
  "/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["faq"]),
  (req: Request, res: Response) => {
    AdminFaqV2Controller.delete(req, res);
  }
);

export default Router;
