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

const BUILTIN_PLANS = [
  { code: "monthly", name: "Monthly", intervalDays: 30, sortOrder: 1 },
  { code: "quarterly", name: "Quarterly", intervalDays: 90, sortOrder: 2 },
  { code: "annual", name: "Annual", intervalDays: 365, sortOrder: 3 },
];

let ensuringPlans: Promise<void> | null = null;

const dropLegacySingletonIndex = async () => {
  const indexes = await SubscriptionPlan.collection.indexes();
  for (const index of indexes) {
    if (!index.unique || index.name === "_id_") continue;
    const keys = Object.keys(index.key || {});
    if (keys.length === 1 && keys[0] === "code") continue;
    await SubscriptionPlan.collection.dropIndex(index.name).catch(() => {});
  }
};

const sharedFrom = (plan: any) => ({
  currency: plan?.currency || "GHS",
  gracePeriodDays: plan?.gracePeriodDays ?? 7,
  reminderDaysBeforeExpiry: plan?.reminderDaysBeforeExpiry ?? 3,
  dailyAiLimit: plan?.dailyAiLimit ?? 10,
  monthlyAiLimit: plan?.monthlyAiLimit ?? 100,
});

export const ensureSubscriptionPlans = async () => {
  if (!ensuringPlans) {
    ensuringPlans = (async () => {
      await dropLegacySingletonIndex();
      const existing = await SubscriptionPlan.find({}).sort({ createdAt: 1 });
      const legacy = existing.find((plan: any) => !plan.code);
      if (legacy) {
        legacy.code = "monthly";
        legacy.name = legacy.name || "Monthly";
        legacy.isBuiltin = true;
        legacy.sortOrder = 1;
        if (!legacy.intervalDays || legacy.intervalDays < 1) legacy.intervalDays = 30;
        await legacy.save();
      }

      const monthly =
        (await SubscriptionPlan.findOne({ code: "monthly" })) ||
        (await SubscriptionPlan.findOne({}));
      const shared = sharedFrom(monthly);

      for (const builtin of BUILTIN_PLANS) {
        const found = await SubscriptionPlan.findOne({ code: builtin.code });
        if (found) {
          if (!found.isBuiltin) {
            found.isBuiltin = true;
            await found.save();
          }
          continue;
        }
        const isMonthly = builtin.code === "monthly";
        await SubscriptionPlan.create({
          ...builtin,
          ...shared,
          amount: isMonthly ? monthly?.amount || 0 : 0,
          isActive: isMonthly ? Boolean(monthly?.isActive) : false,
          isBuiltin: true,
          description: `${builtin.name} AI subscription`,
        });
      }
    })().catch((error) => {
      ensuringPlans = null;
      throw error;
    });
  }
  return ensuringPlans;
};

export const getOrCreateSubscriptionPlan = async () => {
  await ensureSubscriptionPlans();
  const monthly = await SubscriptionPlan.findOne({ code: "monthly" });
  if (monthly) return monthly;
  return SubscriptionPlan.findOne({}).sort({ sortOrder: 1, createdAt: 1 });
};

export const listSubscriptionPlans = async () => {
  await ensureSubscriptionPlans();
  return SubscriptionPlan.find({}).sort({ sortOrder: 1, createdAt: 1 });
};

export const getPlanByIdOrCode = async (idOrCode?: string | null) => {
  await ensureSubscriptionPlans();
  const key = String(idOrCode || "").trim();
  if (!key) return getOrCreateSubscriptionPlan();
  if (mongoose.Types.ObjectId.isValid(key)) {
    const byId = await SubscriptionPlan.findById(key);
    if (byId) return byId;
  }
  return SubscriptionPlan.findOne({ code: key.toLowerCase() });
};

const slugifyPlanCode = (name: string) => {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "custom";
};

