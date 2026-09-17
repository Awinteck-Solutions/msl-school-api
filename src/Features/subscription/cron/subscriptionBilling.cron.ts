import cron from "node-cron";
import { runSubscriptionBillingJob } from "../controllers/subscription.service";

type SubscriptionBillingOptions = {
  cronExpression?: string;
};

export const startSubscriptionBillingCron = (
  options: SubscriptionBillingOptions = {}
) => {
  const cronExpression = options.cronExpression || "0 9 * * *";

  cron.schedule(
    cronExpression,
    async () => {
      try {
        await runSubscriptionBillingJob();
      } catch (error) {
        console.error("[subscription] billing cron failed", error);
      }
    },
    { timezone: "Etc/GMT" }
  );
};
