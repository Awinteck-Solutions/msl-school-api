import * as express from "express";
import { Request, Response } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { SubscriptionV2Controller } from "../controllers/subscription.v2.controller";

const Router = express.Router();

Router.get("/plan", (req: Request, res: Response) => {
  SubscriptionV2Controller.plan(req, res);
});

Router.get(
  "/resources",
  authentification,
  (req: Request, res: Response) => {
    SubscriptionV2Controller.resources(req, res);
  }
);

Router.get(
  "/status",
  authentification,
  (req: Request, res: Response) => {
    SubscriptionV2Controller.status(req, res);
  }
);

Router.post(
  "/subscribe",
  authentification,
  (req: Request, res: Response) => {
    SubscriptionV2Controller.subscribe(req, res);
  }
);

Router.get(
  "/invoices",
  authentification,
  (req: Request, res: Response) => {
    SubscriptionV2Controller.invoices(req, res);
  }
);

Router.post(
  "/invoices/:id/pay",
  authentification,
  (req: Request, res: Response) => {
    SubscriptionV2Controller.payInvoice(req, res);
  }
);

Router.get(
  "/verify/:reference",
  authentification,
  (req: Request, res: Response) => {
    SubscriptionV2Controller.verify(req, res);
  }
);

Router.get("/callback", (req: Request, res: Response) => {
  SubscriptionV2Controller.callbackView(req, res);
});

Router.post("/webhook", (req: Request, res: Response) => {
  SubscriptionV2Controller.webhook(req, res);
});

Router.post(
  "/cancel",
  authentification,
  (req: Request, res: Response) => {
    SubscriptionV2Controller.cancel(req, res);
  }
);

export default Router;