export const createCustomSubscriptionPlan = async (input: {
  name: string;
  intervalDays: number;
  amount: number;
  description?: string;
  isActive?: boolean;
  updatedBy?: string;
}) => {
  const monthly = await getOrCreateSubscriptionPlan();
  const shared = sharedFrom(monthly);
  let code = slugifyPlanCode(input.name);
  if (BUILTIN_PLANS.some((plan) => plan.code === code)) {
    code = `${code}-custom`;
  }
  const taken = await SubscriptionPlan.findOne({ code });
  if (taken) code = `${code}-${uuidv4().slice(0, 6)}`;
  const amount = Number(input.amount);
  const plan = await SubscriptionPlan.create({
    code,
    name: input.name.trim(),
    intervalDays: input.intervalDays,
    amount,
    ...shared,
    isActive: Boolean(input.isActive && amount > 0),
    isBuiltin: false,
    sortOrder: 100,
    description: input.description?.trim() || input.name.trim(),
    updatedBy: input.updatedBy || "admin",
  });
  return plan;
};

export const updateSubscriptionPlanModel = async (
  idOrCode: string,
  input: {
    name?: string;
    amount?: number;
    intervalDays?: number;
    description?: string;
    isActive?: boolean;
    updatedBy?: string;
  }
) => {
  const plan = await getPlanByIdOrCode(idOrCode);
  if (!plan) return null;
  if (typeof input.name === "string" && input.name.trim()) {
    plan.name = input.name.trim();
  }
  if (input.amount !== undefined) plan.amount = input.amount;
  if (input.intervalDays !== undefined) {
    if (plan.isBuiltin) {
      const builtin = BUILTIN_PLANS.find((row) => row.code === plan.code);
      plan.intervalDays = builtin?.intervalDays || plan.intervalDays;
    } else {
      plan.intervalDays = input.intervalDays;
    }
  }
  if (typeof input.description === "string") plan.description = input.description;
  if (typeof input.isActive === "boolean") plan.isActive = input.isActive;
  if (plan.isActive && (!plan.amount || plan.amount <= 0)) {
    const error: any = new Error(
      "Set a price greater than 0 before activating this model"
    );
    error.statusCode = 400;
    throw error;
  }
  plan.updatedBy = input.updatedBy || plan.updatedBy;
  await plan.save();
  return plan;
};

export const deleteCustomSubscriptionPlan = async (idOrCode: string) => {
  const plan = await getPlanByIdOrCode(idOrCode);
  if (!plan) return { deleted: false, missing: true };
  if (plan.isBuiltin || BUILTIN_PLANS.some((row) => row.code === plan.code)) {
    const error: any = new Error("Built-in models can be turned off, not deleted");
    error.statusCode = 400;
    throw error;
  }
  await SubscriptionPlan.deleteOne({ _id: plan._id });
  return { deleted: true, missing: false };
};

export const updateSharedSubscriptionSettings = async (input: {
  currency?: string;
  gracePeriodDays?: number;
  reminderDaysBeforeExpiry?: number;
  dailyAiLimit?: number;
  monthlyAiLimit?: number;
  description?: string;
  updatedBy?: string;
}) => {
  await ensureSubscriptionPlans();
  const $set: Record<string, unknown> = {
    updatedBy: input.updatedBy || "admin",
  };
  if (input.currency) $set.currency = input.currency;
  if (input.gracePeriodDays !== undefined) $set.gracePeriodDays = input.gracePeriodDays;
  if (input.reminderDaysBeforeExpiry !== undefined) {
    $set.reminderDaysBeforeExpiry = input.reminderDaysBeforeExpiry;
  }
  if (input.dailyAiLimit !== undefined) $set.dailyAiLimit = input.dailyAiLimit;
  if (input.monthlyAiLimit !== undefined) $set.monthlyAiLimit = input.monthlyAiLimit;
  await SubscriptionPlan.updateMany({}, { $set });
  if (input.description !== undefined) {
    await SubscriptionPlan.updateOne(
      { code: "monthly" },
      { $set: { description: input.description } }
    );
  }
  return getOrCreateSubscriptionPlan();
};

