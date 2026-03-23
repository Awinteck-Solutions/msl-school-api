import * as express from "express";
import { Request, Response } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { GamificationV2Controller } from "../controllers/gamification.v2.controller";

const Router = express.Router();

Router.get(
  "/me",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    GamificationV2Controller.getMyGamification(req, res);
  }
);

Router.get(
  "/leaderboard",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    GamificationV2Controller.getLeaderboard(req, res);
  }
);

export default Router;
