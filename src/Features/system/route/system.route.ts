import * as express from "express";
import { Response, Request } from "express";
import { SystemController } from "../controllers/system.controller";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";
import { CacheTtl } from "../../../enums/cacheTtl.enum";

const Router = express.Router();


Router.get(
  "/",
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
  cacheInvalidation(["system"]),
  (req: Request, res: Response) => {
    SystemController.add(req, res);
  }
);

Router.patch(
  "/update",
  cacheInvalidation(["system"]),
  (req: Request, res: Response) => {
    SystemController.update(req, res);
  }
);

export default Router;