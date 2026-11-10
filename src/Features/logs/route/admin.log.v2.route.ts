import * as express from "express";
import { Request, Response } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import { AdminLogV2Controller } from "../controllers/admin.log.v2.controller";

const Router = express.Router();

Router.get(
  "/",
  authentification,
  // authorization([Roles.ADMIN]),
  // cacheMiddleware({ ttlSeconds: CacheTtl.TWO_MINUTES, keyPrefix: "admin:logs:all" }),
  (req: Request, res: Response) => {
    AdminLogV2Controller.all(req, res);
  }
);

// Deleting is destructive, so these stay admin-only even though the list is open to any signed-in user.
Router.post(
  "/delete",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminLogV2Controller.removeMany(req, res);
  }
);

Router.post(
  "/delete-matching",
  authentification,
  authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminLogV2Controller.removeMatching(req, res);
  }
);

export default Router;
