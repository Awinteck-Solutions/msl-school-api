import * as express from "express";
import { Response, Request } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";
import { Roles } from "../../../enums/roles.enum";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import { AdminRequestV2Controller } from "../controllers/admin.request.v2.controller";

const Router = express.Router();

Router.get(
  "/",
  authentification,
  authorization([Roles.ADMIN]),
  // cacheMiddleware({ ttlSeconds: CacheTtl.TEN_MINUTES, keyPrefix: "admin:request:all" }),
  (req: Request, res: Response) => {
    AdminRequestV2Controller.all(req, res);
  }
);


Router.patch(
  "/:id/toggle",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["request"]),
  (req: Request, res: Response) => {
    AdminRequestV2Controller.toggle(req, res);
  }
);

Router.delete(
  "/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["request"]),
  (req: Request, res: Response) => {
    AdminRequestV2Controller.delete(req, res);
  }
);

export default Router;
