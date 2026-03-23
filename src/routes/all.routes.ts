import * as express from "express"; 
import path = require("path");
import { v1Router } from "./v1.routes";
import { v2Router } from "./v2.routes";

const Router = express.Router();

Router.use("/v1", v1Router)
Router.use("/v2", v2Router)
 


export { Router }