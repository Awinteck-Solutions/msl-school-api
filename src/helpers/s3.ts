import * as dotenv from "dotenv";
import { Readable } from "stream";
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

dotenv.config();

const bucketName = process.env.S3_BUCKET || "";
const s3 = new S3Client({});

const timestamp = new Date().getMilliseconds();

type UploadFileInput = {
  buffer: Buffer;
  originalname: string;
};

export const uploadFile = async (
  file: UploadFileInput,
  folder: string
): Promise<{ key: string }> => {
  const key = `${folder}/${timestamp}_${file.originalname.replace(/\s+/g, "")}`;
  const body = file.buffer;
  const contentLength = body.byteLength;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentLength: contentLength,
    })
  );

  return { key };
};


type FileStreamResult = {
  stream: NodeJS.ReadableStream;
  contentLength?: number;
};

export const getFileStream = async (
  fileKey: string,
  callback: (result: FileStreamResult) => void
) => {
  try {
    const params = {
      Bucket: bucketName,
      Key: fileKey,
    };

    // 1️⃣ Get metadata (HEAD)
    const headCommand = new HeadObjectCommand(params);
    const metadata = await s3.send(headCommand);

    const contentLength = metadata.ContentLength;

    // 2️⃣ Get object stream
    const getCommand = new GetObjectCommand(params);
    const response = await s3.send(getCommand);

    const stream = response.Body as Readable;

    return callback({
      stream,
      contentLength,
    });
  } catch (err) {
    console.error("Error getting file stream:", err);
    throw err;
  }
};

