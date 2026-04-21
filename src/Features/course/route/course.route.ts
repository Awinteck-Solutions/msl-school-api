import * as express from "express";
import { Response, Request } from "express";
import { upload } from "../../../helpers/uploader";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { CourseController } from "../controllers/course.controller";

const Router = express.Router();

// ----------------------------------------- COURSE ROUTES ---------------------------------------------------
Router.get(
  "/all",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.all(req, res);
  }
);

Router.get(
  "/all/v3l",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.allV3(req, res);
  }
);

Router.get(
  "/all/v2",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.allV2(req, res);
  }
);

Router.get(
  "/single/v2/:id",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.singleV2(req, res);
  }
);

Router.get(
  "/all/new/:student_id",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.allNew(req, res);
  }
);

Router.get(
  "/single/:id",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.single(req, res);
  }
);



Router.get(
  "/user/:email",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.userCourses(req, res);
  }
);

Router.get(
  "/v2/user/:email",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.userCoursesV2(req, res);
  }
);

Router.get(
  "/v2/user/:email/with-quizzes",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.userCoursesWithQuizzes(req, res);
  }
);

Router.get(
  "/test/:email",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.userCoursesTest(req, res);
  }
);

Router.get(
  "/everything",
  authentification,
  authorization([Roles.USER, Roles.STAFF_JUNIOR, Roles.STAFF_SENIOR, Roles.AUDITOR, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.everything(req, res);
  }
);

Router.get(
  "/everything/single/:id",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.everythingSingle(req, res);
  }
);

Router.get(
  "/course/all",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.adminCourseAll(req, res);
  }
);

Router.get(
  "/course/all/v2",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.adminCourseAllV2(req, res);
  }
);

Router.post(
  "/add",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  upload.single("upload"),
  (req: Request, res: Response) => {
    CourseController.addCourse(req, res);
  }
);

Router.post(
  "/update",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.updateCourse(req, res);
  }
);

Router.post(
  "/update/thumbnail/old",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  upload.single("upload"),
  (req: Request, res: Response) => {
    CourseController.updateThumbnailOld(req, res);
  }
);

Router.post(
  "/update/thumbnail",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  upload.single("upload"),
  (req: Request, res: Response) => {
    CourseController.updateThumbnail(req, res);
  }
);

Router.get(
  "/delete/:id",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.deleteCourse(req, res);
  }
);

Router.post(
  "/update/status",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.updateStatus(req, res);
  }
);

Router.post(
  "/update/achive",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.updateArchive(req, res);
  }
);

Router.patch(
  "/archived/student",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.addArchivedStudent(req, res);
  }
);

Router.delete(
  "/archived/student",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.removeArchivedStudent(req, res);
  }
);

Router.get(
  "/archived/by_student/:id",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.archivedByStudent(req, res);
  }
);

Router.patch(
  "/deactivated_course/student",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.addDeactivatedStudent(req, res);
  }
);

Router.delete(
  "/deactivated_course/student",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.removeDeactivatedStudent(req, res);
  }
);

Router.get(
  "/deactivated_course/by_student/:id",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.deactivatedByStudent(req, res);
  }
);

Router.post(
  "/link-courses",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.linkCourses(req, res);
  }
);

Router.post(
  "/unlink-courses",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CourseController.unlinkCourses(req, res);
  }
);

export default Router;