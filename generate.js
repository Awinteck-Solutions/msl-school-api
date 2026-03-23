const fs = require("fs");
const path = require("path");

// Get the folder name from command-line arguments
const args = process.argv;
const nameIndex = args.indexOf("-n");

if (nameIndex === -1 || !args[nameIndex + 1]) {
  console.error("Usage: node generate -n <nameFolder>");
  process.exit(1);
}

const nameFolder = args[nameIndex + 1];
const basePath = path.join(__dirname, "src/Features", nameFolder);

// Define the folder structure
const folders = ["controllers", "dto", "schema", "enums", "route"];
const files = {
  controllers: {
    name: `${nameFolder}.controller.ts`,
    content: `import { Request, Response } from "express";
     import ${capitalize(nameFolder)} from "../schema/${nameFolder}.schema";

        export class ${capitalize(nameFolder)}Controller {

            static async data(req: Request, res: Response) {
                try{
                  let response = await ${capitalize(nameFolder)}.find()

                  return res.status(200).json({
                    success: true,
                    message: "${capitalize(nameFolder)} successful response",
                    response
                  });
                }catch(e){
                  return res.status(500).json({
                      success: false,
                      message: "System error"
                  });
                }
            }

        }`,
  },
  dto: {
    name: `${nameFolder}.dto.ts`,
    content: `export class ${capitalize(nameFolder)}DTO {
        id: string 
        data: string 
        createdAt: Date

        constructor(data) {
          this.id = data.id;
          this.data = data.data;
          this.createdAt = data.createdAt;
           }

        }`,
  },
  schema: {
    name: `${nameFolder}.schema.ts`,
    content: `const mongoose = require('mongoose')
const Schema = mongoose.Schema;


const ${capitalize(nameFolder)}Schema = new Schema({
    data: { type: String, required: false },
    status: {
        type: String,
        enum : ['ACTIVE','DEACTIVE'],
        default: 'ACTIVE',
    },
},  {timestamps: true})

const ${capitalize(nameFolder)} = mongoose.model('${capitalize(
      nameFolder
    )}', ${capitalize(nameFolder)}Schema);

export default ${capitalize(nameFolder)}

       `,
  },
  enums: {
    name: `${nameFolder}.enum.ts`,
    content: `export enum ${capitalize(nameFolder)}Enum{
        ACTIVE= 'active',
        INACTIVE= 'inactive'
        };
      `,
  },
  route: {
    name: `${nameFolder}.route.ts`,
    content: `import * as express from "express";
        import {Response, Request} from "express";
        import { ${capitalize(
          nameFolder
        )}Controller } from "../controllers/${nameFolder}.controller";
        const Router = express.Router();

    // ----------------------------------------- ${capitalize(nameFolder)} ROUTES ---------------------------------------------------
    //
    Router.get("/",
    (req: Request, res: Response) => {
        ${capitalize(nameFolder)}Controller.data(req, res)
    }
); \n

export default Router;`,
  },
};

// Function to capitalize first letter of a string
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Function to generate the feature module
function generateFeatureModule() {
  if (!fs.existsSync(basePath)) {
    fs.mkdirSync(basePath, {recursive: true});
    console.log(`📂 Created: Features/${nameFolder}`);
  }

  folders.forEach((folder) => {
    const folderPath = path.join(basePath, folder);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath);
      console.log(`📂 Created: ${folderPath}`);
    }

    // Create the corresponding file inside the folder with content
    const filePath = path.join(folderPath, files[folder].name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, files[folder].content);
      console.log(`📝 Created: ${filePath}`);
    }
  });

  console.log(`✅ Feature module '${nameFolder}' generated successfully!`);
}

// Run the script
generateFeatureModule();
