import { Request, Response } from "express";
import * as path from "path";
import mongoose from "mongoose";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  COLLECTION_NAME,
  bucketName,
  calculateOptimalBatchSize,
  checkAiLimits,
  chunkText,
  downloadPDFfromS3,
  handleQdrantOperation,
  openai,
  parsePdfText,
  qdrant,
  s3,
} from "./mslAi.shared";
import User from "../../user/schema/user.schema";
import GlobalAiLimit from "../schema/globalAiLimit.schema";
import AiUsage from "../schema/aiUsage.schema";

interface MulterRequest extends Request {
  file?: multer.File;
  files?: multer.File[] | { [fieldname: string]: multer.File[] };
}


export class AdminMslAiV2Controller {
  static async listPdfs(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      if (page < 1) {
        return res.status(400).json({
          success: false,
          message: "Page number must be greater than 0",
        });
      }

      if (limit < 1 || limit > 100) {
        return res.status(400).json({
          success: false,
          message: "Limit must be between 1 and 100",
        });
      }

      const data = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: "pdf/",
        })
      );

      const allPdfFiles = (data.Contents ?? [])
        .filter((obj) => obj.Key?.toLowerCase().endsWith(".pdf"))
        .map((obj) => ({
          key: obj.Key,
          size: obj.Size,
          lastModified: obj.LastModified,
          fileName: obj.Key ? path.basename(obj.Key) : null,
        }));

      const total = allPdfFiles.length;
      const totalPages = Math.ceil(total / limit);
      const pdfFiles = allPdfFiles.slice(skip, skip + limit);

      return res.status(200).json({
        success: true,
        message: `Found ${total} PDF files in S3 bucket`,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        data: pdfFiles,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error listing PDF files from S3",
        error: error.message,
      });
    }
  }

  static async processPdfs(req: Request, res: Response) {
    try {
      const data = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: "pdf/",
        })
      );

      const pdfKeys = (data.Contents ?? [])
        .filter((obj) => obj.Key?.toLowerCase().endsWith(".pdf"))
        .map((obj) => obj.Key as string);

      if (pdfKeys.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No PDF files found in the S3 bucket pdf folder",
        });
      }

      const allChunks: any[] = [];
      let processedFiles = 0;
      let failedFiles = 0;

      for (const pdfKey of pdfKeys) {
        try {
          const pdfBuffer = await downloadPDFfromS3(pdfKey);
          const text = await parsePdfText(pdfBuffer);
          const chunks = chunkText(text, 500);

          chunks.forEach((chunk, index) => {
            allChunks.push({
              pdfKey,
              fileName: path.basename(pdfKey),
              chunkIndex: index,
              text: chunk,
              processedAt: new Date().toISOString(),
            });
          });

          processedFiles++;
        } catch (err: any) {
          failedFiles++;
        }
      }

      if (allChunks.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No chunks were generated from the provided PDF files",
        });
      }

      try {
        await qdrant.createCollection(COLLECTION_NAME, {
          vectors: { size: 1536, distance: "Cosine" },
        });
      } catch (error: any) {
        if (
          error.status === 409 ||
          error.message?.includes("already exists") ||
          (error.data &&
            error.data.status &&
            error.data.status.error &&
            error.data.status.error.includes("already exists"))
        ) {
          // Collection exists; continue
        } else if (
          error.code === "UND_ERR_CONNECT_TIMEOUT" ||
          error.message?.includes("fetch failed")
        ) {
          return res.status(503).json({
            success: false,
            message:
              "Vector database service unavailable. Please check Qdrant server connection.",
            error: "Qdrant connection timeout",
            details: {
              qdrantUrl: process.env.QDRANT_URL || "http://localhost:6333",
              suggestion: "Ensure Qdrant server is running and accessible",
            },
          });
        } else {
          throw error;
        }
      }

      const batchSize = calculateOptimalBatchSize(allChunks, 8000);
      let totalUpserted = 0;

      for (let i = 0; i < allChunks.length; i += batchSize) {
        const batch = allChunks.slice(i, i + batchSize);

        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        try {
          const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: batch.map((item: any) => item.text),
          });

          const points = batch.map((item: any, idx: number) => ({
            id: uuidv4(),
            vector: response.data[idx].embedding,
            payload: {
              pdfKey: item.pdfKey,
              fileName: item.fileName,
              chunkIndex: item.chunkIndex,
              text: item.text,
              processedAt: item.processedAt,
            },
          }));

          try {
            await qdrant.upsert(COLLECTION_NAME, {
              wait: true,
              points,
            });

            totalUpserted += points.length;
          } catch (upsertError: any) {
            if (
              upsertError.code === "UND_ERR_CONNECT_TIMEOUT" ||
              upsertError.message?.includes("fetch failed")
            ) {
              return res.status(503).json({
                success: false,
                message:
                  "Vector database service unavailable during data storage.",
                error: "Qdrant connection timeout during upsert",
                details: {
                  qdrantUrl: process.env.QDRANT_URL || "http://localhost:6333",
                  suggestion: "Ensure Qdrant server is running and accessible",
                },
              });
            }
            throw upsertError;
          }
        } catch (embeddingError: any) {
          if (embeddingError.code === "rate_limit_exceeded") {
            await new Promise((resolve) => setTimeout(resolve, 60000));
            i -= batchSize;
            continue;
          }
          continue;
        }
      }

      return res.status(200).json({
        success: true,
        message:
          "Successfully processed and stored all PDFs from S3 bucket in Qdrant",
        summary: {
          totalFiles: pdfKeys.length,
          processedFiles,
          failedFiles,
          totalChunks: allChunks.length,
          totalUpserted,
          collectionName: COLLECTION_NAME,
          processedFilesList: pdfKeys.slice(0, processedFiles),
          failedFilesList: pdfKeys.slice(
            processedFiles,
            processedFiles + failedFiles
          ),
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error processing PDFs from S3 and storing in Qdrant",
        error: error.message,
      });
    }
  }

  static async processNewPdfs(req: Request, res: Response) {
    try {
      const data = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: "pdf/",
        })
      );

      const allPdfFiles = (data.Contents ?? [])
        .filter((obj) => obj.Key?.toLowerCase().endsWith(".pdf"))
        .map((obj) => ({
          key: obj.Key as string,
          lastModified: obj.LastModified,
          size: obj.Size,
        }));

      if (allPdfFiles.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No PDF files found in the S3 bucket pdf folder",
        });
      }

      const existingPdfKeys = new Set<string>();
      try {
        const existingPoints = await qdrant.scroll(COLLECTION_NAME, {
          limit: 10000,
          with_payload: true,
          with_vector: false,
        });

        existingPoints.points.forEach((point: any) => {
          if (point.payload && point.payload.pdfKey) {
            existingPdfKeys.add(point.payload.pdfKey);
          }
        });
      } catch (error: any) {
        // If collection doesn't exist or error, process all files
      }

      const newPdfFiles = allPdfFiles.filter(
        (pdfFile) => !existingPdfKeys.has(pdfFile.key)
      );

      if (newPdfFiles.length === 0) {
        return res.status(200).json({
          success: true,
          message:
            "No new PDF files to process. All PDFs are already processed.",
          summary: {
            totalFilesInS3: allPdfFiles.length,
            alreadyProcessed: allPdfFiles.length,
            newFiles: 0,
            processedFiles: 0,
            failedFiles: 0,
            totalChunks: 0,
            totalUpserted: 0,
            collectionName: COLLECTION_NAME,
          },
        });
      }

      try {
        await qdrant.createCollection(COLLECTION_NAME, {
          vectors: { size: 1536, distance: "Cosine" },
        });
      } catch (error: any) {
        if (
          error.status === 409 ||
          error.message?.includes("already exists") ||
          (error.data &&
            error.data.status &&
            error.data.status.error &&
            error.data.status.error.includes("already exists"))
        ) {
          // Collection exists; continue
        } else if (
          error.code === "UND_ERR_CONNECT_TIMEOUT" ||
          error.message?.includes("fetch failed")
        ) {
          return res.status(503).json({
            success: false,
            message:
              "Vector database service unavailable. Please check Qdrant server connection.",
            error: "Qdrant connection timeout",
            details: {
              qdrantUrl: process.env.QDRANT_URL || "http://localhost:6333",
              suggestion: "Ensure Qdrant server is running and accessible",
            },
          });
        } else {
          throw error;
        }
      }

      const allChunks: any[] = [];
      let processedFiles = 0;
      let failedFiles = 0;

      for (const pdfFile of newPdfFiles) {
        try {
          const pdfBuffer = await downloadPDFfromS3(pdfFile.key);
          const text = await parsePdfText(pdfBuffer);
          const chunks = chunkText(text, 500);

          chunks.forEach((chunk, index) => {
            allChunks.push({
              pdfKey: pdfFile.key,
              fileName: path.basename(pdfFile.key),
              chunkIndex: index,
              text: chunk,
              processedAt: new Date().toISOString(),
              lastModified: pdfFile.lastModified,
              fileSize: pdfFile.size,
            });
          });

          processedFiles++;
        } catch (err: any) {
          failedFiles++;
        }
      }

      if (allChunks.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No chunks were generated from the new PDF files",
        });
      }

      const batchSize = calculateOptimalBatchSize(allChunks, 8000);
      let totalUpserted = 0;

      for (let i = 0; i < allChunks.length; i += batchSize) {
        const batch = allChunks.slice(i, i + batchSize);

        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        try {
          const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: batch.map((item: any) => item.text),
          });

          const points = batch.map((item: any, idx: number) => ({
            id: uuidv4(),
            vector: response.data[idx].embedding,
            payload: {
              pdfKey: item.pdfKey,
              fileName: item.fileName,
              chunkIndex: item.chunkIndex,
              text: item.text,
              processedAt: item.processedAt,
              lastModified: item.lastModified,
              fileSize: item.fileSize,
            },
          }));

          try {
            await qdrant.upsert(COLLECTION_NAME, {
              wait: true,
              points,
            });

            totalUpserted += points.length;
          } catch (upsertError: any) {
            if (
              upsertError.code === "UND_ERR_CONNECT_TIMEOUT" ||
              upsertError.message?.includes("fetch failed")
            ) {
              return res.status(503).json({
                success: false,
                message:
                  "Vector database service unavailable during data storage.",
                error: "Qdrant connection timeout during upsert",
                details: {
                  qdrantUrl: process.env.QDRANT_URL || "http://localhost:6333",
                  suggestion: "Ensure Qdrant server is running and accessible",
                },
              });
            }
            throw upsertError;
          }
        } catch (embeddingError: any) {
          if (embeddingError.code === "rate_limit_exceeded") {
            await new Promise((resolve) => setTimeout(resolve, 60000));
            i -= batchSize;
            continue;
          }
          continue;
        }
      }

      return res.status(200).json({
        success: true,
        message: "Successfully processed and stored new PDFs in Qdrant",
        summary: {
          totalFilesInS3: allPdfFiles.length,
          alreadyProcessed: allPdfFiles.length - newPdfFiles.length,
          newFiles: newPdfFiles.length,
          processedFiles,
          failedFiles,
          totalChunks: allChunks.length,
          totalUpserted,
          collectionName: COLLECTION_NAME,
          processedFilesList: newPdfFiles
            .slice(0, processedFiles)
            .map((f) => f.key),
          failedFilesList: newPdfFiles
            .slice(processedFiles, processedFiles + failedFiles)
            .map((f) => f.key),
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error processing new PDFs from S3 and storing in Qdrant",
        error: error.message,
      });
    }
  }

  static async uploadPdf(req: MulterRequest, res: Response) {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({
          success: false,
          message: "No PDF file provided. Please upload a PDF file.",
        });
      }

      const originalName = file.originalname;
      const fileExtension = path.extname(originalName);
      const fileName = path.basename(originalName, fileExtension);
      const uniqueFileName = `${fileName}_${Date.now()}${fileExtension}`;
      const s3Key = `pdf/${uniqueFileName}`;

      await s3.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: s3Key,
          Body: file.buffer,
          ContentType: "application/pdf",
          Metadata: {
            originalName: originalName,
            uploadedAt: new Date().toISOString(),
            uploadedBy: (req.body?.uploadedBy as string) || "system",
          },
        })
      );

      const s3Url = bucketName
        ? `https://${bucketName}.s3.amazonaws.com/${s3Key}`
        : null;

      return res.status(200).json({
        success: true,
        message: "PDF uploaded successfully to S3",
        data: {
          originalName: originalName,
          s3Key: s3Key,
          s3Url: s3Url,
          fileSize: file.size,
          uploadedAt: new Date().toISOString(),
          bucket: bucketName,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error uploading PDF to S3",
        error: error.message,
      });
    }
  }

  static async uploadPdfs(req: MulterRequest, res: Response) {
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) {
        return res.status(400).json({
          success: false,
          message:
            "No PDF files provided. Please upload at least one PDF file.",
        });
      }

      const uploadResults: any[] = [];
      const failedUploads: any[] = [];

      for (const file of files) {
        try {
          const originalName = file.originalname;
          const fileExtension = path.extname(originalName);
          const fileName = path.basename(originalName, fileExtension);
          const uniqueFileName = `${fileName}_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 11)}${fileExtension}`;
          const s3Key = `pdf/${uniqueFileName}`;

          await s3.send(
            new PutObjectCommand({
              Bucket: bucketName,
              Key: s3Key,
              Body: file.buffer,
              ContentType: "application/pdf",
              Metadata: {
                originalName: originalName,
                uploadedAt: new Date().toISOString(),
                uploadedBy: (req.body?.uploadedBy as string) || "system",
              },
            })
          );

          const s3Url = bucketName
            ? `https://${bucketName}.s3.amazonaws.com/${s3Key}`
            : null;

          uploadResults.push({
            originalName: originalName,
            s3Key: s3Key,
            s3Url: s3Url,
            fileSize: file.size,
            uploadedAt: new Date().toISOString(),
          });
        } catch (error: any) {
          failedUploads.push({
            originalName: file.originalname,
            error: error.message,
          });
        }
      }

      return res.status(200).json({
        success: true,
        message: `Upload completed. ${uploadResults.length} files uploaded successfully, ${failedUploads.length} failed.`,
        summary: {
          totalFiles: files.length,
          successfulUploads: uploadResults.length,
          failedUploads: failedUploads.length,
        },
        data: {
          successful: uploadResults,
          failed: failedUploads,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error uploading PDFs to S3",
        error: error.message,
      });
    }
  }

  static async deletePdfOld(req: Request, res: Response) {
    try {
      const { key } = req.body;

      if (!key) {
        return res.status(400).json({
          success: false,
          message:
            "PDF key is required. Please provide the S3 key of the PDF to delete.",
        });
      }

      if (!key.startsWith("pdf/") || !key.toLowerCase().endsWith(".pdf")) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid PDF key. Key must be in the format 'pdf/filename.pdf'",
        });
      }

      const deletionResults = {
        s3: { success: false, error: null as string | null },
        qdrant: {
          success: false,
          error: null as string | null,
          deletedPoints: 0,
        },
      };

      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: bucketName,
            Key: key,
          })
        );
        deletionResults.s3.success = true;
      } catch (s3Error: any) {
        deletionResults.s3.error = s3Error.message;
      }

      try {
        const collectionExists = (await handleQdrantOperation(
          async () => {
            const collections = await qdrant.getCollections();
            return collections.collections.some(
              (col: any) => col.name === COLLECTION_NAME
            );
          },
          "collection lookup"
        )) as boolean;

        if (!collectionExists) {
          deletionResults.qdrant.success = true;
          deletionResults.qdrant.error = "Collection does not exist";
        } else {
          const searchResult = await handleQdrantOperation(
            async () =>
              qdrant.scroll(COLLECTION_NAME, {
                filter: {
                  must: [
                    {
                      key: "pdfKey",
                      match: {
                        value: key,
                      },
                    },
                  ],
                },
                limit: 10000,
                with_payload: true,
                with_vector: false,
              }),
            "qdrant scroll"
          );

          const points = (searchResult as any)?.points ?? [];
          if (points.length > 0) {
            const pointIds = points.map((point: any) => point.id);
            await handleQdrantOperation(
              async () =>
                qdrant.delete(COLLECTION_NAME, {
                  wait: true,
                  points: pointIds,
                }),
              "qdrant delete"
            );

            deletionResults.qdrant.success = true;
            deletionResults.qdrant.deletedPoints = pointIds.length;
          } else {
            deletionResults.qdrant.success = true;
            deletionResults.qdrant.deletedPoints = 0;
          }
        }
      } catch (qdrantError: any) {
        deletionResults.qdrant.error = qdrantError.message;
      }

      const overallSuccess =
        deletionResults.s3.success && deletionResults.qdrant.success;
      const statusCode = overallSuccess ? 200 : 207;

      let message = "";
      if (overallSuccess) {
        message = `PDF '${key}' successfully deleted from both S3 and Qdrant. Removed ${deletionResults.qdrant.deletedPoints} vector points.`;
      } else if (deletionResults.s3.success && !deletionResults.qdrant.success) {
        message = `PDF '${key}' deleted from S3 but failed to remove from Qdrant: ${deletionResults.qdrant.error}`;
      } else if (!deletionResults.s3.success && deletionResults.qdrant.success) {
        message = `PDF '${key}' removed from Qdrant but failed to delete from S3: ${deletionResults.s3.error}`;
      } else {
        message = `Failed to delete PDF '${key}' from both S3 and Qdrant.`;
      }

      return res.status(statusCode).json({
        success: overallSuccess,
        message: message,
        data: {
          pdfKey: key,
          deletionResults: deletionResults,
          summary: {
            s3Deleted: deletionResults.s3.success,
            qdrantDeleted: deletionResults.qdrant.success,
            vectorPointsRemoved: deletionResults.qdrant.deletedPoints,
            overallSuccess: overallSuccess,
          },
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error deleting PDF from S3 and Qdrant",
        error: error.message,
      });
    }
  }

  static async query(req: Request, res: Response) {
    try {
      const { question, studentId } = req.body;

      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }

      if (!studentId) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const limitCheck = await checkAiLimits(studentId);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          success: false,
          message: limitCheck.reason,
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage,
            monthlyLimit: limitCheck.monthlyLimit,
          },
        });
      }

      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: question,
      });

      const searchResult = await qdrant.search(COLLECTION_NAME, {
        vector: embeddingResponse.data[0].embedding,
        limit: 5,
      });

      const contexts = searchResult.map((point) => point.payload?.text);
      const contextText = contexts.join("\n\n");

      const completion = await openai.chat.completions.create({
        model: "gpt-5.1",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You are a helpful AI assistant trained on MSL learning materials. Answer the question strictly based on the provided context return response in HTML format. If the context does not contain the answer, respond with 'I do not have enough information from the MSL materials to answer that question.'",
          },
          {
            role: "user",
            content: `Context:\n${contextText}\n\nQuestion:\n${question}`,
          },
        ],
      });

      const answer = completion.choices[0].message.content;
      const { prompt_tokens, completion_tokens, total_tokens } = completion.usage;
      const promptCost = (prompt_tokens / 1000000) * 0.15;
      const completionCost = (completion_tokens / 1000000) * 0.6;
      const totalCostEstimate = promptCost + completionCost;

      const aiUsage = new AiUsage({
        student: studentId,
        course: null,
        question,
        answer,
        prompt_tokens: prompt_tokens,
        completion_tokens: completion_tokens,
        total_tokens: total_tokens,
        model: completion.model,
        cost_estimate_usd: totalCostEstimate,
      });
      await aiUsage.save();

      return res.status(200).json({
        success: true,
        message: "MSL AI response generated successfully.",
        response: {
          answer,
          context_used: contexts,
          metadata: {
            totalTokens: total_tokens,
            estimatedCost: totalCostEstimate,
            sources: searchResult.map((point) => ({
              fileName: point.payload?.fileName,
              chunkIndex: point.payload?.chunkIndex,
              score: point.score,
            })),
          },
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage + 1,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage + 1,
            monthlyLimit: limitCheck.monthlyLimit,
            remainingDaily: limitCheck.remainingDaily - 1,
            remainingMonthly: limitCheck.remainingMonthly - 1,
          },
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "System error during MSL AI query.",
        error: error.message,
      });
    }
  }

  static async collectionInfo(req: Request, res: Response) {
    try {
      const collectionInfo = (await qdrant.getCollection(
        COLLECTION_NAME
      )) as any;

      return res.status(200).json({
        success: true,
        message: "Collection info retrieved successfully",
        data: {
          name: collectionInfo.name,
          pointsCount: collectionInfo.points_count,
          vectorsCount: collectionInfo.vectors_count,
          status: collectionInfo.status,
          config: collectionInfo.config,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving collection info",
        error: error.message,
      });
    }
  }

  static async deleteCollection(req: Request, res: Response) {
    try {
      await qdrant.deleteCollection(COLLECTION_NAME);

      return res.status(200).json({
        success: true,
        message: `Collection ${COLLECTION_NAME} deleted successfully`,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error deleting collection",
        error: error.message,
      });
    }
  }

  static async testQdrant(req: Request, res: Response) {
    try {
      const collections = await qdrant.getCollections();

      return res.status(200).json({
        success: true,
        message: "Qdrant connection successful",
        data: {
          qdrantUrl: process.env.QDRANT_URL || "http://localhost:6333",
          collections: collections.collections?.map((c: any) => c.name) || [],
          totalCollections: collections.collections?.length || 0,
        },
      });
    } catch (error: any) {
      let errorMessage = "Qdrant connection failed";
      let errorDetails: Record<string, unknown> = {};

      if (error.code === "UND_ERR_CONNECT_TIMEOUT") {
        errorMessage = "Qdrant connection timeout";
        errorDetails = {
          issue: "Connection timeout",
          suggestion: "Check if Qdrant server is running and accessible",
          qdrantUrl: process.env.QDRANT_URL || "http://localhost:6333",
        };
      } else if (error.message?.includes("fetch failed")) {
        errorMessage = "Qdrant server unreachable";
        errorDetails = {
          issue: "Network connectivity issue",
          suggestion: "Check network connection and Qdrant server status",
          qdrantUrl: process.env.QDRANT_URL || "http://localhost:6333",
        };
      } else {
        errorDetails = {
          issue: "Unknown error",
          suggestion: "Check Qdrant server logs",
          error: error.message,
        };
      }

      return res.status(503).json({
        success: false,
        message: errorMessage,
        error: error.message,
        details: errorDetails,
      });
    }
  }

  static async getGlobalLimits(req: Request, res: Response) {
    try {
      let globalLimits = await GlobalAiLimit.findOne({});

      if (!globalLimits) {
        globalLimits = await GlobalAiLimit.create({
          dailyLimit: 10,
          monthlyLimit: 100,
          description: "Default global AI limits",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Global AI limits retrieved successfully",
        data: globalLimits,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving global AI limits",
        error: error.message,
      });
    }
  }

  static async updateGlobalLimits(req: Request, res: Response) {
    try {
      const { dailyLimit, monthlyLimit, description, isActive, updatedBy } =
        req.body;

      if (!dailyLimit || !monthlyLimit) {
        return res.status(400).json({
          success: false,
          message: "dailyLimit and monthlyLimit are required",
        });
      }

      if (dailyLimit < 1 || monthlyLimit < 1) {
        return res.status(400).json({
          success: false,
          message: "Limits must be greater than 0",
        });
      }

      const updateData: Record<string, unknown> = {
        dailyLimit,
        monthlyLimit,
        updatedBy: updatedBy || "admin",
      };

      if (description !== undefined) updateData.description = description;
      if (isActive !== undefined) updateData.isActive = isActive;

      const globalLimits = await GlobalAiLimit.findOneAndUpdate({}, updateData, {
        upsert: true,
        new: true,
      });

      return res.status(200).json({
        success: true,
        message: "Global AI limits updated successfully",
        data: globalLimits,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error updating global AI limits",
        error: error.message,
      });
    }
  }

  static async updateStudentLimits(req: Request, res: Response) {
    try {
      const { studentIds, aiLimit } = req.body;

      if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "studentIds array is required and cannot be empty",
        });
      }

      if (!aiLimit) {
        return res.status(400).json({
          success: false,
          message: "aiLimit object is required",
        });
      }

      if (aiLimit.dailyLimit !== undefined && aiLimit.dailyLimit < 1) {
        return res.status(400).json({
          success: false,
          message: "dailyLimit must be greater than 0",
        });
      }

      if (aiLimit.monthlyLimit !== undefined && aiLimit.monthlyLimit < 1) {
        return res.status(400).json({
          success: false,
          message: "monthlyLimit must be greater than 0",
        });
      }

      const updateResults: any[] = [];
      const failedUpdates: any[] = [];

      for (const studentId of studentIds) {
        try {
          const user = await User.findById(studentId);
          if (!user) {
            failedUpdates.push({
              studentId,
              error: "User not found",
            });
            continue;
          }

          const updatedUser = await User.findByIdAndUpdate(
            studentId,
            {
              $set: {
                ai_limit: {
                  ...user.ai_limit,
                  ...aiLimit,
                },
              },
            },
            { new: true }
          );

          updateResults.push({
            studentId,
            email: updatedUser.email,
            firstname: updatedUser.firstname,
            lastname: updatedUser.lastname,
            aiLimit: updatedUser.ai_limit,
          });
        } catch (error: any) {
          failedUpdates.push({
            studentId,
            error: error.message,
          });
        }
      }

      return res.status(200).json({
        success: true,
        message: `AI limits update completed. ${updateResults.length} users updated successfully, ${failedUpdates.length} failed.`,
        summary: {
          totalStudents: studentIds.length,
          successfulUpdates: updateResults.length,
          failedUpdates: failedUpdates.length,
        },
        data: {
          successful: updateResults,
          failed: failedUpdates,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error updating student AI limits",
        error: error.message,
      });
    }
  }

  static async allStudentsUsage(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const search = (req.query.search as string) || "";
      const skip = (page - 1) * limit;

      if (page < 1) {
        return res.status(400).json({
          success: false,
          message: "Page number must be greater than 0",
        });
      }

      let globalLimits = await GlobalAiLimit.findOne({});
      if (!globalLimits) {
        globalLimits = {
          dailyLimit: 10,
          monthlyLimit: 100,
        } as any;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      );

      const monthlyUsageAgg = await AiUsage.aggregate([
        {
          $match: {
            createdAt: { $gte: startOfMonth, $lte: endOfMonth },
          },
        },
        {
          $group: {
            _id: "$student",
            count: { $sum: 1 },
          },
        },
      ]);

      const studentIdsWithUsage = monthlyUsageAgg.map((item) => item._id);

      if (studentIdsWithUsage.length === 0) {
        return res.status(200).json({
          success: true,
          message: "No students used AI this month",
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false,
          },
          data: [],
          summary: {
            globalLimits: globalLimits,
            totalStudents: 0,
            studentsWithCustomLimits: 0,
            studentsUsingGlobalLimits: 0,
          },
        });
      }

      const userQuery: Record<string, any> = {
        _id: { $in: studentIdsWithUsage },
      };

      if (search) {
        userQuery.$or = [
          { email: { $regex: search, $options: "i" } },
          { firstname: { $regex: search, $options: "i" } },
          { lastname: { $regex: search, $options: "i" } },
          {
            $expr: {
              $regexMatch: {
                input: { $concat: ["$firstname", " ", "$lastname"] },
                regex: search,
                options: "i",
              },
            },
          },
        ];
      }

      const totalUsers = await User.countDocuments(userQuery);

      const users = await User.find(userQuery)
        .select("_id email firstname lastname image ai_limit createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const userIds = users.map((user: any) => user._id);

      const dailyUsageAgg = await AiUsage.aggregate([
        {
          $match: {
            student: { $in: userIds },
            createdAt: { $gte: today, $lt: tomorrow },
          },
        },
        {
          $group: {
            _id: "$student",
            count: { $sum: 1 },
          },
        },
      ]);

      const monthlyUsageAggPage = await AiUsage.aggregate([
        {
          $match: {
            student: { $in: userIds },
            createdAt: { $gte: startOfMonth, $lte: endOfMonth },
          },
        },
        {
          $group: {
            _id: "$student",
            count: { $sum: 1 },
          },
        },
      ]);

      const totalUsageAgg = await AiUsage.aggregate([
        {
          $match: {
            student: { $in: userIds },
          },
        },
        {
          $group: {
            _id: "$student",
            count: { $sum: 1 },
          },
        },
      ]);

      const dailyUsageMap: Record<string, number> = {};
      dailyUsageAgg.forEach((item) => {
        dailyUsageMap[item._id.toString()] = item.count;
      });

      const monthlyUsageMap: Record<string, number> = {};
      monthlyUsageAggPage.forEach((item) => {
        monthlyUsageMap[item._id.toString()] = item.count;
      });

      const totalUsageMap: Record<string, number> = {};
      totalUsageAgg.forEach((item) => {
        totalUsageMap[item._id.toString()] = item.count;
      });

      const studentsWithUsage = users.map((user: any) => {
        const dailyLimit = user.ai_limit?.dailyLimit || globalLimits.dailyLimit;
        const monthlyLimit =
          user.ai_limit?.monthlyLimit || globalLimits.monthlyLimit;

        const dailyUsage = dailyUsageMap[user._id.toString()] || 0;
        const monthlyUsage = monthlyUsageMap[user._id.toString()] || 0;
        const totalUsage = totalUsageMap[user._id.toString()] || 0;

        return {
          student: {
            id: user._id,
            email: user.email,
            firstname: user.firstname,
            lastname: user.lastname,
            image: user.image,
            aiLimit: user.ai_limit,
            createdAt: user.createdAt,
          },
          usage: {
            daily: {
              used: dailyUsage,
              limit: dailyLimit,
              remaining: Math.max(0, dailyLimit - dailyUsage),
              percentage:
                dailyLimit > 0
                  ? Math.round((dailyUsage / dailyLimit) * 100)
                  : 0,
            },
            monthly: {
              used: monthlyUsage,
              limit: monthlyLimit,
              remaining: Math.max(0, monthlyLimit - monthlyUsage),
              percentage:
                monthlyLimit > 0
                  ? Math.round((monthlyUsage / monthlyLimit) * 100)
                  : 0,
            },
            total: totalUsage,
          },
          limits: {
            isUsingGlobalLimits:
              !user.ai_limit?.dailyLimit && !user.ai_limit?.monthlyLimit,
          },
        };
      });

      const totalPages = Math.ceil(totalUsers / limit);

      return res.status(200).json({
        success: true,
        message: "All students AI usage retrieved successfully",
        pagination: {
          page,
          limit,
          total: totalUsers,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        data: studentsWithUsage,
        summary: {
          globalLimits: globalLimits,
          totalStudents: totalUsers,
          studentsWithCustomLimits: studentsWithUsage.filter(
            (s) => !s.limits.isUsingGlobalLimits
          ).length,
          studentsUsingGlobalLimits: studentsWithUsage.filter(
            (s) => s.limits.isUsingGlobalLimits
          ).length,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving all students AI usage",
        error: error.message,
      });
    }
  }

  static async studentUsage(req: Request, res: Response) {
    try {
      const { studentId } = req.params;

      if (!studentId) {
        return res.status(400).json({
          success: false,
          message: "studentId is required",
        });
      }

      const user = await User.findById(studentId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      let globalLimits = await GlobalAiLimit.findOne({});
      if (!globalLimits) {
        globalLimits = {
          dailyLimit: 10,
          monthlyLimit: 100,
        } as any;
      }

      const dailyLimit = user.ai_limit?.dailyLimit || globalLimits.dailyLimit;
      const monthlyLimit =
        user.ai_limit?.monthlyLimit || globalLimits.monthlyLimit;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      );

      const [dailyUsage, monthlyUsage, totalUsage] = await Promise.all([
        AiUsage.countDocuments({
          student: studentId,
          createdAt: { $gte: today, $lt: tomorrow },
        }),
        AiUsage.countDocuments({
          student: studentId,
          createdAt: { $gte: startOfMonth, $lte: endOfMonth },
        }),
        AiUsage.countDocuments({ student: studentId }),
      ]);

      return res.status(200).json({
        success: true,
        message: "Student AI usage retrieved successfully",
        data: {
          student: {
            id: user._id,
            email: user.email,
            firstname: user.firstname,
            lastname: user.lastname,
            aiLimit: user.ai_limit,
          },
          usage: {
            daily: {
              used: dailyUsage,
              limit: dailyLimit,
              remaining: Math.max(0, dailyLimit - dailyUsage),
            },
            monthly: {
              used: monthlyUsage,
              limit: monthlyLimit,
              remaining: Math.max(0, monthlyLimit - monthlyUsage),
            },
            total: totalUsage,
          },
          limits: {
            isUsingGlobalLimits:
              !user.ai_limit?.dailyLimit && !user.ai_limit?.monthlyLimit,
            globalLimits: globalLimits,
          },
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error retrieving student AI usage",
        error: error.message,
      });
    }
  }

  static async history(req: Request, res: Response) {
    try {
      const { startDate, endDate, studentId } = req.query as {
        startDate?: string;
        endDate?: string;
        studentId?: string;
      };

      if (!studentId) {
        return res.status(400).json({
          success: false,
          message: "studentId cannot be empty",
        });
      }

      const start = startDate
        ? new Date(startDate)
        : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const end = endDate ? new Date(endDate) : new Date();

      const match = {
        createdAt: { $gte: start, $lte: end },
        student: new mongoose.Types.ObjectId(studentId),
      };

      const aggregation = await AiUsage.find(match);

      return res.status(200).json({
        success: true,
        message: "AI usage report generated successfully",
        response: aggregation,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error generating AI usage report",
        error: error.message,
      });
    }
  }
}
