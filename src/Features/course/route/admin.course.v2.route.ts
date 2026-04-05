import * as express from "express";
import { Response, Request } from "express";
import { upload } from "../../../helpers/uploader";
import { cacheMiddleware } from "../../../middlewares/cache.middleware";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { CacheTtl } from "../../../enums/cacheTtl.enum";
import { AdminCourseV2Controller } from "../controllers/admin.course.v2.controller";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";

const Router = express.Router();


Router.get(
  "/",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.THIRTY_MINUTES, keyPrefix: "admin:course:all" }),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.adminCourseAllV2(req, res);
  }
);

Router.get(
  "/by-student-id/:student_id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.TWO_MINUTES, keyPrefix: "admin:course:by-student-id" }),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.allNew(req, res);
  }
);

Router.get(
  "/by-student-email/:email",
  authentification,
  authorization([Roles.ADMIN]),
  // cacheMiddleware({ ttlSeconds: CacheTtl.TWO_MINUTES, keyPrefix: "admin:course:user" }),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.userCourses(req, res);
  }
);


Router.get(
  "/single/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.TWO_MINUTES, keyPrefix: "admin:course:admin:single" }),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.adminSingleV2(req, res);
  }
);

Router.get(
  "/everything",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.THIRTY_MINUTES, keyPrefix: "admin:course:all" }),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.everything(req, res);
  }
);

Router.get(
  "/everything/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.TWO_MINUTES, keyPrefix: "admin:course:everything:single" }),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.everythingSingle(req, res);
  }
);

Router.post(
  "/",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["course"]),
  upload.single("upload"),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.addCourse(req, res);
  }
);

Router.patch(
  "/",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["course"]),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.updateCourse(req, res);
  }
);


Router.patch(
  "/update-thumbnail",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["course"]),
  upload.single("upload"),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.updateThumbnail(req, res);
  }
);

Router.delete(
  "/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["course"]),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.deleteCourse(req, res);
  }
);

Router.patch(
  "/update-status",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["course"]),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.updateStatus(req, res);
  }
);

Router.patch(
  "/update-archive",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["course"]),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.updateArchive(req, res);
  }
);

Router.post(
  "/add-archived-student",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["course"]),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.addArchivedStudent(req, res);
  }
);

Router.delete(
  "/remove-archived-student",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["course"]),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.removeArchivedStudent(req, res);
  }
);

Router.get(
  "/archived-by-student/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.TWO_MINUTES, keyPrefix: "admin:course:archived:by-student" }),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.archivedByStudent(req, res);
  }
);

Router.patch(
  "/add-deactivated-student",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["course"]),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.addDeactivatedStudent(req, res);
  }
);

Router.delete(
  "/remove-deactivated-student",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["course"]),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.removeDeactivatedStudent(req, res);
  }
);

Router.get(
  "/deactivated-by-student/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.TWO_MINUTES, keyPrefix: "admin:course:deactivated:by-student" }),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.deactivatedByStudent(req, res);
  }
);

Router.post(
  "/link-courses-to-course",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["course"]),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.linkCourses(req, res);
  }
);

Router.post(
  "/unlink-courses-from-course",
  authentification,
  authorization([Roles.ADMIN]),
  cacheInvalidation(["course"]),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.unlinkCourses(req, res);
  }
);


Router.get(
  "/:id",
  authentification,
  authorization([Roles.ADMIN]),
  cacheMiddleware({ ttlSeconds: CacheTtl.TWO_MINUTES, keyPrefix: "admin:course:admin" }),
  (req: Request, res: Response) => {
    AdminCourseV2Controller.adminV2(req, res);
  }
);

export default Router;
