import { Request, Response } from "express";
import axios from "axios";
import * as crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import Course from "../../course/schema/course.schema";
import Enroll from "../../course/schema/enroll.schema";
import Payment from "../schema/payment.schema";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

const parsePriceToNumber = (value?: string): number | null => {
  if (!value) return null;
  const normalized = value.replace(/[^0-9.]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
};

const toKobo = (amount: number): number => Math.round(amount * 100);

const getPaystackHeaders = () => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured");
  }
  return {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
};

const ensureEnrollment = async (email: string, courseId: string) => {
  const existing = await Enroll.findOne({
    email,
    course: courseId,
  });
  if (existing) return existing;
  const enrolled = Enroll({
    email,
    course: courseId,
  });
  return enrolled.save();
};

const getRawBodyString = (body: unknown, rawBody?: Buffer): string => {
  if (rawBody && Buffer.isBuffer(rawBody)) return rawBody.toString("utf8");
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (typeof body === "string") return body;
  return JSON.stringify(body ?? {});
};

export class PaymentV2Controller {
  static async initiate(req: Request, res: Response) {
    try {
      const { courseId } = req.body as { courseId?: string };
      const currentUser = req["currentUser"] as
        | { id?: string; email?: string }
        | undefined;

      if (!courseId) {
        return res.status(400).json({ status: false, message: "courseId required" });
      }
      if (!currentUser?.id || !currentUser?.email) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
      }

      const callbackUrl = process.env.PAYSTACK_CALLBACK_URL;
      if (!callbackUrl) {
        return res.status(500).json({
          status: false,
          message: "PAYSTACK_CALLBACK_URL is not configured",
        });
      }

      const course = await Course.findOne({ _id: courseId, });
      if (!course) {
        return res.status(404).json({ status: false, message: "Course not found" });
      }

      const price = parsePriceToNumber(course.price);
      if (!price) {
        return res
          .status(400)
          .json({ status: false, message: "Invalid course price" });
      }

      const reference = uuidv4();
      const amountKobo = toKobo(price);

      const payload = {
        email: currentUser.email,
        amount: amountKobo,
        currency: "NGN",
        reference,
        callback_url: callbackUrl,
        metadata: {
          courseId: courseId,
          userId: currentUser.id,
        },
      };

      const response = await axios.post(
        `${PAYSTACK_BASE_URL}/transaction/initialize`,
        payload,
        { headers: getPaystackHeaders() }
      );

      if (!response.data?.status) {
        return res.status(400).json({
          status: false,
          message: response.data?.message || "Payment initialization failed",
        });
      }

      const payment = Payment({
        userId: currentUser.id,
        email: currentUser.email,
        courseId,
        amount: amountKobo,
        currency: "NGN",
        reference,
        status: "PENDING",
        paystackData: response.data?.data,
      });

      await payment.save();

      return res.status(200).json({
        status: true,
        message: "Payment initialized",
        response: {
          reference,
          authorization_url: response.data?.data?.authorization_url,
          access_code: response.data?.data?.access_code,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Payment initialization failed",
        error: error?.response?.data || error?.message || error,
      });
    }
  }

