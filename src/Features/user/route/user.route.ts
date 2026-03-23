import * as express from "express";
import { Response, Request } from "express";
import { upload } from "../../../helpers/uploader";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { UserController } from "../controllers/user.controller";
import { UserService } from "../controllers/user.service";

const Router = express.Router();

// ----------------------------------------- USER ROUTES ---------------------------------------------------
Router.post(
  "/register",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    UserController.register(req, res);
  }
);

Router.post(
  "/login",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    UserController.login(req, res);
  }
);

Router.post(
  "/login/new",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    UserController.loginNew(req, res);
  }
);

Router.post(
  "/verify/device",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    UserService.verifyDevice(req, res);
  }
);


Router.post(
  "/forgotpassword",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    UserController.forgotPassword(req, res);
  }
);

Router.post(
  "/resetpassword",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    UserController.resetPassword(req, res);
  }
);

Router.post(
  "/upload_image",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  upload.single("upload"),
  (req: Request, res: Response) => {
    UserService.uploadImage(req, res);
  }
);

Router.post(
  "/changepassword",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    UserController.changePassword(req, res);
  }
);

Router.get(
  "/profile",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    UserService.profile(req, res);
  }
);

Router.get(
  "/delete",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    UserService.delete(req, res);
  }
);

Router.post(
  "/profile/update",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    UserService.updateProfile(req, res);
  }
);

export default Router;