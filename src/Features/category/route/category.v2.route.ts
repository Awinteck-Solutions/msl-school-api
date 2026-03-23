import * as express from "express";
import { Response, Request } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { Roles } from "../../../enums/roles.enum";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import { CategoryV2Controller } from "../controllers/category.v2.controller";

const Router = express.Router();

Router.get(
  "/",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "category:all" }),
  (req: Request, res: Response) => {
    CategoryV2Controller.all(req, res);
  }
);

export default Router;
