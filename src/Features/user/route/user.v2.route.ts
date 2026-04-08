import * as express from "express";
import { Response, Request } from "express";
import { uploadToMemory } from "../../../helpers/uploader";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum"; 
import { UserService } from "../controllers/user.service";
import { UserV2Controller } from "../controllers/user.v2.controller";
import multer from "multer";

const Router = express.Router();

// ----------------------------------------- USER ROUTES ---------------------------------------------------

interface MulterRequest extends Request {
  file?: multer.File;
  files?: multer.File[];
}
Router.post(
  "/verify/device",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    UserService.verifyDevice(req, res);
  }
);

Router.post("/auth", (req: Request, res: Response) => {
  UserV2Controller.socialAuth(req, res);
});

Router.post(
  "/refresh-token",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    UserV2Controller.refreshToken(req, res);
  }
);


Router.patch(
  "/upload_image",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  uploadToMemory.single("upload"),
  (req: MulterRequest, res: Response) => {
    UserService.uploadImage(req, res);
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

Router.delete(
  "/delete",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    UserService.delete(req, res);
  }
);

Router.patch(
  "/profile",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    UserService.updateProfile(req, res);
  }
);

Router.patch(
  "/notification-settings",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    UserService.updateNotificationSettings(req, res);
  }
);

export default Router;