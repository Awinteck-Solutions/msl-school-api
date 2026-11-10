import * as express from "express";
import { Response, Request } from "express";
import { SystemController } from "../controllers/system.controller";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";

const Router = express.Router();


// Admin only: the full list of release records.
Router.get(
  "/",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "system:all" }),
  (req: Request, res: Response) => {
    SystemController.all(req, res);
  }
);

Router.get(
  "/update-available",
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "system:latest" }),
  (req: Request, res: Response) => {
    SystemController.latest(req, res);
  }
);

Router.post(
  "/add",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["system"]),
  (req: Request, res: Response) => {
    SystemController.add(req, res);
  }
);

Router.patch(
  "/update",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["system"]),
  (req: Request, res: Response) => {
    SystemController.update(req, res);
  }
);

export default Router;