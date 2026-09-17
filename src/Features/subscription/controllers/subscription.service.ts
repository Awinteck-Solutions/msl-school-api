import axios from "axios";
import * as crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import mongoose from "mongoose";
import User from "../../user/schema/user.schema";
import { sendFirebaseNotification } from "../../../helpers/firebase";
import { isUserNotificationEnabled } from "../../../helpers/notificationSettings";
import {
  countActiveCourseEnrollments,
  getActiveEnrolledCourseIds,
} from "../../../helpers/enrollment";
import {
  SubscriptionInvoiceStatus,
  SubscriptionStatus,
} from "../enums/subscription.enum";
import SubscriptionPlan from "../schema/subscriptionPlan.schema";
import Subscription from "../schema/subscription.schema";
import SubscriptionInvoice from "../schema/subscriptionInvoice.schema";

const PAYSTACK_BASE_URL = "https://api.paystack.co";

export const toKobo = (amount: number): number => Math.round(amount * 100);

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

export const getRawBodyString = (body: unknown, rawBody?: Buffer): string => {
  if (rawBody && Buffer.isBuffer(rawBody)) return rawBody.toString("utf8");
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (typeof body === "string") return body;
  return JSON.stringify(body ?? {});
};

export const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const isSameDay = (a?: Date | null, b?: Date | null) => {
  if (!a || !b) return false;
  return startOfDay(a).getTime() === startOfDay(b).getTime();
};

export const getOrCreateSubscriptionPlan = async () => {
  return SubscriptionPlan.findOneAndUpdate(
    {},
    {
      $setOnInsert: {
        amount: 0,
        currency: "NGN",
        intervalDays: 30,
        gracePeriodDays: 7,
        reminderDaysBeforeExpiry: 3,
        dailyAiLimit: 10,
        monthlyAiLimit: 100,
        isActive: false,
        description:
          "Monthly AI subscription for users without course enrollment",
      },
    },
    { upsert: true, new: true }
  );
};

export const publicPlanPayload = (plan: any) => ({
  amount: plan.amount,
  currency: plan.currency,
  intervalDays: plan.intervalDays,
  gracePeriodDays: plan.gracePeriodDays,
  reminderDaysBeforeExpiry: plan.reminderDaysBeforeExpiry,
  dailyAiLimit: plan.dailyAiLimit,
  monthlyAiLimit: plan.monthlyAiLimit,
  isActive: Boolean(plan.isActive && plan.amount > 0),
  description: plan.description,
});

export const generateInvoiceNumber = () => {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `INV-${stamp}-${uuidv4().slice(0, 8).toUpperCase()}`;
};

export const hasActiveCourseEnrollment = async (email?: string) => {
  const normalized = typeof email === "string" ? email.trim() : "";
  if (!normalized) return false;
  const count = await countActiveCourseEnrollments(normalized);
  return count > 0;
};

export const getUserEnrolledCourseIds = async (email?: string) => {
  const normalized = typeof email === "string" ? email.trim() : "";
  if (!normalized) return [];
  return getActiveEnrolledCourseIds(normalized);
};

const OPEN_STATUSES = [
  SubscriptionStatus.PENDING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
];

export const findOpenSubscription = async (userId: string) => {
  return Subscription.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    status: { $in: OPEN_STATUSES },
  }).sort({ createdAt: -1 });
};

export const isSubscriptionAccessActive = (subscription: any, now = new Date()) => {
  if (!subscription) return false;
  const status = subscription.status as SubscriptionStatus;
  if (status === SubscriptionStatus.EXPIRED) return false;
  if (status === SubscriptionStatus.PENDING) return false;

  const periodEnd = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd)
    : null;
  const graceEnd = subscription.gracePeriodEndsAt
    ? new Date(subscription.gracePeriodEndsAt)
    : null;

  if (status === SubscriptionStatus.ACTIVE && periodEnd && now <= periodEnd) {
    return true;
  }
  if (status === SubscriptionStatus.CANCELLED && periodEnd && now <= periodEnd) {
    return true;
  }
  if (status === SubscriptionStatus.PAST_DUE && graceEnd && now <= graceEnd) {
    return true;
  }
  if (status === SubscriptionStatus.ACTIVE && graceEnd && now <= graceEnd) {
    return true;
  }
  return false;
};

