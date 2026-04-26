import * as express from "express";
import { Request, Response } from "express";
import multer = require("multer");
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";
import { Roles } from "../../../enums/roles.enum";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import { upload, uploadToMemory } from "../../../helpers/uploader";
import { AdminLessonV2Controller } from "../controllers/admin.lesson.v2.controller";

const Router = express.Router();


Router.post(
  "/upload",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson"]),
  uploadToMemory.single("upload"),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.upload(req, res);
  }
);

Router.post(
  "/add-pdf",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson"]),
  uploadToMemory.single("upload"),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.addPdf(req, res);
  }
);

Router.post(
  "/add-video",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson"]),
  uploadToMemory.single("upload"),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.addVideo(req, res);
  }
);

Router.post(
  "/add-video-compress",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson"]),
  uploadToMemory.single("upload"),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.addVideoCompress(req, res);
  }
);

Router.post(
  "/add-video-extra",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson"]),
  uploadToMemory.single("upload"),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.addVideoExtra(req, res);
  }
);

Router.post(
  "/add-pdf-extra",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson"]),
  uploadToMemory.single("upload"),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.addPdfExtra(req, res);
  }
);

Router.post(
  "/add",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson", "course"]),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.add(req, res);
  }
);

Router.post(
  "/add-lesson",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson", "course"]),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.addLesson(req, res);
  }
);

Router.post(
  "/link-to-course",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson", "course"]),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.linkToCourse(req, res);
  }
);

Router.patch(
  "/unlink-from-course",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson", "course"]),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.unlinkFromCourse(req, res);
  }
);

Router.get(
  "/public-lessons",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.TEN_MINUTES, keyPrefix: "admin:lesson:public" }),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.publicLessons(req, res);
  }
);

Router.patch(
  "/bulk/update",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson", "course"]),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.bulkUpdate(req, res);
  }
);

Router.post(
  "/add-resource",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson"]),
  uploadToMemory.single("upload"),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.addResource(req, res);
  }
);

Router.delete(
  "/resource/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson"]),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.deleteResource(req, res);
  }
);

Router.delete(
  "/delete-pdf",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson"]),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.deletePdf(req, res);
  }
);

Router.delete(
  "/delete-video",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson"]),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.deleteVideo(req, res);
  }
);


Router.patch(
  "/update",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson", "course"]),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.update(req, res);
  }
);

Router.delete(
  "/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson", "course"]),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.delete(req, res);
  }
);

Router.get(
  "/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.TWO_MINUTES, keyPrefix: "admin:lesson:single" }),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.single(req, res);
  }
);

Router.post(
  "/upload-video",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson"]),
  uploadToMemory.single("upload"),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.uploadVideoToBucket(req, res);
  }
);

Router.post(
  "/upload-file",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["lesson"]),
  uploadToMemory.single("upload"),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.uploadFileToBucket(req, res);
  }
);

Router.get(
  "/s3/resource",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.TWO_MINUTES, keyPrefix: "admin:lesson:resource" }),
  (req: Request, res: Response) => {
    AdminLessonV2Controller.s3Resource(req, res);
  }
);

export default Router;
