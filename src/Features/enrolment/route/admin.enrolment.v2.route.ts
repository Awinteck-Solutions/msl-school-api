import * as express from "express";
import { Response, Request } from "express";
import { uploadToMemory } from "../../../helpers/uploader";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { AdminEnrolmentV2Controller } from "../controllers/admin.enrolment.v2.controller";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import multer from "multer";
const Router = express.Router();

interface MulterRequest extends Request {
  file?: multer.File;
  files?: multer.File[];
}

Router.post(
  "/",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["enrolment"]),
  (req: Request, res: Response) => {
    AdminEnrolmentV2Controller.addOne(req, res);
  }
);

Router.delete(
  "/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["enrolment"]),
  (req: Request, res: Response) => {
    AdminEnrolmentV2Controller.deleteOne(req, res);
  }
);

Router.delete(
  "/delete-many",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["enrolment"]),
  (req: Request, res: Response) => {
    AdminEnrolmentV2Controller.deleteMany(req, res);
  }
);

Router.patch(
  "/deactivate-one",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["enrolment"]),
  (req: Request, res: Response) => {
    AdminEnrolmentV2Controller.deactivateOne(req, res);
  }
);

Router.put(
  "/deactivate-many",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["enrolment", "course"]),
  (req: Request, res: Response) => {
    AdminEnrolmentV2Controller.deactivateMany(req, res);
  }
);

Router.patch(
  "/",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["enrolment"]),
  (req: Request, res: Response) => {
    AdminEnrolmentV2Controller.update(req, res);
  }
);

Router.post(
  "/add-many",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["enrolment"]),
  (req: Request, res: Response) => {
    AdminEnrolmentV2Controller.addMany(req, res);
  }
);

Router.post(
  "/add-csv",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["enrolment"]),
  uploadToMemory.single("upload"),
  (req: MulterRequest, res: Response) => {
    AdminEnrolmentV2Controller.addCsv(req, res);
  }
);

Router.get(
  "/by-course/:id",
  authentification,
  authorization([Roles.ADMIN]),
  // cacheMiddleware({
  //   ttlSeconds: CacheTtl.THIRTY_MINUTES,
  //   keyPrefix: "admin:enrolment:by-course",
  // }),
  (req: Request, res: Response) => {
    AdminEnrolmentV2Controller.byCourse(req, res);
  }
);

Router.get(
  "/by-user/:email",
  authentification,
  authorization([Roles.ADMIN]),
  // cacheMiddleware({
  //   ttlSeconds: CacheTtl.TEN_MINUTES,
  //   keyPrefix: "admin:enrolment:user",
  // }),
  (req: Request, res: Response) => {
    AdminEnrolmentV2Controller.byUser(req, res);
  }
);

Router.post(
  "/enroll-user-to-many-courses",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["enrolment"]),
  (req: Request, res: Response) => {
    AdminEnrolmentV2Controller.enrollUserToManyCourses(req, res);
  }
);

Router.delete(
  "/unenroll-user-from-many-courses",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["enrolment"]),
  (req: Request, res: Response) => {
    AdminEnrolmentV2Controller.unenrollUserFromManyCourses(req, res);
  }
);

export default Router;
