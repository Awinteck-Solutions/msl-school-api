import * as express from "express";
import { Response, Request } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { PaymentV2Controller } from "../controllers/payment.v2.controller";

const Router = express.Router();

Router.post(
  "/initiate",
  authentification,
  (req: Request, res: Response) => {
    PaymentV2Controller.initiate(req, res);
  }
);

Router.get(
  "/verify/:reference",
  authentification,
  (req: Request, res: Response) => {
    PaymentV2Controller.verify(req, res);
  }
);

Router.get(
  "/callback",
  (req: Request, res: Response) => {
    PaymentV2Controller.callbackView(req, res);
  }
);

Router.get(
  "/my",
  authentification,
  (req: Request, res: Response) => {
    PaymentV2Controller.myPayments(req, res);
  }
);

Router.post(
  "/webhook",
  (req: Request, res: Response) => {
    PaymentV2Controller.webhook(req, res);
  }
);

export default Router;
