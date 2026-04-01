import * as express from "express";
import { Response, Request } from "express";
import multer from "multer";
import { uploadToMemory } from "../../../helpers/uploader";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";
import { Roles } from "../../../enums/roles.enum";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import { AdminAdvertV2Controller } from "../controllers/admin.advert.v2.controller";

interface MulterRequest extends Request {
  file?: multer.File;
}

const Router = express.Router();

Router.get(
  "/",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "admin:advert:all" }),
  (req: Request, res: Response) => {
    AdminAdvertV2Controller.all(req, res);
  }
);

Router.post(
  "/",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["advert"]),
  uploadToMemory.single("image"),
  (req: MulterRequest, res: Response) => {
    AdminAdvertV2Controller.add(req, res);
  }
);

Router.patch(
  "/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["advert"]),
  uploadToMemory.single("image"),
  (req: MulterRequest, res: Response) => {
    AdminAdvertV2Controller.update(req, res);
  }
);

Router.delete(
  "/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["advert"]),
  (req: Request, res: Response) => {
    AdminAdvertV2Controller.delete(req, res);
  }
);

export default Router;
