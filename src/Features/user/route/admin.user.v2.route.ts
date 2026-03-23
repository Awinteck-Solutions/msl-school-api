import * as express from "express";
import { Request, Response } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";
import { Roles } from "../../../enums/roles.enum";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import { AdminUserV2Controller } from "../controllers/admin.user.v2.controller";

const Router = express.Router();

Router.get(
  "/all",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.THIRTY_MINUTES, keyPrefix: "admin:user:all" }),
  (req: Request, res: Response) => {
    AdminUserV2Controller.allV2(req, res);
  }
);

Router.get(
  "/single/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.THIRTY_MINUTES, keyPrefix: "admin:user:single" }),
  (req: Request, res: Response) => {
    AdminUserV2Controller.single(req, res);
  }
);

Router.patch(
  "/update-status/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["user"]),
  (req: Request, res: Response) => {
    AdminUserV2Controller.updateStatus(req, res);
  }
);

Router.get(
  "/non-users",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.THIRTY_MINUTES, keyPrefix: "admin:user:non-users" }),
  (req: Request, res: Response) => {
    AdminUserV2Controller.nonUsers(req, res);
  }
);

Router.post("/auth", (req: Request, res: Response) => {
  AdminUserV2Controller.nonUserAuth(req, res);
});

Router.get(
  "/non-users/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.THIRTY_MINUTES, keyPrefix: "admin:user:non-users:single" }),
  (req: Request, res: Response) => {
    AdminUserV2Controller.nonUserSingle(req, res);
  }
);

Router.post(
  "/non-users",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["user"]),
  (req: Request, res: Response) => {
    AdminUserV2Controller.createNonUser(req, res);
  }
);

Router.patch(
  "/non-users",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["user"]),
  (req: Request, res: Response) => {
    AdminUserV2Controller.updateNonUser(req, res);
  }
);

Router.delete(
  "/non-users/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["user"]),
  (req: Request, res: Response) => {
    AdminUserV2Controller.deleteNonUser(req, res);
  }
);

export default Router;
