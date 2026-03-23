import * as express from "express";
import { Response, Request } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { cacheInvalidation } from "../../../middlewares/cacheInvalidation.middleware";
import { Roles } from "../../../enums/roles.enum";
import { FeedbackV2Controller } from "../controllers/feedback.v2.controller";

const Router = express.Router();

Router.post(
  "/",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  cacheInvalidation(["feedback"]),
  (req: Request, res: Response) => {
    FeedbackV2Controller.add(req, res);
  }
);

export default Router;