export const serializeSubscription = (subscription: any) => {
  if (!subscription) return null;
  return {
    id: subscription._id,
    status: subscription.status,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    gracePeriodEndsAt: subscription.gracePeriodEndsAt,
    cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
    cancelledAt: subscription.cancelledAt,
    hasAccess: isSubscriptionAccessActive(subscription),
  };
};

export const notifySubscriptionUser = async (
  userId: string,
  payload: { title: string; body: string; event: string; invoiceId?: string }
) => {
  try {
    const user = await User.findById(userId)
      .select("firebase_token notificationSettings")
      .lean();
    const firebaseToken = (user as any)?.firebase_token as string | undefined;
    if (!firebaseToken) return;
    if (!isUserNotificationEnabled(user as any, "subscription")) return;
    await sendFirebaseNotification(firebaseToken, {
      title: payload.title,
      body: payload.body,
      data: {
        type: "subscription",
        event: payload.event,
        ...(payload.invoiceId ? { invoiceId: payload.invoiceId } : {}),
      },
    });
  } catch (error) {
    console.error("[subscription] notification failed", error);
  }
};

const createInvoiceForPeriod = async (params: {
  subscription: any;
  plan: any;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
}) => {
  const invoice = SubscriptionInvoice({
    subscription: params.subscription._id,
    userId: params.subscription.userId,
    email: params.subscription.email,
    invoiceNumber: generateInvoiceNumber(),
    amount: params.plan.amount,
    amountKobo: toKobo(params.plan.amount),
    currency: params.plan.currency || "NGN",
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    dueDate: params.dueDate,
    status: SubscriptionInvoiceStatus.OPEN,
  });
  await invoice.save();
  params.subscription.lastInvoice = invoice._id;
  await params.subscription.save();
  return invoice;
};

export const initializeInvoicePayment = async (params: {
  invoice: any;
  email: string;
  userId: string;
}) => {
  const callbackUrl =
    process.env.PAYSTACK_SUBSCRIPTION_CALLBACK_URL ||
    process.env.PAYSTACK_CALLBACK_URL;
  if (!callbackUrl) {
    throw new Error("PAYSTACK_SUBSCRIPTION_CALLBACK_URL is not configured");
  }

  const reference = uuidv4();
  const payload = {
    email: params.email,
    amount: params.invoice.amountKobo,
    currency: params.invoice.currency || "NGN",
    reference,
    callback_url: callbackUrl,
    metadata: {
      type: "subscription",
      invoiceId: String(params.invoice._id),
      subscriptionId: String(params.invoice.subscription),
      userId: params.userId,
    },
  };

  const response = await axios.post(
    `${PAYSTACK_BASE_URL}/transaction/initialize`,
    payload,
    { headers: getPaystackHeaders() }
  );

  if (!response.data?.status) {
    throw new Error(response.data?.message || "Payment initialization failed");
  }

  params.invoice.paymentReference = reference;
  params.invoice.authorizationUrl = response.data?.data?.authorization_url;
  params.invoice.accessCode = response.data?.data?.access_code;
  params.invoice.paystackData = response.data?.data;
  await params.invoice.save();

  return {
    reference,
    authorization_url: response.data?.data?.authorization_url,
    access_code: response.data?.data?.access_code,
  };
};

