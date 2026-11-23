import { Request, Response, Router } from "express";
import { authentification } from "../../../middlewares/authentication.middleware";
import { authorization } from "../../../middlewares/authorization.middleware";
import { Roles } from "../../../enums/roles.enum";
import { AdminAccessController } from "../adminAccess.controller";

const router = Router();

router.use(authentification, authorization([Roles.ADMIN]));

router.get("/past-question-usage", (req: Request, res: Response) => {
  AdminAccessController.pastQuestionUsage(req, res);
});

router.get("/conversations", (req: Request, res: Response) => {
  AdminAccessController.conversations(req, res);
});

router.get("/conversations/:id", (req: Request, res: Response) => {
  AdminAccessController.conversation(req, res);
});

export default router;