export const adminPlanCatalog = async () => {
  const plans = await listSubscriptionPlans();
  const monthly =
    plans.find((plan: any) => plan.code === "monthly") || plans[0];
  return {
    currency: monthly?.currency || "GHS",
    gracePeriodDays: monthly?.gracePeriodDays ?? 7,
    reminderDaysBeforeExpiry: monthly?.reminderDaysBeforeExpiry ?? 3,
    dailyAiLimit: monthly?.dailyAiLimit ?? 10,
    monthlyAiLimit: monthly?.monthlyAiLimit ?? 100,
    description: monthly?.description || "",
    intervalDays: monthly?.intervalDays || 30,
    amount: monthly?.amount || 0,
    isActive: Boolean(monthly?.isActive),
    updatedAt: monthly?.updatedAt,
    updatedBy: monthly?.updatedBy,
    plans,
  };
};

export const publicPlanPayload = (plan: any) => ({
  id: plan?._id,
  code: plan?.code || "monthly",
  name: plan?.name || "Monthly",
  amount: plan?.amount,
  currency: plan?.currency,
  intervalDays: plan?.intervalDays,
  gracePeriodDays: plan?.gracePeriodDays,
  reminderDaysBeforeExpiry: plan?.reminderDaysBeforeExpiry,
  dailyAiLimit: plan?.dailyAiLimit,
  monthlyAiLimit: plan?.monthlyAiLimit,
  isActive: Boolean(plan?.isActive && plan?.amount > 0),
  isBuiltin: Boolean(plan?.isBuiltin),
  description: plan?.description,
  sortOrder: plan?.sortOrder || 0,
});

export const publicCatalogPayload = (plans: any[]) => {
  const list = plans || [];
  const active = list.filter((plan) => plan.isActive && plan.amount > 0);
  const featured =
    active.find((plan) => plan.code === "monthly") ||
    list.find((plan) => plan.code === "monthly") ||
    active[0] ||
    list[0];
  return {
    ...publicPlanPayload(featured),
    plans: list.map(publicPlanPayload),
  };
};

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

/** Flags returned with login so clients know what the account can use. */
export const loginAccessSnapshot = async (userId?: string, email?: string) => {
  const id = String(userId || "");
  let activeSubscription = false;
  if (id && mongoose.Types.ObjectId.isValid(id)) {
    const open = await findOpenSubscription(id);
    const latest =
      open ||
      (await Subscription.findOne({
        userId: new mongoose.Types.ObjectId(id),
      }).sort({ createdAt: -1 }));
    activeSubscription = isSubscriptionAccessActive(latest);
  }
  const enrolledStatus = await hasActiveCourseEnrollment(email);
  return { activeSubscription, enrolledStatus };
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
    planId: params.plan?._id || null,
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

  const subscription = await Subscription.findById(invoice.subscription);
  if (!subscription) {
    throw new Error("Subscription not found for invoice");
  }

  let plan = invoice.planId
    ? await SubscriptionPlan.findById(invoice.planId)
    : null;
  if (!plan && subscription.planId) {
    plan = await SubscriptionPlan.findById(subscription.planId);
  }
  if (!plan) plan = await getOrCreateSubscriptionPlan();

  const now = new Date();
  const previousEnd = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd)
    : null;
  const periodStart =
    previousEnd && previousEnd > now ? previousEnd : now;
  const periodEnd = addDays(periodStart, plan?.intervalDays || 30);

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
  subscription.planId = plan?._id || subscription.planId;
  subscription.isManual = false;
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
  planId?: string;
}) => {
  const plan = await getPlanByIdOrCode(params.planId);
  if (!plan) {
    const error: any = new Error("Subscription model not found");
    error.statusCode = 404;
    throw error;
  }
  if (!plan.isActive) {
    const error: any = new Error("This subscription model is not active");
    error.statusCode = 400;
    throw error;
  }
  if (!plan.amount || plan.amount <= 0) {
    const error: any = new Error(
      "This subscription model has no price. An admin must set amount > 0 before it can be sold."
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
      planId: plan._id,
    });
    await subscription.save();
  } else {
    subscription.planId = plan._id;
    await subscription.save();
  }

  let invoice = await SubscriptionInvoice.findOne({
    subscription: subscription._id,
    status: SubscriptionInvoiceStatus.OPEN,
  }).sort({ createdAt: -1 });

  if (
    invoice &&
    ((invoice.planId && String(invoice.planId) !== String(plan._id)) ||
      Number(invoice.amount) !== Number(plan.amount))
  ) {
    invoice.status = SubscriptionInvoiceStatus.VOID;
    await invoice.save();
    invoice = null;
  }

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

