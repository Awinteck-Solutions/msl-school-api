import * as express from "express";
import { Response, Request } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";
import { Roles } from "../../../enums/roles.enum";
import { RequestV2Controller } from "../controllers/request.v2.controller";

const Router = express.Router();

Router.post(
  "/add",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheInvalidation(["request"]),
  (req: Request, res: Response) => {
    RequestV2Controller.add(req, res);
  }
);

export default Router;
