import { Request, Response } from "express";
import mongoose from "mongoose";
import {
  applySuccessfulInvoicePayment,
  findOpenSubscription,
  getOrCreateSubscriptionPlan,
  getRawBodyString,
  hasActiveCourseEnrollment,
  initializeInvoicePayment,
  isSubscriptionAccessActive,
  publicPlanPayload,
  serializeSubscription,
  startSubscriptionCheckout,
  verifyPaystackReference,
  verifyPaystackWebhookSignature,
} from "./subscription.service";
import {
  SubscriptionContentStatus,
  SubscriptionInvoiceStatus,
  SubscriptionStatus,
} from "../enums/subscription.enum";
import SubscriptionInvoice from "../schema/subscriptionInvoice.schema";
import Subscription from "../schema/subscription.schema";
import SubscriptionResource from "../schema/subscriptionResource.schema";
import SubscriptionResourceFile from "../schema/subscriptionResourceFile.schema";

export class SubscriptionV2Controller {
  static async plan(req: Request, res: Response) {
    try {
      const plan = await getOrCreateSubscriptionPlan();
      return res.status(200).json({
        status: true,
        message: "Subscription plan fetched",
        response: publicPlanPayload(plan),
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch subscription plan",
        error: error?.message || error,
      });
    }
  }

