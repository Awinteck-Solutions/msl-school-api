export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const PERMISSIONS = [
  { key: "overview.view", group: "Overview", label: "View the overview" },
  { key: "analytics.view", group: "Analytics", label: "View analytics and past-question insights" },
  { key: "users.view", group: "Students", label: "View students" },
  { key: "users.edit", group: "Students", label: "Edit or deactivate students" },
  { key: "users.delete", group: "Students", label: "Delete students" },
  { key: "team.view", group: "Team", label: "View the team" },
  { key: "team.manage", group: "Team", label: "Add or edit team members" },
  { key: "roles.manage", group: "Team", label: "Change what each role is allowed to do" },
  { key: "actions.view", group: "Team", label: "View the staff action log" },
  { key: "courses.view", group: "Courses", label: "View courses" },
  { key: "courses.edit", group: "Courses", label: "Create and edit courses" },
  { key: "courses.delete", group: "Courses", label: "Delete courses" },
  { key: "lessons.edit", group: "Lessons", label: "Add and edit lessons" },
  { key: "lessons.delete", group: "Lessons", label: "Delete lessons" },
  { key: "categories.view", group: "Categories", label: "View course categories" },
  { key: "categories.manage", group: "Categories", label: "Add, edit, reorder, or delete categories" },
  { key: "requests.view", group: "Course requests", label: "View course access requests" },
  { key: "requests.approve", group: "Course requests", label: "Approve or dismiss course access requests" },
  { key: "requests.delete", group: "Course requests", label: "Delete course access requests" },
  { key: "quizzes.view", group: "Quizzes", label: "View quizzes" },
  { key: "quizzes.edit", group: "Quizzes", label: "Edit quizzes" },
  { key: "quizzes.delete", group: "Quizzes", label: "Delete quizzes" },
  { key: "flashcards.view", group: "Flashcards", label: "View flashcards" },
  { key: "flashcards.edit", group: "Flashcards", label: "Edit flashcards" },
  { key: "flashcards.delete", group: "Flashcards", label: "Delete flashcards" },
  { key: "payments.view", group: "Payments", label: "View course payments" },
  { key: "payments.manage", group: "Payments", label: "Change course payments" },
  { key: "subscriptions.view", group: "Subscriptions", label: "View subscriptions and resources" },
  { key: "subscriptions.manage", group: "Subscriptions", label: "Change subscriptions, plans, and resources" },
  { key: "ai.view", group: "AI", label: "View AI usage" },
  { key: "ai.manage", group: "AI", label: "Change AI limits and indexes" },
  { key: "ai.transcripts", group: "AI", label: "Read AI questions and answers" },
  { key: "feedback.view", group: "Support", label: "View feedback" },
  { key: "feedback.manage", group: "Support", label: "Update or delete feedback and FAQs" },
  { key: "adverts.view", group: "Support", label: "View adverts" },
  { key: "adverts.manage", group: "Support", label: "Create, edit, or delete adverts" },
  { key: "pastQuestions.view", group: "Past questions", label: "View past questions" },
  { key: "pastQuestions.manage", group: "Past questions", label: "Edit past questions" },
  { key: "versions.manage", group: "System", label: "Manage app versions" },
  { key: "logs.view", group: "System", label: "View request logs" },
  { key: "logs.delete", group: "System", label: "Delete request logs" },
] as const;

const KEYS = PERMISSIONS.map((item) => item.key);

const allow = (keys: string[]) =>
  Object.fromEntries(KEYS.map((key) => [key, keys.includes(key)])) as Record<PermissionKey, boolean>;

const deny = (keys: string[]) =>
  Object.fromEntries(KEYS.map((key) => [key, !keys.includes(key)])) as Record<PermissionKey, boolean>;

export const ROLE_NAMES = ["ADMIN", "STAFF_SENIOR", "STAFF_JUNIOR", "AUDITOR"] as const;

