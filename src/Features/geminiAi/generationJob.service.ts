import { Request, Response } from "express";
import mongoose from "mongoose";
import AiGenerationJob from "./schema/aiGenerationJob.schema";

const STALE_MS = 8 * 60 * 1000;

type GenerationSource = "course" | "subscription";
type GenerationType = "summarize" | "generate-flashcards" | "generate-quiz";

const publicJob = (job: any) => ({
  jobId: String(job._id),
  queryType: job.queryType,
  source: job.source,
  status: job.status,
  message: job.message || "",
  error: job.status === "failed" ? job.error || job.message || "" : "",
  createdAt: job.createdAt,
  finishedAt: job.finishedAt,
  result: job.status === "ready" ? job.result || null : null,
});

const expireStale = async (studentId: string, source: GenerationSource) => {
  const cutoff = new Date(Date.now() - STALE_MS);
  await AiGenerationJob.updateMany(
    {
      student: studentId,
      source,
      status: "processing",
      createdAt: { $lt: cutoff },
    },
    {
      status: "failed",
      message: "Generation did not finish.",
      error: "The generator stopped before a result was saved.",
      finishedAt: new Date(),
    }
  );
};

export const enqueueGeneration = (
  req: Request,
  res: Response,
  meta: { source: GenerationSource; queryType: GenerationType; label: string },
  run: (req: Request, res: Response) => Promise<unknown>
) => {
  const student = req["currentUser"]?.id;
  if (!student) {
    return res.status(400).json({
      success: false,
      message: "Missing required field: studentId",
    });
  }

  void (async () => {
    const job = await AiGenerationJob.create({
      student,
      source: meta.source,
      queryType: meta.queryType,
      status: "processing",
      message: `${meta.label} is being generated.`,
    });

    if (!res.headersSent) {
      res.status(202).json({
        success: true,
        status: "processing",
        jobId: String(job._id),
        queryType: meta.queryType,
        source: meta.source,
        message: `${meta.label} is being generated.`,
      });
    }

    const captured: { code?: number; body?: any } = {};
    const fakeRes = {
      headersSent: false,
      status(code: number) {
        captured.code = code;
        return {
          json(body: any) {
            captured.body = body;
            return body;
          },
        };
      },
    } as unknown as Response;

    try {
      await run(req, fakeRes);
      const body = captured.body || {};
      const ok = (captured.code || 500) < 400 && body.success !== false;
      await AiGenerationJob.updateOne(
        { _id: job._id },
        {
          status: ok ? "ready" : "failed",
          message: body.message || (ok ? "Ready." : "Generation failed."),
          result: body.response || null,
          error: ok ? "" : body.error || body.message || "Generation failed.",
          finishedAt: new Date(),
        }
      );
    } catch (error: any) {
      await AiGenerationJob.updateOne(
        { _id: job._id },
        {
          status: "failed",
          message: "Generation failed.",
          error: error?.message || "Generation failed.",
          finishedAt: new Date(),
        }
      );
    }
  })().catch((error) => {
    console.error("[ai-generation] failed to start", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Could not start generation.",
      });
    }
  });
};

export const generationStatus = async (
  req: Request,
  res: Response,
  source: GenerationSource
) => {
  const student = req["currentUser"]?.id;
  if (!student || !mongoose.Types.ObjectId.isValid(String(student))) {
    return res.status(400).json({
      success: false,
      message: "Missing required field: studentId",
    });
  }

  await expireStale(String(student), source);
  const jobId = String(req.query.jobId || "");

  if (jobId) {
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ success: false, message: "Invalid job id" });
    }
    const job = await AiGenerationJob.findOne({
      _id: jobId,
      student,
      source,
    }).lean();
    if (!job) {
      return res.status(404).json({ success: false, message: "Generation was not found." });
    }
    return res.status(200).json({ success: true, response: publicJob(job) });
  }

  const queryType = String(req.query.queryType || "");
  const status = String(req.query.status || "");
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20));
  const filter: Record<string, unknown> = { student, source };
  if (queryType) filter.queryType = queryType;
  if (status) filter.status = status;

  const jobs = await AiGenerationJob.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  return res.status(200).json({
    success: true,
    response: jobs.map(publicJob),
  });
};
