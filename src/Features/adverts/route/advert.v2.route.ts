import * as express from "express";
import { Response, Request } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { Roles } from "../../../enums/roles.enum";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import { AdvertV2Controller } from "../controllers/advert.v2.controller";

const Router = express.Router();

Router.get(
  "/",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.TWO_MINUTES, keyPrefix: "advert:active" }),
  (req: Request, res: Response) => {
    AdvertV2Controller.activeList(req, res);
  }
);

export default Router;