  static async verify(req: Request, res: Response) {
    try {
      const { reference } = req.params as { reference?: string };
      const currentUser = req["currentUser"] as
        | { id?: string; email?: string }
        | undefined;

      if (!reference) {
        return res.status(400).json({ status: false, message: "reference required" });
      }
      if (!currentUser?.id || !currentUser?.email) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
      }

      const payment = await Payment.findOne({ reference });
      if (!payment) {
        return res.status(404).json({ status: false, message: "Payment not found" });
      }
      if (payment.userId !== currentUser.id) {
        return res.status(403).json({ status: false, message: "Forbidden" });
      }
      if (payment.status === "SUCCESS") {
        return res.status(200).json({
          status: true,
          message: "Payment already verified",
          response: payment,
        });
      }

      const response = await axios.get(
        `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
        { headers: getPaystackHeaders() }
      );

      const data = response.data?.data;
      const success = response.data?.status && data?.status === "success";

      payment.status = success ? "SUCCESS" : "FAILED";
      payment.paystackData = data;
      await payment.save();

      if (success && payment.courseId) {
        const enrollEmail = payment.email || currentUser.email;
        if (enrollEmail) {
          await ensureEnrollment(enrollEmail, payment.courseId.toString());
        }
      }

      return res.status(200).json({
        status: success,
        message: success ? "Payment verified" : "Payment failed",
        response: payment,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Payment verification failed",
        error: error?.response?.data || error?.message || error,
      });
    }
  }

  static async callbackView(req: Request, res: Response) {
    try {
      const reference =
        (req.query.reference as string | undefined) ||
        (req.query.trxref as string | undefined);

      if (!reference) {
        return res.status(400).send("Missing reference");
      }

      const payment = await Payment.findOne({ reference });
      if (!payment) {
        return res.status(404).send("Payment not found");
      }

      const response = await axios.get(
        `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
        { headers: getPaystackHeaders() }
      );

      const data = response.data?.data;
      const success = response.data?.status && data?.status === "success";

      payment.status = success ? "SUCCESS" : "FAILED";
      payment.paystackData = data;
      await payment.save();

      if (success && payment.courseId && payment.email) {
        await ensureEnrollment(payment.email, payment.courseId.toString());
      }

      const statusText = success ? "SUCCESS" : "FAILED";
      return res.status(200).send(`Payment ${statusText}`);
    } catch (error) {
      return res.status(500).send("Payment verification failed");
    }
  }

  static async webhook(req: Request, res: Response) {
    try {
      const signature = req.headers["x-paystack-signature"] as string | undefined;
      const secret = process.env.PAYSTACK_SECRET_KEY;

      if (!signature || !secret) {
        return res.status(401).json({ status: false, message: "Invalid signature" });
      }

      const rawBody = getRawBodyString(req.body, req["rawBody"]);
      const hash = crypto
        .createHmac("sha512", secret)
        .update(rawBody)
        .digest("hex");

      try {
        const signatureBuf = Buffer.from(signature, "hex");
        const hashBuf = Buffer.from(hash, "hex");
        if (
          signatureBuf.length !== hashBuf.length ||
          !crypto.timingSafeEqual(signatureBuf, hashBuf)
        ) {
          return res
            .status(401)
            .json({ status: false, message: "Invalid signature" });
        }
      } catch {
        return res.status(401).json({ status: false, message: "Invalid signature" });
      }

      const event = req.body as any;
      const data = event?.data;
      const reference = data?.reference as string | undefined;

      if (!reference) {
        return res.status(200).json({ status: true, message: "No reference" });
      }

      const payment = await Payment.findOne({ reference });
      if (!payment) {
        return res.status(200).json({ status: true, message: "Payment not found" });
      }
      if (payment.status === "SUCCESS") {
        return res.status(200).json({ status: true, message: "Already processed" });
      }

      const eventName = event?.event as string | undefined;
      const success = eventName === "charge.success" || data?.status === "success";
      payment.status = success ? "SUCCESS" : "FAILED";
      payment.paystackData = data;
      await payment.save();

      if (success && payment.courseId && payment.email) {
        await ensureEnrollment(payment.email, payment.courseId.toString());
      }

      return res.status(200).json({
        status: true,
        paymentStatus: success ? "SUCCESS" : "FAILED",
        message: success ? "Payment success" : "Payment failed",
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Webhook processing failed",
      });
    }
  }

  static async myPayments(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as
        | { id?: string; email?: string }
        | undefined;
      if (!currentUser?.id) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
      }

      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;

      const filter = {
        userId: currentUser.id,
        status: "SUCCESS",
      };

      const [payments, total] = await Promise.all([
        Payment.aggregate([
          { $match: filter },
          { $sort: { createdAt: -1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: "courses",
              localField: "courseId",
              foreignField: "_id",
              as: "course",
            },
          },
          { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 1,
              amount: 1,
              currency: 1,
              reference: 1,
              status: 1,
              createdAt: 1,
              course: {
                _id: "$course._id",
                title: "$course.title",
                price: "$course.price",
              },
            },
          },
        ]),
        Payment.countDocuments(filter),
      ]);

      const totalPages = Math.ceil(total / limit);

      return res.status(200).json({
        status: true,
        message: "Payments fetched successfully",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        response: payments,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Payments fetch failed",
        error: error?.message || error,
      });
    }
  }
}