/**
 * Gives a student the AI subscription without Paystack. `amount` 0 is a free grant; any other
 * amount is recorded as a paid invoice (for example cash or a discounted price collected elsewhere).
 * If the student already has live access, the new period is added after the current one.
 */
export const grantSubscription = async (params: {
  userId: string;
  email: string;
  amount: number;
  days?: number;
  note?: string;
  grantedBy?: string;
  planId?: string;
}) => {
  const plan = (await getPlanByIdOrCode(params.planId)) || (await getOrCreateSubscriptionPlan());
  const days = params.days && params.days > 0 ? params.days : plan?.intervalDays || 30;
  const now = new Date();

  let subscription = await findOpenSubscription(params.userId);
  if (!subscription) {
    subscription = Subscription({
      userId: new mongoose.Types.ObjectId(params.userId),
      email: params.email,
      status: SubscriptionStatus.PENDING,
      planId: params.planId ? plan?._id || null : null,
    });
  } else if (params.planId && plan?._id) {
    subscription.planId = plan._id;
  }

  const hasLiveAccess =
    subscription.status === SubscriptionStatus.ACTIVE &&
    subscription.currentPeriodEnd &&
    new Date(subscription.currentPeriodEnd) > now;
  const periodStart = hasLiveAccess ? new Date(subscription.currentPeriodEnd) : now;
  const periodEnd = addDays(periodStart, days);

  if (!subscription._id) await subscription.save();

  const invoice = SubscriptionInvoice({
    subscription: subscription._id,
    userId: subscription.userId,
    email: subscription.email || params.email,
    invoiceNumber: generateInvoiceNumber(),
    amount: params.amount,
    amountKobo: toKobo(params.amount),
    currency: plan.currency || "GHS",
    periodStart,
    periodEnd,
    dueDate: now,
    status: SubscriptionInvoiceStatus.PAID,
    planId: params.planId ? plan?._id || null : null,
    paidAt: now,
    paystackData: {
      manual: true,
      free: params.amount === 0,
      grantedBy: params.grantedBy || null,
      note: params.note || null,
    },
  });
  await invoice.save();

  // Anything still waiting for payment is replaced by this grant.
  await SubscriptionInvoice.updateMany(
    {
      subscription: subscription._id,
      _id: { $ne: invoice._id },
      status: {
        $in: [SubscriptionInvoiceStatus.OPEN, SubscriptionInvoiceStatus.OVERDUE],
      },
    },
    { $set: { status: SubscriptionInvoiceStatus.VOID } }
  );

  if (!hasLiveAccess) {
    subscription.currentPeriodStart = periodStart;
    subscription.isManual = true;
  }
  subscription.currentPeriodEnd = periodEnd;
  subscription.status = SubscriptionStatus.ACTIVE;
  subscription.gracePeriodEndsAt = null;
  subscription.cancelAtPeriodEnd = false;
  subscription.cancelledAt = null;
  subscription.lastInvoice = invoice._id;
  await subscription.save();

  await notifySubscriptionUser(String(subscription.userId), {
    title: "AI subscription activated",
    body: `Your MSL AI subscription is active until ${periodEnd.toDateString()}.`,
    event: "subscription_granted",
    invoiceId: String(invoice._id),
  });

  return { subscription, invoice };
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
  const settings = await getOrCreateSubscriptionPlan();
  const reminderDays = settings.reminderDaysBeforeExpiry ?? 3;
  const reminderWindowStart = addDays(now, reminderDays);

  const dueSoon = await Subscription.find({
    status: SubscriptionStatus.ACTIVE,
    cancelAtPeriodEnd: { $ne: true },
    isManual: { $ne: true },
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
    const plan = subscription.planId
      ? (await SubscriptionPlan.findById(subscription.planId)) || settings
      : settings;
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
    if (subscription.isManual) {
      // Admin-granted access is not billed, so it simply ends with no grace period.
      subscription.status = SubscriptionStatus.EXPIRED;
      subscription.gracePeriodEndsAt = null;
      await subscription.save();
      await notifySubscriptionUser(String(subscription.userId), {
        title: "AI subscription ended",
        body: "Your complimentary AI subscription has ended. Subscribe to keep your AI access.",
        event: "subscription_expired",
      });
      continue;
    }

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

const loadSubscription = async (subscriptionId: string) => {
  if (!subscriptionId || !mongoose.Types.ObjectId.isValid(subscriptionId)) {
    const error: any = new Error("Invalid subscription id");
    error.statusCode = 400;
    throw error;
  }
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) {
    const error: any = new Error("Subscription not found");
    error.statusCode = 404;
    throw error;
  }
  return subscription;
};

const voidInvoices = async (filter: Record<string, unknown>) => {
  await SubscriptionInvoice.updateMany(
    {
      ...filter,
      status: {
        $in: [SubscriptionInvoiceStatus.OPEN, SubscriptionInvoiceStatus.OVERDUE],
      },
    },
    { $set: { status: SubscriptionInvoiceStatus.VOID } }
  );
};

/** Stops access now and cancels any unpaid invoice. */
export const revokeSubscriptionAccess = async (subscriptionId: string) => {
  const subscription = await loadSubscription(subscriptionId);
  const now = new Date();
  subscription.status = SubscriptionStatus.EXPIRED;
  subscription.currentPeriodEnd = now;
  subscription.gracePeriodEndsAt = null;
  subscription.cancelAtPeriodEnd = true;
  subscription.cancelledAt = now;
  await subscription.save();
  await voidInvoices({ subscription: subscription._id });
  await notifySubscriptionUser(String(subscription.userId), {
    title: "AI subscription access removed",
    body: "Your AI subscription access has been removed. Subscribe again to restore it.",
    event: "subscription_revoked",
  });
  return subscription;
};

/** Keeps access until the current period ends and stops the next invoice. */
export const endSubscriptionAtPeriodEnd = async (subscriptionId: string) => {
  const subscription = await loadSubscription(subscriptionId);
  if (!isSubscriptionAccessActive(subscription) && subscription.cancelAtPeriodEnd) {
    const error: any = new Error("This subscription has already ended");
    error.statusCode = 400;
    throw error;
  }
  subscription.cancelAtPeriodEnd = true;
  subscription.cancelledAt = subscription.cancelledAt || new Date();
  await subscription.save();
  if (subscription.currentPeriodEnd) {
    await voidInvoices({
      subscription: subscription._id,
      periodStart: { $gte: subscription.currentPeriodEnd },
    });
  }
  await notifySubscriptionUser(String(subscription.userId), {
    title: "Subscription will not renew",
    body: subscription.currentPeriodEnd
      ? `Your AI access continues until ${new Date(subscription.currentPeriodEnd).toDateString()}. No further invoice will be created.`
      : "Your subscription will not renew and no further invoice will be created.",
    event: "subscription_ending",
  });
  return subscription;
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
