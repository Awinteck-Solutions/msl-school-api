import * as express from "express";
import { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { MslAiV2Controller } from "../controllers/mslAi.v2.controller";

const Router = express.Router();

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: "Too many requests, please try again later.",
});

Router.post(
  "/query-general-stream",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  chatLimiter,
  (req: Request, res: Response) => {
    MslAiV2Controller.queryGeneralStream(req, res);
  }
);

Router.post(
  "/query-general",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  chatLimiter,
  (req: Request, res: Response) => {
    MslAiV2Controller.queryGeneral(req, res);
  }
);

export default Router;