export const verifyPaystackReference = async (reference: string) => {
  const response = await axios.get(
    `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
    { headers: getPaystackHeaders() }
  );
  return response.data?.data;
};

export const applySuccessfulInvoicePayment = async (
  invoice: any,
  paystackData?: any
) => {
  if (invoice.status === SubscriptionInvoiceStatus.PAID) {
    return { invoice, alreadyPaid: true };
  }

  const plan = await getOrCreateSubscriptionPlan();
  const subscription = await Subscription.findById(invoice.subscription);
  if (!subscription) {
    throw new Error("Subscription not found for invoice");
  }

  const now = new Date();
  const previousEnd = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd)
    : null;
  const periodStart =
    previousEnd && previousEnd > now ? previousEnd : now;
  const periodEnd = addDays(periodStart, plan.intervalDays || 30);

  invoice.status = SubscriptionInvoiceStatus.PAID;
  invoice.paidAt = now;
  invoice.paystackData = paystackData || invoice.paystackData;
  invoice.periodStart = periodStart;
  invoice.periodEnd = periodEnd;
  await invoice.save();

  subscription.status = SubscriptionStatus.ACTIVE;
  subscription.currentPeriodStart = periodStart;
  subscription.currentPeriodEnd = periodEnd;
  subscription.gracePeriodEndsAt = null;
  subscription.lastInvoice = invoice._id;
  if (!subscription.cancelAtPeriodEnd) {
    subscription.cancelledAt = null;
  }
  await subscription.save();

  await notifySubscriptionUser(String(subscription.userId), {
    title: "Subscription payment received",
    body: `Your MSL AI subscription is active until ${periodEnd.toDateString()}.`,
    event: "payment_success",
    invoiceId: String(invoice._id),
  });

  return { invoice, subscription, alreadyPaid: false };
};

export const startSubscriptionCheckout = async (params: {
  userId: string;
  email: string;
}) => {
  const plan = await getOrCreateSubscriptionPlan();
  if (!plan.isActive || !plan.amount || plan.amount <= 0) {
    const error: any = new Error("Subscription plan is not available yet");
    error.statusCode = 400;
    throw error;
  }

  const hasCourses = await hasActiveCourseEnrollment(params.email);
  if (hasCourses) {
    const error: any = new Error(
      "Users enrolled in an active course cannot subscribe. Course access already includes AI features."
    );
    error.statusCode = 400;
    throw error;
  }

  let subscription = await findOpenSubscription(params.userId);
  if (
    subscription &&
    subscription.status === SubscriptionStatus.ACTIVE &&
    isSubscriptionAccessActive(subscription)
  ) {
    const openInvoice = await SubscriptionInvoice.findOne({
      subscription: subscription._id,
      status: {
        $in: [
          SubscriptionInvoiceStatus.OPEN,
          SubscriptionInvoiceStatus.OVERDUE,
        ],
      },
    }).sort({ createdAt: -1 });
    if (openInvoice) {
      const payment = await initializeInvoicePayment({
        invoice: openInvoice,
        email: params.email,
        userId: params.userId,
      });
      return { subscription, invoice: openInvoice, payment };
    }
    const error: any = new Error("You already have an active subscription");
    error.statusCode = 400;
    throw error;
  }

  if (!subscription) {
    subscription = Subscription({
      userId: new mongoose.Types.ObjectId(params.userId),
      email: params.email,
      status: SubscriptionStatus.PENDING,
    });
    await subscription.save();
  }

  let invoice = await SubscriptionInvoice.findOne({
    subscription: subscription._id,
    status: SubscriptionInvoiceStatus.OPEN,
  }).sort({ createdAt: -1 });

  if (!invoice) {
    const periodStart = new Date();
    const periodEnd = addDays(periodStart, plan.intervalDays || 30);
    invoice = await createInvoiceForPeriod({
      subscription,
      plan,
      periodStart,
      periodEnd,
      dueDate: periodStart,
    });
  }

  const payment = await initializeInvoicePayment({
    invoice,
    email: params.email,
    userId: params.userId,
  });

  return { subscription, invoice, payment };
};

export const markOverdueInvoices = async (now = new Date()) => {
  await SubscriptionInvoice.updateMany(
    {
      status: SubscriptionInvoiceStatus.OPEN,
      dueDate: { $lt: now },
    },
    { $set: { status: SubscriptionInvoiceStatus.OVERDUE } }
  );
};

export const createRenewalInvoicesAndRemind = async (now = new Date()) => {
  const plan = await getOrCreateSubscriptionPlan();
  const reminderDays = plan.reminderDaysBeforeExpiry ?? 3;
  const reminderWindowStart = addDays(now, reminderDays);

  const dueSoon = await Subscription.find({
    status: SubscriptionStatus.ACTIVE,
    cancelAtPeriodEnd: { $ne: true },
    currentPeriodEnd: { $ne: null, $lte: reminderWindowStart, $gte: now },
  });

  for (const subscription of dueSoon) {
    const existing = await SubscriptionInvoice.findOne({
      subscription: subscription._id,
      status: {
        $in: [SubscriptionInvoiceStatus.OPEN, SubscriptionInvoiceStatus.OVERDUE],
      },
      periodStart: { $gte: subscription.currentPeriodEnd },
    });
    if (existing) continue;

    const periodStart = new Date(subscription.currentPeriodEnd);
    const periodEnd = addDays(periodStart, plan.intervalDays || 30);
    const invoice = await createInvoiceForPeriod({
      subscription,
      plan,
      periodStart,
      periodEnd,
      dueDate: periodStart,
    });

    await notifySubscriptionUser(String(subscription.userId), {
      title: "Your AI subscription invoice is ready",
      body: `A new invoice of ${plan.currency} ${plan.amount} is ready. Pay to keep AI access after ${periodStart.toDateString()}.`,
      event: "invoice_created",
      invoiceId: String(invoice._id),
    });
    invoice.lastReminderAt = now;
    await invoice.save();
  }

  const openInvoices = await SubscriptionInvoice.find({
    status: {
      $in: [SubscriptionInvoiceStatus.OPEN, SubscriptionInvoiceStatus.OVERDUE],
    },
  });

  for (const invoice of openInvoices) {
    if (isSameDay(invoice.lastReminderAt, now)) continue;
    await notifySubscriptionUser(String(invoice.userId), {
      title: "Pay your MSL AI invoice",
      body: `Invoice ${invoice.invoiceNumber} is waiting. Pay to keep your subscription active.`,
      event: "invoice_reminder",
      invoiceId: String(invoice._id),
    });
    invoice.lastReminderAt = now;
    await invoice.save();
  }
};

export const applyPeriodEndTransitions = async (now = new Date()) => {
  const plan = await getOrCreateSubscriptionPlan();
  const graceDays = plan.gracePeriodDays ?? 7;

  const endedActive = await Subscription.find({
    status: SubscriptionStatus.ACTIVE,
    currentPeriodEnd: { $ne: null, $lt: now },
  });

  for (const subscription of endedActive) {
    if (subscription.cancelAtPeriodEnd) {
      subscription.status = SubscriptionStatus.CANCELLED;
      subscription.gracePeriodEndsAt = null;
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
      await notifySubscriptionUser(String(subscription.userId), {
        title: "Subscription ended",
        body: "Your AI subscription has ended. Subscribe again anytime.",
        event: "subscription_ended",
      });
      continue;
    }

    const unpaid = await SubscriptionInvoice.findOne({
      subscription: subscription._id,
      status: {
        $in: [SubscriptionInvoiceStatus.OPEN, SubscriptionInvoiceStatus.OVERDUE],
      },
    });

    subscription.status = SubscriptionStatus.PAST_DUE;
    subscription.gracePeriodEndsAt = addDays(now, graceDays);
    await subscription.save();

    if (unpaid) {
      unpaid.status = SubscriptionInvoiceStatus.OVERDUE;
      await unpaid.save();
    }

    await notifySubscriptionUser(String(subscription.userId), {
      title: "Subscription payment overdue",
      body: `Your AI access continues until ${subscription.gracePeriodEndsAt.toDateString()}. Pay your invoice to avoid losing access.`,
      event: "grace_period_started",
      invoiceId: unpaid ? String(unpaid._id) : undefined,
    });
  }

  const expiredGrace = await Subscription.find({
    status: SubscriptionStatus.PAST_DUE,
    gracePeriodEndsAt: { $ne: null, $lt: now },
  });

  for (const subscription of expiredGrace) {
    subscription.status = SubscriptionStatus.EXPIRED;
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
    await notifySubscriptionUser(String(subscription.userId), {
      title: "AI subscription expired",
      body: "Your grace period ended. Subscribe again to restore AI access.",
      event: "subscription_expired",
    });
  }
};

export const runSubscriptionBillingJob = async () => {
  const now = new Date();
  await markOverdueInvoices(now);
  await createRenewalInvoicesAndRemind(now);
  await applyPeriodEndTransitions(now);
};

export const verifyPaystackWebhookSignature = (
  signature: string | undefined,
  rawBody: string
) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!signature || !secret) return false;
  const hash = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  try {
    const signatureBuf = Buffer.from(signature, "hex");
    const hashBuf = Buffer.from(hash, "hex");
    return (
      signatureBuf.length === hashBuf.length &&
      crypto.timingSafeEqual(signatureBuf, hashBuf)
    );
  } catch {
    return false;
  }
};
