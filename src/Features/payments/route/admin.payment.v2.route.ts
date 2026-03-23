import * as express from "express";
import { Response, Request } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { AdminPaymentV2Controller } from "../controllers/admin.payment.v2.controller";

const Router = express.Router();

Router.get(
  "/",
  authentification,
  // authorization([Roles.ADMIN]),
  (req: Request, res: Response) => {
    AdminPaymentV2Controller.all(req, res);
  }
);

export default Router;