  static async resources(req: Request, res: Response) {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;
      const filter = { status: SubscriptionContentStatus.ACTIVE };
      const [items, total] = await Promise.all([
        SubscriptionResource.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate({ path: "categoryId", select: "name status" })
          .lean(),
        SubscriptionResource.countDocuments(filter),
      ]);
      const files = await SubscriptionResourceFile.find({
        resource: { $in: items.map((item: any) => item._id) },
      })
        .sort({ createdAt: -1 })
        .lean();
      const filesByResource = new Map<string, any[]>();
      for (const file of files) {
        const key = String(file.resource);
        const list = filesByResource.get(key) || [];
        list.push(file);
        filesByResource.set(key, list);
      }
      const totalPages = Math.ceil(total / limit);
      return res.status(200).json({
        status: true,
        message: "Subscription resources fetched",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        response: items.map((item: any) => ({
          ...item,
          files: filesByResource.get(String(item._id)) || [],
        })),
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch resources",
        error: error?.message || error,
      });
    }
  }

  static async status(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as
        | { id?: string; email?: string }
        | undefined;
      if (!currentUser?.id) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
      }

      const subscription = await findOpenSubscription(currentUser.id);
      const latest = subscription
        ? subscription
        : await Subscription.findOne({
            userId: new mongoose.Types.ObjectId(currentUser.id),
          }).sort({ createdAt: -1 });

      return res.status(200).json({
        status: true,
        message: "Subscription status fetched",
        response: {
          canSubscribe: !(await hasActiveCourseEnrollment(currentUser.email)),
          hasAccess: isSubscriptionAccessActive(latest),
          subscription: serializeSubscription(latest),
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch subscription status",
        error: error?.message || error,
      });
    }
  }

  static async subscribe(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as
        | { id?: string; email?: string }
        | undefined;
      if (!currentUser?.id || !currentUser?.email) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
      }

      const result = await startSubscriptionCheckout({
        userId: currentUser.id,
        email: currentUser.email,
      });

      return res.status(200).json({
        status: true,
        message: "Subscription payment initialized",
        response: {
          subscription: serializeSubscription(result.subscription),
          invoice: result.invoice,
          payment: result.payment,
        },
      });
    } catch (error: any) {
      return res.status(error?.statusCode || 500).json({
        status: false,
        message: error?.message || "Subscription initialization failed",
        error: error?.response?.data || error?.message || error,
      });
    }
  }

  static async invoices(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as { id?: string } | undefined;
      if (!currentUser?.id) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
      }

      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;
      const filter = { userId: new mongoose.Types.ObjectId(currentUser.id) };

      const [invoices, total] = await Promise.all([
        SubscriptionInvoice.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        SubscriptionInvoice.countDocuments(filter),
      ]);
      const totalPages = Math.ceil(total / limit);

      return res.status(200).json({
        status: true,
        message: "Invoices fetched successfully",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        response: invoices,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch invoices",
        error: error?.message || error,
      });
    }
  }

  static async payInvoice(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as
        | { id?: string; email?: string }
        | undefined;
      const { id } = req.params as { id?: string };
      if (!currentUser?.id || !currentUser?.email) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
      }
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid invoice id" });
      }

      const invoice = await SubscriptionInvoice.findOne({
        _id: id,
        userId: new mongoose.Types.ObjectId(currentUser.id),
      });
      if (!invoice) {
        return res.status(404).json({ status: false, message: "Invoice not found" });
      }
      if (invoice.status === SubscriptionInvoiceStatus.PAID) {
        return res.status(400).json({ status: false, message: "Invoice already paid" });
      }
      if (invoice.status === SubscriptionInvoiceStatus.VOID) {
        return res.status(400).json({ status: false, message: "Invoice is void" });
      }

      const payment = await initializeInvoicePayment({
        invoice,
        email: currentUser.email,
        userId: currentUser.id,
      });

      return res.status(200).json({
        status: true,
        message: "Invoice payment initialized",
        response: {
          invoice,
          payment,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to initialize invoice payment",
        error: error?.response?.data || error?.message || error,
      });
    }
  }

  static async verify(req: Request, res: Response) {
    try {
      const { reference } = req.params as { reference?: string };
      const currentUser = req["currentUser"] as { id?: string } | undefined;
      if (!currentUser?.id) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
      }
      if (!reference) {
        return res.status(400).json({ status: false, message: "reference required" });
      }

      const invoice = await SubscriptionInvoice.findOne({ paymentReference: reference });
      if (!invoice) {
        return res.status(404).json({ status: false, message: "Invoice not found" });
      }
      if (String(invoice.userId) !== String(currentUser.id)) {
        return res.status(403).json({ status: false, message: "Forbidden" });
      }
      if (invoice.status === SubscriptionInvoiceStatus.PAID) {
        const subscription = await Subscription.findById(invoice.subscription);
        return res.status(200).json({
          status: true,
          message: "Payment already verified",
          response: {
            invoice,
            subscription: serializeSubscription(subscription),
          },
        });
      }

      const data = await verifyPaystackReference(reference);
      const success = data?.status === "success";
      if (!success) {
        return res.status(400).json({
          status: false,
          message: "Payment failed",
          response: { invoice, paystackData: data },
        });
      }

      const result = await applySuccessfulInvoicePayment(invoice, data);
      return res.status(200).json({
        status: true,
        message: "Payment verified",
        response: {
          invoice: result.invoice,
          subscription: serializeSubscription(
            result.subscription || (await Subscription.findById(invoice.subscription))
          ),
        },
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
      const reference = (req.query.reference as string) || "";
      if (!reference) {
        return res.status(400).send("Missing payment reference");
      }
      const invoice = await SubscriptionInvoice.findOne({ paymentReference: reference });
      if (!invoice) {
        return res.status(404).send("Invoice not found");
      }
      if (invoice.status === SubscriptionInvoiceStatus.PAID) {
        return res.status(200).send("Subscription payment SUCCESS");
      }
      const data = await verifyPaystackReference(reference);
      const success = data?.status === "success";
      if (success) {
        await applySuccessfulInvoicePayment(invoice, data);
      }
      return res
        .status(200)
        .send(`Subscription payment ${success ? "SUCCESS" : "FAILED"}`);
    } catch (error) {
      return res.status(500).send("Subscription payment verification failed");
    }
  }

  static async webhook(req: Request, res: Response) {
    try {
      const signature = req.headers["x-paystack-signature"] as string | undefined;
      const rawBody = getRawBodyString(req.body, req["rawBody"]);
      if (!verifyPaystackWebhookSignature(signature, rawBody)) {
        return res.status(401).json({ status: false, message: "Invalid signature" });
      }

      const event = req.body as any;
      const data = event?.data;
      const reference = data?.reference as string | undefined;
      if (!reference) {
        return res.status(200).json({ status: true, message: "No reference" });
      }

      const invoice = await SubscriptionInvoice.findOne({ paymentReference: reference });
      if (!invoice) {
        return res.status(200).json({ status: true, message: "Invoice not found" });
      }
      if (invoice.status === SubscriptionInvoiceStatus.PAID) {
        return res.status(200).json({ status: true, message: "Already processed" });
      }

      const eventName = event?.event as string | undefined;
      const success = eventName === "charge.success" || data?.status === "success";
      if (!success) {
        return res.status(200).json({
          status: true,
          paymentStatus: "FAILED",
          message: "Payment failed",
        });
      }

      await applySuccessfulInvoicePayment(invoice, data);
      return res.status(200).json({
        status: true,
        paymentStatus: "SUCCESS",
        message: "Payment success",
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: "Webhook processing failed",
      });
    }
  }

  static async cancel(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as { id?: string } | undefined;
      if (!currentUser?.id) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
      }

      const subscription = await findOpenSubscription(currentUser.id);
      if (!subscription) {
        return res.status(404).json({
          status: false,
          message: "No active subscription to cancel",
        });
      }

      if (subscription.status === SubscriptionStatus.PENDING) {
        subscription.status = SubscriptionStatus.CANCELLED;
        subscription.cancelAtPeriodEnd = true;
        subscription.cancelledAt = new Date();
        await subscription.save();
        await SubscriptionInvoice.updateMany(
          {
            subscription: subscription._id,
            status: {
              $in: [
                SubscriptionInvoiceStatus.OPEN,
                SubscriptionInvoiceStatus.OVERDUE,
              ],
            },
          },
          { $set: { status: SubscriptionInvoiceStatus.VOID } }
        );
        return res.status(200).json({
          status: true,
          message: "Subscription cancelled",
          response: serializeSubscription(subscription),
        });
      }

      subscription.cancelAtPeriodEnd = true;
      subscription.cancelledAt = new Date();
      await subscription.save();

      return res.status(200).json({
        status: true,
        message:
          "Subscription will remain active until the end of the current period",
        response: serializeSubscription(subscription),
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to cancel subscription",
        error: error?.message || error,
      });
    }
  }
}
