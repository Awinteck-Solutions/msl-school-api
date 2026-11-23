import { Request, Response, Router } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { AdminAccessController } from "../adminAccess.controller";

const router = Router();

router.use(authentification, authorization([Roles.ADMIN]));

router.get("/me", (req: Request, res: Response) => {
  AdminAccessController.me(req, res);
});

router.get("/roles", (req: Request, res: Response) => {
  AdminAccessController.roles(req, res);
});

router.put("/roles/:role", (req: Request, res: Response) => {
  AdminAccessController.updateRole(req, res);
});

router.get("/actions", (req: Request, res: Response) => {
  AdminAccessController.actions(req, res);
});

export default router;
