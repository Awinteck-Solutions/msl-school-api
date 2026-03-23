import * as express from "express";
import { Response, Request } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { WindowsV2Controller } from "../controllers/windows.v2.controller";

const Router = express.Router();

Router.post(
  "/generate-code",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    WindowsV2Controller.generateCode(req, res);
  }
);


Router.post(
  "/validate-code",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    WindowsV2Controller.validateCode(req, res);
  }
);

Router.get(
  "/list-codes",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    WindowsV2Controller.listCodes(req, res);
  }
);

Router.get(
  "/login-with-code/:id",
  (req: Request, res: Response) => {
    WindowsV2Controller.loginWithCode(req, res);
  }
);

export default Router;
