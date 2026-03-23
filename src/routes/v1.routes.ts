import * as express from "express";

import userV1Routes from "../Features/user/route/user.route";
import courseV1Routes from '../Features/course/route/course.route';
import categoryRoutes from "../Features/category/route/category.route";

const Router = express.Router();

Router.use("/user", userV1Routes);
Router.use("/course", courseV1Routes);
Router.use("/category", categoryRoutes);

export { Router as v1Router };