export const DEFAULT_ROLE_PERMISSIONS: Record<string, Record<PermissionKey, boolean>> = {
  ADMIN: deny([]),
  STAFF_SENIOR: deny(["analytics.view", "courses.delete", "users.delete", "roles.manage"]),
  STAFF_JUNIOR: allow([
    "overview.view",
    "users.view",
    "courses.view",
    "lessons.edit",
    "lessons.delete",
    "categories.view",
    "requests.view",
    "requests.approve",
    "quizzes.view",
    "quizzes.edit",
    "flashcards.view",
    "flashcards.edit",
    "payments.view",
    "subscriptions.view",
    "ai.view",
    "ai.transcripts",
    "feedback.view",
    "pastQuestions.view",
  ]),
  AUDITOR: Object.fromEntries(
    KEYS.map((key) => [key, key.endsWith(".view") || key === "ai.transcripts"])
  ) as Record<PermissionKey, boolean>,
};

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const permissionForRequest = (method: string, originalUrl: string): PermissionKey | null => {
  const path = String(originalUrl || "").split("?")[0];
  const write = WRITE.has(method.toUpperCase());
  const del = method.toUpperCase() === "DELETE" || path.includes("/delete");

  if (path.includes("/admin/access/me")) return null;
  if (path.includes("/admin/access/roles")) return "roles.manage";
  if (path.includes("/admin/access/actions")) return "actions.view";
  if (path.includes("/admin/ai/conversations")) return "ai.transcripts";
  if (path.includes("/admin/ai/past-question-usage") || path.includes("/past-questions/ai-usage")) {
    return "ai.view";
  }
  if (path.includes("/admin/analytics") || path.includes("/insights/analytics")) return "analytics.view";
  if (path.includes("/admin/logs")) return del ? "logs.delete" : "logs.view";
  if (path.includes("/admin/user/non-users")) {
    if (del) return "users.delete";
    return write ? "team.manage" : "team.view";
  }
  if (path.includes("/admin/user")) {
    if (del) return "users.delete";
    return write ? "users.edit" : "users.view";
  }
  if (path.includes("/admin/lesson")) return del ? "lessons.delete" : write ? "lessons.edit" : "courses.view";
  if (
    path.includes("/admin/enrolment") ||
    path.includes("archived-student") ||
    path.includes("deactivated-student")
  ) {
    return write ? "courses.edit" : "courses.view";
  }
  if (path.includes("/admin/course")) {
    if (del) return "courses.delete";
    return write ? "courses.edit" : "courses.view";
  }
  if (path.includes("/admin/category")) return write ? "categories.manage" : "categories.view";
  if (path.includes("/admin/request")) {
    if (del) return "requests.delete";
    return write ? "requests.approve" : "requests.view";
  }
  if (path.includes("/admin/quiz")) return del ? "quizzes.delete" : write ? "quizzes.edit" : "quizzes.view";
  if (path.includes("/admin/flashcard")) {
    return del ? "flashcards.delete" : write ? "flashcards.edit" : "flashcards.view";
  }
  if (path.includes("/admin/payment")) return write ? "payments.manage" : "payments.view";
  if (path.includes("/admin/subscription")) {
    if (path.includes("/ai/")) return write ? "ai.manage" : "ai.view";
    return write ? "subscriptions.manage" : "subscriptions.view";
  }
  if (path.includes("/admin/gemini-ai") || path.includes("/admin/msl-ai")) {
    return write ? "ai.manage" : "ai.view";
  }
  if (path.includes("/admin/past-questions")) {
    if (path.includes("ai-limit")) return write ? "ai.manage" : "ai.view";
    return write ? "pastQuestions.manage" : "pastQuestions.view";
  }
  if (path.includes("/admin/feedback") || path.includes("/admin/faq")) {
    return write ? "feedback.manage" : "feedback.view";
  }
  if (path.includes("/admin/adverts")) return write ? "adverts.manage" : "adverts.view";
  if (path.includes("/v2/system")) return "versions.manage";
  return write ? "courses.edit" : "overview.view";
};
