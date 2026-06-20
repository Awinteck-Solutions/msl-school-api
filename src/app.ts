
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
import { startStreakReminderCron } from "./Features/gamification/cron/streakReminder.cron";


dotenv.config();
const app = express();
process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandledRejection", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[process] uncaughtException", error);
});
app.use(cors())
app.use(bodyParser.json({
    verify: (req: any, res, buf) => {
        req["rawBody"] = buf;
    }
}))
app.use(bodyParser.urlencoded({extended: true}))
app.use(requestLogger)
app.use(Router)


app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req: Request, res: Response) => { 
    res.json({
        message: 'Welcome to MSL Business Version 2.0.1'
    })
})

app.use(errorHandler)



connectToDatabase().then(() => { 
    const server = http.createServer(app);
    attachGeminiLiveProxy(server);
    startStreakReminderCron({
        cronExpression: process.env.STREAK_REMINDER_CRON || "00 18 * * *",
    });
    server.listen(process.env.PORT || 3000, ()=> console.log(`Server running on port ${process.env.PORT} ✅`))
}).catch((error) => {
    console.log('error :>> ', error);
})
