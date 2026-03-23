import * as express from "express";
import { Response, Request } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { Roles } from "../../../enums/roles.enum";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";
import { AdminCategoryV2Controller } from "../controllers/admin.category.v2.controller";

const Router = express.Router();


Router.get(
  "/",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({
    ttlSeconds: CacheTtl.ONE_HOUR,
    keyPrefix: "admin:category:all",
  }),
  (req: Request, res: Response) => {
    AdminCategoryV2Controller.all(req, res);
  }
);

Router.get(
  "/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({
    ttlSeconds: CacheTtl.ONE_HOUR,
    keyPrefix: "admin:category:single",
  }),
  (req: Request, res: Response) => {
    AdminCategoryV2Controller.single(req, res);
  }
);


Router.post(
  "/",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["category"]),
  (req: Request, res: Response) => {
    AdminCategoryV2Controller.add(req, res);
  }
);

Router.patch(
  "/bulk-update",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["category"]),
  (req: Request, res: Response) => {
    AdminCategoryV2Controller.bulkUpdate(req, res);
  }
);

Router.patch(
  "/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["category"]),
  (req: Request, res: Response) => {
    AdminCategoryV2Controller.update(req, res);
  }
);

Router.delete(
  "/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["category"]),
  (req: Request, res: Response) => {
    AdminCategoryV2Controller.delete(req, res);
  }
);



export default Router;
