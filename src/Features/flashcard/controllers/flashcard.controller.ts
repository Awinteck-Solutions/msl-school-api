import { Request, Response } from "express";
     import Flashcard from "../schema/flashcard.schema";

        export class FlashcardController {

            static async data(req: Request, res: Response) {
                try{
                  let response = await Flashcard.find()

                  return res.status(200).json({
                    success: true,
                    message: "Flashcard successful response",
                    response
                  });
                }catch(e){
                  return res.status(500).json({
                      success: false,
                      message: "System error"
                  });
                }
            }

        }