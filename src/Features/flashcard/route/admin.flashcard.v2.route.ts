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
import { AdminFlashcardV2Controller } from "../controllers/admin.flashcard.v2.controller";

interface MulterRequest extends Request {
  file?: multer.File;
  files?: {
    [fieldname: string]: multer.File[];
  };
}

const Router = express.Router();

Router.get(
  "/",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.ONE_HOUR, keyPrefix: "admin:flashcard:all" }),
  (req: Request, res: Response) => {
    AdminFlashcardV2Controller.adminAll(req, res);
  }
);

Router.get(
  "/by-course/:courseId/old",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.TWO_MINUTES, keyPrefix: "admin:flashcard:by-course" }),
  (req: Request, res: Response) => {
    AdminFlashcardV2Controller.byCourseOld(req, res);
  }
);

Router.post(
  "/create",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["flashcard"]),
  uploadToMemory.single("upload"),
  (req: MulterRequest, res: Response) => {
    AdminFlashcardV2Controller.create(req, res);
  }
);

Router.patch(
  "/thumbnail",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["flashcard"]),
  uploadToMemory.single("upload"),
  (req: MulterRequest, res: Response) => {
    AdminFlashcardV2Controller.updateThumbnail(req, res);
  }
);

Router.post(
  "/:id/add-item",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["flashcard"]),
  uploadToMemory.fields([
    { name: "termImage", maxCount: 1 },
    { name: "definitionImage", maxCount: 1 },
  ]),
  (req: MulterRequest, res: Response) => {
    AdminFlashcardV2Controller.addItem(req, res);
  }
);

Router.put(
  "/:id/add-items",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["flashcard"]),
  (req: Request, res: Response) => {
    AdminFlashcardV2Controller.addItems(req, res);
  }
);

Router.patch(
  "/item/upload-image",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["flashcard"]),
  uploadToMemory.single("upload"),
  (req: MulterRequest, res: Response) => {
    AdminFlashcardV2Controller.uploadItemImage(req, res);
  }
);

Router.patch(
  "/:id/update",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["flashcard"]),
  (req: Request, res: Response) => {
    AdminFlashcardV2Controller.update(req, res);
  }
);

Router.delete(
  "/:id/delete",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["flashcard"]),
  (req: Request, res: Response) => {
    AdminFlashcardV2Controller.delete(req, res);
  }
);

Router.put(
  "/:flashcardId/update-item",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["flashcard"]),
  (req: Request, res: Response) => {
    AdminFlashcardV2Controller.updateItem(req, res);
  }
);

Router.delete(
  "/:flashcardId",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["flashcard"]),
  (req: Request, res: Response) => {
    AdminFlashcardV2Controller.deleteItem(req, res);
  }
);

Router.put(
  "/:id/link",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["flashcard"]),
  (req: Request, res: Response) => {
    AdminFlashcardV2Controller.link(req, res);
  }
);

Router.put(
  "/:id/unlink",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["flashcard"]),
  (req: Request, res: Response) => {
    AdminFlashcardV2Controller.unlink(req, res);
  }
);

Router.get(
  "/:id/leaderboard/complete",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.TWO_MINUTES, keyPrefix: "admin:flashcard:leaderboard:complete" }),
  (req: Request, res: Response) => {
    AdminFlashcardV2Controller.leaderboardComplete(req, res);
  }
);

Router.delete(
  "/:id/leaderboard/reset",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["flashcard"]),
  (req: Request, res: Response) => {
    AdminFlashcardV2Controller.leaderboardReset(req, res);
  }
);

export default Router;
