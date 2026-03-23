import * as express from "express";
import { Response, Request } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { CategoryController } from "../controllers/category.controller";

const Router = express.Router();

Router.post(
  "/add",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CategoryController.add(req, res);
  }
);

Router.patch(
  "/bulk/update",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CategoryController.bulkUpdate(req, res);
  }
);

Router.patch(
  "/:id",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CategoryController.update(req, res);
  }
);

Router.get(
  "/delete/:id",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CategoryController.delete(req, res);
  }
);

Router.get(
  "/single/:id",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CategoryController.single(req, res);
  }
);

Router.get(
  "/all",
  authentification,
  authorization([Roles.USER, Roles.ADMIN]),
  (req: Request, res: Response) => {
    CategoryController.all(req, res);
  }
);

export default Router;