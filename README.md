# Awinteck ExpressJS - Mongodb

### Author: [Samjay Awinteck](https://github.com/Samjay1)
### Date: 2025-02-21 08:00 PM
### Description: This is a simple ExpressJS application with TypeORM and MongoDB.


## Instructions to setup
1. Clone the repository
2. Run `npm install` to install all dependencies
3. Run `npm run dev` to start the development server
4. Open your browser and navigate to http://localhost:{PORT}
5. You can now start coding



### OPTIONAL - SWAGGER
5. To use swagger, Run `npm run generate-swagger`
6. Open your browser and navigate to http://localhost:{PORT}/swagger


## Instructions to deploy
1. `npm run build`
2. copy the build folder to server 
3. app.js is located at src/app.js
4. ensure that synchronize:true in data-source.js // to generate the db tables
5. `npm start`

Steps to run this project:

1. Run `npm i` command
2. Setup database settings inside `data-source.ts` file
3. Run `npm start` command



## Generate new Modules

Run `node generate -n <moduleName>`

eg. `node generate -n auth`