
import { Express, Request, Response } from "express"
import * as http from "http";
import * as express from 'express';
import * as bodyParser from "body-parser";
import { Router } from "./routes/all.routes";
import "reflect-metadata";
import * as dotenv from 'dotenv';
import { errorHandler } from "./middlewares/errorHandler.middleware";
import { requestLogger } from "./middlewares/requestLogger.middleware";
import * as cors from 'cors';
import path = require("path");
import connectToDatabase from "./database/data-source";
import { attachGeminiLiveProxy } from "./Features/geminiAi/live/geminiLiveProxy";


dotenv.config();
const app = express();
app.use(cors())
app.use(bodyParser.json({
    verify: (req: any, res, buf) => {
        req["rawBody"] = buf;
    }
}))
app.use(bodyParser.urlencoded({extended: true}))
app.use(requestLogger)
app.use(errorHandler)
app.use(Router)


app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req: Request, res: Response) => { 
    res.json({
        message: 'Welcome to MSL Business Version 2.0.0'
    })
})



connectToDatabase().then(() => { 
    const server = http.createServer(app);
    attachGeminiLiveProxy(server);
    server.listen(process.env.PORT || 3000, ()=> console.log(`Server running on port ${process.env.PORT}`))
}).catch((error) => {
    console.log('error :>> ', error);
})
