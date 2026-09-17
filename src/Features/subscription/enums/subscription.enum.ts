export enum SubscriptionStatus {
  PENDING = "PENDING",
  ACTIVE = "ACTIVE",
  PAST_DUE = "PAST_DUE",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
}

export enum SubscriptionInvoiceStatus {
  OPEN = "OPEN",
  PAID = "PAID",
  OVERDUE = "OVERDUE",
  VOID = "VOID",
}

export enum SubscriptionContentStatus {
  ACTIVE = "ACTIVE",
  DEACTIVE = "DEACTIVE",
}

export enum SubscriptionResourceFileStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  SUCCESS = "SUCCESS",
  FAILED = "FAILED",
  SKIPPED = "SKIPPED",
}

export enum SubscriptionResourceType {
  PDF = "pdf",
  VIDEO = "video",
}
