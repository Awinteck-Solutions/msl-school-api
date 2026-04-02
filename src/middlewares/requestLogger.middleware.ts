import { NextFunction, Request, Response } from "express";
import RequestLog from "../Features/logs/schema/log.schema";

const normalizePath = (endpoint: string): string =>
  endpoint.split("?")[0].replace(/^\/v2(?=\/|$)/, "");

const toRegex = (path: string): RegExp =>
  new RegExp(`^${path.replace(/:[^/]+/g, "[^/]+")}$`);

const getPurpose = (method: string, endpoint: string): string | undefined => {
  const path = normalizePath(endpoint);
  const normalizedMethod = method.toUpperCase();

  const rules: Array<{ method: string; pattern: RegExp; purpose: string }> = [
    // Logs
    { method: "GET", pattern: toRegex("/admin/logs"), purpose: "VIEW-LOGS" },

    // Analytics
    { method: "GET", pattern: toRegex("/admin/analytics/dashboard"), purpose: "VIEW-ANALYTICS-DASHBOARD" },
    { method: "GET", pattern: toRegex("/admin/analytics/students"), purpose: "VIEW-ANALYTICS-STUDENTS" },
    { method: "GET", pattern: toRegex("/admin/analytics/enrollments"), purpose: "VIEW-ANALYTICS-ENROLLMENTS" },
    { method: "GET", pattern: toRegex("/admin/analytics/conversions"), purpose: "VIEW-ANALYTICS-CONVERSIONS" },
    { method: "GET", pattern: toRegex("/admin/analytics/top-courses"), purpose: "VIEW-TOP-COURSE-LIST" },
    { method: "GET", pattern: toRegex("/admin/analytics/top-quizzes"), purpose: "VIEW-TOP-QUIZ-LIST" },
    { method: "GET", pattern: toRegex("/admin/analytics/top-flashcards"), purpose: "VIEW-TOP-FLASHCARD-LIST" },
    { method: "GET", pattern: toRegex("/admin/analytics/top-students"), purpose: "VIEW-TOP-STUDENT-LIST" },

    // FAQ
    { method: "GET", pattern: toRegex("/admin/faq/"), purpose: "VIEW-FAQ-LIST" },
    { method: "POST", pattern: toRegex("/admin/faq/"), purpose: "CREATE-FAQ" },
    { method: "PATCH", pattern: toRegex("/admin/faq/:id"), purpose: "UPDATE-FAQ" },
    { method: "DELETE", pattern: toRegex("/admin/faq/:id"), purpose: "DELETE-FAQ" },

    // Adverts
    { method: "GET", pattern: toRegex("/adverts"), purpose: "VIEW-ACTIVE-ADVERTS" },
    { method: "GET", pattern: toRegex("/admin/adverts"), purpose: "VIEW-ADMIN-ADVERT-LIST" },
    { method: "POST", pattern: toRegex("/admin/adverts"), purpose: "CREATE-ADVERT" },
    { method: "PATCH", pattern: toRegex("/admin/adverts/:id"), purpose: "UPDATE-ADVERT" },
    { method: "DELETE", pattern: toRegex("/admin/adverts/:id"), purpose: "DELETE-ADVERT" },

    // Payments
    { method: "POST", pattern: toRegex("/payment/initiate"), purpose: "INITIATE-PAYMENT" },
    { method: "GET", pattern: toRegex("/payment/verify/:reference"), purpose: "VERIFY-PAYMENT" },
    { method: "GET", pattern: toRegex("/payment/callback"), purpose: "VIEW-PAYMENT-CALLBACK" },
    { method: "GET", pattern: toRegex("/payment/my"), purpose: "VIEW-MY-PAYMENTS" },
    { method: "POST", pattern: toRegex("/payment/webhook"), purpose: "PAYMENT-WEBHOOK" },
    { method: "GET", pattern: toRegex("/admin/payment/"), purpose: "VIEW-ADMIN-PAYMENTS" },

    // V2 user
    { method: "POST", pattern: toRegex("/user/verify/device"), purpose: "VERIFY-USER-DEVICE" },
    { method: "POST", pattern: toRegex("/user/auth"), purpose: "AUTH-USER" },
    { method: "PATCH", pattern: toRegex("/user/upload_image"), purpose: "UPDATE-USER-IMAGE" },
    { method: "GET", pattern: toRegex("/user/profile"), purpose: "VIEW-USER-PROFILE" },
    { method: "GET", pattern: toRegex("/user/delete"), purpose: "DELETE-USER" },
    { method: "PATCH", pattern: toRegex("/user/profile"), purpose: "UPDATE-USER-PROFILE" },

    // V2 admin user
    { method: "GET", pattern: toRegex("/admin/user/all"), purpose: "VIEW-USER-LIST" },
    { method: "GET", pattern: toRegex("/admin/user/single/:id"), purpose: "VIEW-USER" },
    { method: "PATCH", pattern: toRegex("/admin/user/update-status/:id"), purpose: "UPDATE-USER-STATUS" },
    { method: "GET", pattern: toRegex("/admin/user/delete/:id"), purpose: "DELETE-USER" },
    { method: "GET", pattern: toRegex("/admin/user/non-users"), purpose: "VIEW-NONUSER-LIST" },
    { method: "POST", pattern: toRegex("/admin/user/auth"), purpose: "AUTH-NONUSER" },
    { method: "GET", pattern: toRegex("/admin/user/non-users/:id"), purpose: "VIEW-NONUSER" },
    { method: "POST", pattern: toRegex("/admin/user/non-users"), purpose: "CREATE-NONUSER" },
    { method: "PATCH", pattern: toRegex("/admin/user/non-users"), purpose: "UPDATE-NONUSER" },
    { method: "DELETE", pattern: toRegex("/admin/user/non-users/:id"), purpose: "DELETE-NONUSER" },

    // V2 course (user)
    { method: "GET", pattern: toRegex("/course/user-courses"), purpose: "VIEW-USER-COURSES" },
    { method: "GET", pattern: toRegex("/course/user-with-quizzes"), purpose: "VIEW-USER-COURSES-WITH-QUIZZES" },
    { method: "GET", pattern: toRegex("/course/"), purpose: "VIEW-COURSE-LIST" },
    { method: "GET", pattern: toRegex("/course/:id"), purpose: "VIEW-COURSE" },

    // V2 admin course
    { method: "GET", pattern: toRegex("/admin/course/"), purpose: "VIEW-ADMIN-COURSE-LIST" },
    { method: "GET", pattern: toRegex("/admin/course/by-student-id/:student_id"), purpose: "VIEW-ADMIN-COURSE-BY-STUDENT-ID" },
    { method: "GET", pattern: toRegex("/admin/course/by-student-email/:email"), purpose: "VIEW-ADMIN-COURSE-BY-STUDENT-EMAIL" },
    { method: "GET", pattern: toRegex("/admin/course/single/:id"), purpose: "VIEW-ADMIN-COURSE" },
    { method: "GET", pattern: toRegex("/admin/course/everything"), purpose: "VIEW-ADMIN-COURSE-ALL" },
    { method: "GET", pattern: toRegex("/admin/course/everything/:id"), purpose: "VIEW-ADMIN-COURSE-DETAIL" },
    { method: "POST", pattern: toRegex("/admin/course/"), purpose: "CREATE-COURSE" },
    { method: "PATCH", pattern: toRegex("/admin/course/"), purpose: "UPDATE-COURSE" },
    { method: "PATCH", pattern: toRegex("/admin/course/update-thumbnail"), purpose: "UPDATE-COURSE-THUMBNAIL" },
    { method: "DELETE", pattern: toRegex("/admin/course/:id"), purpose: "DELETE-COURSE" },
    { method: "PATCH", pattern: toRegex("/admin/course/update-status"), purpose: "UPDATE-COURSE-STATUS" },
    { method: "PATCH", pattern: toRegex("/admin/course/update-archive"), purpose: "UPDATE-COURSE-ARCHIVE" },
    { method: "POST", pattern: toRegex("/admin/course/add-archived-student"), purpose: "ADD-COURSE-ARCHIVED-STUDENT" },
    { method: "DELETE", pattern: toRegex("/admin/course/remove-archived-student"), purpose: "REMOVE-COURSE-ARCHIVED-STUDENT" },
    { method: "GET", pattern: toRegex("/admin/course/archived-by-student/:id"), purpose: "VIEW-COURSE-ARCHIVED-BY-STUDENT" },
    { method: "PATCH", pattern: toRegex("/admin/course/add-deactivated-student"), purpose: "ADD-COURSE-DEACTIVATED-STUDENT" },
    { method: "DELETE", pattern: toRegex("/admin/course/remove-deactivated-student"), purpose: "REMOVE-COURSE-DEACTIVATED-STUDENT" },
    { method: "GET", pattern: toRegex("/admin/course/deactivated-by-student/:id"), purpose: "VIEW-COURSE-DEACTIVATED-BY-STUDENT" },
    { method: "POST", pattern: toRegex("/admin/course/link-courses-to-course"), purpose: "LINK-COURSE-COURSES" },
    { method: "POST", pattern: toRegex("/admin/course/unlink-courses-from-course"), purpose: "UNLINK-COURSE-COURSES" },
    { method: "GET", pattern: toRegex("/admin/course/:id"), purpose: "VIEW-ADMIN-COURSE" },

    // V2 category
    { method: "GET", pattern: toRegex("/category/"), purpose: "VIEW-CATEGORY-LIST" },
    { method: "GET", pattern: toRegex("/admin/category/"), purpose: "VIEW-ADMIN-CATEGORY-LIST" },
    { method: "GET", pattern: toRegex("/admin/category/:id"), purpose: "VIEW-ADMIN-CATEGORY" },
    { method: "POST", pattern: toRegex("/admin/category/"), purpose: "CREATE-CATEGORY" },
    { method: "PATCH", pattern: toRegex("/admin/category/bulk-update"), purpose: "UPDATE-CATEGORY-BULK" },
    { method: "PATCH", pattern: toRegex("/admin/category/:id"), purpose: "UPDATE-CATEGORY" },
    { method: "DELETE", pattern: toRegex("/admin/category/:id"), purpose: "DELETE-CATEGORY" },

    // V2 feedback
    { method: "POST", pattern: toRegex("/feedback/"), purpose: "CREATE-FEEDBACK" },
    { method: "GET", pattern: toRegex("/admin/feedback/"), purpose: "VIEW-FEEDBACK-LIST" },
    { method: "DELETE", pattern: toRegex("/admin/feedback/:id"), purpose: "DELETE-FEEDBACK" },
    { method: "PATCH", pattern: toRegex("/admin/feedback/update-status"), purpose: "UPDATE-FEEDBACK-STATUS" },
    { method: "GET", pattern: toRegex("/admin/feedback/:id"), purpose: "VIEW-FEEDBACK" },

    // V2 request
    { method: "POST", pattern: toRegex("/request/add"), purpose: "CREATE-REQUEST" },
    { method: "GET", pattern: toRegex("/admin/request/"), purpose: "VIEW-REQUEST-LIST" },
    { method: "PATCH", pattern: toRegex("/admin/request/:id/toggle"), purpose: "TOGGLE-REQUEST" },
    { method: "DELETE", pattern: toRegex("/admin/request/:id"), purpose: "DELETE-REQUEST" },

    // V2 windows
    { method: "POST", pattern: toRegex("/windows/generate-code"), purpose: "CREATE-WINDOWS-CODE" },
    { method: "POST", pattern: toRegex("/windows/validate-code"), purpose: "VALIDATE-WINDOWS-CODE" },
    { method: "GET", pattern: toRegex("/windows/list-codes"), purpose: "VIEW-WINDOWS-CODES" },
    { method: "GET", pattern: toRegex("/windows/login-with-code/:id"), purpose: "LOGIN-WITH-CODE" },

    // V2 quiz (user)
    { method: "GET", pattern: toRegex("/quiz/"), purpose: "VIEW-QUIZ-LIST" },
    { method: "GET", pattern: toRegex("/quiz/by-student"), purpose: "VIEW-QUIZ-BY-STUDENT" },
    { method: "PATCH", pattern: toRegex("/quiz/quiz-response/update"), purpose: "UPDATE-QUIZ-RESPONSE" },
    { method: "POST", pattern: toRegex("/quiz/quiz-response/add"), purpose: "CREATE-QUIZ-RESPONSE" },
    { method: "GET", pattern: toRegex("/quiz/quiz-response/leaderboard/:quiz_id"), purpose: "VIEW-QUIZ-LEADERBOARD" },
    { method: "GET", pattern: toRegex("/quiz/quiz-response/by-quiz-id/:quiz_id"), purpose: "VIEW-QUIZ-RESPONSES-BY-QUIZ" },
    { method: "GET", pattern: toRegex("/quiz/by-course/:courseId/student"), purpose: "VIEW-QUIZ-BY-COURSE-STUDENT" },
    { method: "GET", pattern: toRegex("/quiz/:id"), purpose: "VIEW-QUIZ" },

    // V2 admin quiz
    { method: "PATCH", pattern: toRegex("/admin/quiz/thumbnail"), purpose: "UPDATE-QUIZ-THUMBNAIL" },
    { method: "GET", pattern: toRegex("/admin/quiz/all"), purpose: "VIEW-ADMIN-QUIZ-LIST" },
    { method: "GET", pattern: toRegex("/admin/quiz/single/:id"), purpose: "VIEW-ADMIN-QUIZ" },
    { method: "GET", pattern: toRegex("/admin/quiz/by_course/:course"), purpose: "VIEW-ADMIN-QUIZ-BY-COURSE" },
    { method: "PATCH", pattern: toRegex("/admin/quiz/toggle/:id"), purpose: "TOGGLE-QUIZ" },
    { method: "PATCH", pattern: toRegex("/admin/quiz/info"), purpose: "UPDATE-QUIZ-INFO" },
    { method: "DELETE", pattern: toRegex("/admin/quiz/:id"), purpose: "DELETE-QUIZ" },
    { method: "POST", pattern: toRegex("/admin/quiz/add"), purpose: "CREATE-QUIZ" },
    { method: "PATCH", pattern: toRegex("/admin/quiz/update"), purpose: "UPDATE-QUIZ" },
    { method: "POST", pattern: toRegex("/admin/quiz/quiz-item"), purpose: "CREATE-QUIZ-ITEM" },
    { method: "POST", pattern: toRegex("/admin/quiz/quiz-item-with-objective-image"), purpose: "CREATE-QUIZ-ITEM-WITH-OBJECTIVE-IMAGE" },
    { method: "PUT", pattern: toRegex("/admin/quiz/quiz-item-with-objective-image"), purpose: "UPDATE-QUIZ-ITEM-WITH-OBJECTIVE-IMAGE" },
    { method: "PUT", pattern: toRegex("/admin/quiz/quiz-item-with-objective-image/v2"), purpose: "UPDATE-QUIZ-ITEM-WITH-OBJECTIVE-IMAGE-V2" },
    { method: "PUT", pattern: toRegex("/admin/quiz/quiz-item"), purpose: "UPDATE-QUIZ-ITEM" },
    { method: "PATCH", pattern: toRegex("/admin/quiz/quiz-item/thumbnail"), purpose: "UPDATE-QUIZ-ITEM-THUMBNAIL" },
    { method: "DELETE", pattern: toRegex("/admin/quiz/quiz-item"), purpose: "DELETE-QUIZ-ITEM" },
    { method: "PATCH", pattern: toRegex("/admin/quiz/course"), purpose: "UPDATE-QUIZ-COURSE" },
    { method: "PATCH", pattern: toRegex("/admin/quiz/course-to-many-quiz"), purpose: "UPDATE-QUIZ-COURSE-MANY" },
    { method: "DELETE", pattern: toRegex("/admin/quiz/course"), purpose: "DELETE-QUIZ-COURSE" },
    { method: "PATCH", pattern: toRegex("/admin/quiz/student"), purpose: "UPDATE-QUIZ-STUDENT" },
    { method: "DELETE", pattern: toRegex("/admin/quiz/student"), purpose: "DELETE-QUIZ-STUDENT" },
    { method: "GET", pattern: toRegex("/admin/quiz/by-student/:id"), purpose: "VIEW-ADMIN-QUIZ-BY-STUDENT" },
    { method: "PATCH", pattern: toRegex("/admin/quiz/quiz-item-answernotes/thumbnail"), purpose: "UPDATE-QUIZ-ANSWERNOTES-THUMBNAIL" },
    { method: "DELETE", pattern: toRegex("/admin/quiz/quiz-item-answernotes/thumbnail/:id"), purpose: "DELETE-QUIZ-ANSWERNOTES-THUMBNAIL" },
    { method: "GET", pattern: toRegex("/admin/quiz/by-course/:course/student/:studentId/v"), purpose: "VIEW-ADMIN-QUIZ-BY-COURSE-STUDENT" },
    { method: "GET", pattern: toRegex("/admin/quiz/quiz-response/all"), purpose: "VIEW-ADMIN-QUIZ-RESPONSES" },
    { method: "DELETE", pattern: toRegex("/admin/quiz/quiz_response/delete/:id"), purpose: "DELETE-QUIZ-RESPONSE" },
    { method: "GET", pattern: toRegex("/admin/quiz/quiz-response/leaderboard"), purpose: "VIEW-ADMIN-QUIZ-LEADERBOARD" },
    { method: "DELETE", pattern: toRegex("/admin/quiz/quiz-response/leaderboard/:quiz_id"), purpose: "DELETE-QUIZ-LEADERBOARD" },

    // V2 flashcard (user)
    { method: "GET", pattern: toRegex("/flashcard/user-with-flashcards"), purpose: "VIEW-FLASHCARD-WITH-USERS" },
    { method: "GET", pattern: toRegex("/flashcard/by-course/:courseId/student"), purpose: "VIEW-FLASHCARD-BY-COURSE-STUDENT" },
    { method: "GET", pattern: toRegex("/flashcard/by-student"), purpose: "VIEW-FLASHCARD-BY-STUDENT" },
    { method: "GET", pattern: toRegex("/flashcard/:id"), purpose: "VIEW-FLASHCARD" },
    { method: "POST", pattern: toRegex("/flashcard/:id/complete"), purpose: "COMPLETE-FLASHCARD" },
    { method: "POST", pattern: toRegex("/flashcard/:id/progress"), purpose: "UPDATE-FLASHCARD-PROGRESS" },
    { method: "GET", pattern: toRegex("/flashcard/:id/leaderboard"), purpose: "VIEW-FLASHCARD-LEADERBOARD" },

    // V2 admin flashcard
    { method: "GET", pattern: toRegex("/admin/flashcard/"), purpose: "VIEW-ADMIN-FLASHCARD-LIST" },
    { method: "GET", pattern: toRegex("/admin/flashcard/by_course/:courseId/old"), purpose: "VIEW-ADMIN-FLASHCARD-BY-COURSE-OLD" },
    { method: "POST", pattern: toRegex("/admin/flashcard/create"), purpose: "CREATE-FLASHCARD" },
    { method: "PATCH", pattern: toRegex("/admin/flashcard/thumbnail"), purpose: "UPDATE-FLASHCARD-THUMBNAIL" },
    { method: "POST", pattern: toRegex("/admin/flashcard/:id/add-item"), purpose: "ADD-FLASHCARD-ITEM" },
    { method: "PUT", pattern: toRegex("/admin/flashcard/:id/add-items"), purpose: "ADD-FLASHCARD-ITEMS" },
    { method: "PATCH", pattern: toRegex("/admin/flashcard/item/upload-image"), purpose: "UPLOAD-FLASHCARD-ITEM-IMAGE" },
    { method: "PATCH", pattern: toRegex("/admin/flashcard/:id/update"), purpose: "UPDATE-FLASHCARD" },
    { method: "DELETE", pattern: toRegex("/admin/flashcard/:id/delete"), purpose: "DELETE-FLASHCARD" },
    { method: "PUT", pattern: toRegex("/admin/flashcard/:flashcardId/update-item"), purpose: "UPDATE-FLASHCARD-ITEM" },
    { method: "DELETE", pattern: toRegex("/admin/flashcard/:flashcardId"), purpose: "DELETE-FLASHCARD-BY-ID" },
    { method: "PUT", pattern: toRegex("/admin/flashcard/:id/link"), purpose: "LINK-FLASHCARD" },
    { method: "PUT", pattern: toRegex("/admin/flashcard/:id/unlink"), purpose: "UNLINK-FLASHCARD" },
    { method: "GET", pattern: toRegex("/admin/flashcard/:id/leaderboard/complete"), purpose: "VIEW-FLASHCARD-COMPLETE-LEADERBOARD" },
    { method: "DELETE", pattern: toRegex("/admin/flashcard/:id/leaderboard/reset"), purpose: "RESET-FLASHCARD-LEADERBOARD" },

    // V2 msl-ai
    { method: "POST", pattern: toRegex("/msl-ai/query-general-stream"), purpose: "QUERY-MSL-AI-STREAM" },
    { method: "POST", pattern: toRegex("/msl-ai/query-general"), purpose: "QUERY-MSL-AI" },
    { method: "GET", pattern: toRegex("/admin/msl-ai/list-pdfs"), purpose: "VIEW-MSL-AI-PDFS" },
    { method: "GET", pattern: toRegex("/admin/msl-ai/process-pdfs"), purpose: "PROCESS-MSL-AI-PDFS" },
    { method: "GET", pattern: toRegex("/admin/msl-ai/process-new-pdfs"), purpose: "PROCESS-MSL-AI-NEW-PDFS" },
    { method: "POST", pattern: toRegex("/admin/msl-ai/upload-pdf"), purpose: "UPLOAD-MSL-AI-PDF" },
    { method: "POST", pattern: toRegex("/admin/msl-ai/upload-pdfs"), purpose: "UPLOAD-MSL-AI-PDFS" },
    { method: "DELETE", pattern: toRegex("/admin/msl-ai/delete-pdf/old"), purpose: "DELETE-MSL-AI-PDF-OLD" },
    { method: "POST", pattern: toRegex("/admin/msl-ai/query"), purpose: "QUERY-MSL-AI-ADMIN" },
    { method: "GET", pattern: toRegex("/admin/msl-ai/collection-info"), purpose: "VIEW-MSL-AI-COLLECTION" },
    { method: "DELETE", pattern: toRegex("/admin/msl-ai/collection"), purpose: "DELETE-MSL-AI-COLLECTION" },
    { method: "GET", pattern: toRegex("/admin/msl-ai/test-qdrant"), purpose: "TEST-QDRANT" },
    { method: "GET", pattern: toRegex("/admin/msl-ai/global-limits"), purpose: "VIEW-MSL-AI-GLOBAL-LIMITS" },
    { method: "PUT", pattern: toRegex("/admin/msl-ai/global-limits"), purpose: "UPDATE-MSL-AI-GLOBAL-LIMITS" },
    { method: "PUT", pattern: toRegex("/admin/msl-ai/student-limits"), purpose: "UPDATE-MSL-AI-STUDENT-LIMITS" },
    { method: "GET", pattern: toRegex("/admin/msl-ai/all-students-usage"), purpose: "VIEW-MSL-AI-STUDENTS-USAGE" },
    { method: "GET", pattern: toRegex("/admin/msl-ai/student-usage/:studentId"), purpose: "VIEW-MSL-AI-STUDENT-USAGE" },
    { method: "GET", pattern: toRegex("/admin/msl-ai/ai/history"), purpose: "VIEW-MSL-AI-HISTORY" },

    // V2 gemini-ai
    { method: "POST", pattern: toRegex("/gemini-ai/query-general-stream"), purpose: "QUERY-GEMINI-AI-STREAM" },
    { method: "POST", pattern: toRegex("/gemini-ai/query-general"), purpose: "QUERY-GEMINI-AI" },
    { method: "GET", pattern: toRegex("/admin/gemini-ai/list-pdfs"), purpose: "VIEW-GEMINI-AI-PDFS" },
    { method: "GET", pattern: toRegex("/admin/gemini-ai/process-pdfs"), purpose: "PROCESS-GEMINI-AI-PDFS" },
    { method: "GET", pattern: toRegex("/admin/gemini-ai/process-new-pdfs"), purpose: "PROCESS-GEMINI-AI-NEW-PDFS" },
    { method: "POST", pattern: toRegex("/admin/gemini-ai/upload-pdf"), purpose: "UPLOAD-GEMINI-AI-PDF" },
    { method: "POST", pattern: toRegex("/admin/gemini-ai/upload-pdfs"), purpose: "UPLOAD-GEMINI-AI-PDFS" },
    { method: "DELETE", pattern: toRegex("/admin/gemini-ai/delete-pdf/old"), purpose: "DELETE-GEMINI-AI-PDF-OLD" },
    { method: "POST", pattern: toRegex("/admin/gemini-ai/query"), purpose: "QUERY-GEMINI-AI-ADMIN" },
    { method: "GET", pattern: toRegex("/admin/gemini-ai/collection-info"), purpose: "VIEW-GEMINI-AI-COLLECTION" },
    { method: "DELETE", pattern: toRegex("/admin/gemini-ai/collection"), purpose: "DELETE-GEMINI-AI-COLLECTION" },
    { method: "GET", pattern: toRegex("/admin/gemini-ai/test-qdrant"), purpose: "TEST-QDRANT" },
    { method: "GET", pattern: toRegex("/admin/gemini-ai/global-limits"), purpose: "VIEW-GEMINI-AI-GLOBAL-LIMITS" },
    { method: "PUT", pattern: toRegex("/admin/gemini-ai/global-limits"), purpose: "UPDATE-GEMINI-AI-GLOBAL-LIMITS" },
    { method: "PUT", pattern: toRegex("/admin/gemini-ai/student-limits"), purpose: "UPDATE-GEMINI-AI-STUDENT-LIMITS" },
    { method: "GET", pattern: toRegex("/admin/gemini-ai/all-students-usage"), purpose: "VIEW-GEMINI-AI-STUDENTS-USAGE" },
    { method: "GET", pattern: toRegex("/admin/gemini-ai/student-usage/:studentId"), purpose: "VIEW-GEMINI-AI-STUDENT-USAGE" },
    { method: "GET", pattern: toRegex("/admin/gemini-ai/ai/history"), purpose: "VIEW-GEMINI-AI-HISTORY" },
    { method: "POST", pattern: toRegex("/admin/gemini-ai/process-course-lessons-for-embedding"), purpose: "PROCESS-GEMINI-COURSE-LESSONS-EMBEDDING" },
    { method: "POST", pattern: toRegex("/admin/gemini-ai/process-all-courses-lessons-for-embedding"), purpose: "PROCESS-GEMINI-ALL-COURSES-LESSONS-EMBEDDING" },

    // V2 lesson
    { method: "PATCH", pattern: toRegex("/lesson/complete/:lessonId"), purpose: "COMPLETE-LESSON" },
    { method: "POST", pattern: toRegex("/admin/lesson/upload"), purpose: "UPLOAD-LESSON" },
    { method: "POST", pattern: toRegex("/admin/lesson/add-pdf"), purpose: "ADD-LESSON-PDF" },
    { method: "POST", pattern: toRegex("/admin/lesson/add-video"), purpose: "ADD-LESSON-VIDEO" },
    { method: "POST", pattern: toRegex("/admin/lesson/add-video-compress"), purpose: "ADD-LESSON-VIDEO-COMPRESS" },
    { method: "POST", pattern: toRegex("/admin/lesson/add-video-extra"), purpose: "ADD-LESSON-VIDEO-EXTRA" },
    { method: "POST", pattern: toRegex("/admin/lesson/add-pdf-extra"), purpose: "ADD-LESSON-PDF-EXTRA" },
    { method: "POST", pattern: toRegex("/admin/lesson/add"), purpose: "ADD-LESSON" },
    { method: "POST", pattern: toRegex("/admin/lesson/add-lesson"), purpose: "ADD-LESSON-DETAIL" },
    { method: "POST", pattern: toRegex("/admin/lesson/link-to-course"), purpose: "LINK-LESSON-COURSE" },
    { method: "PATCH", pattern: toRegex("/admin/lesson/unlink-from-course"), purpose: "UNLINK-LESSON-COURSE" },
    { method: "GET", pattern: toRegex("/admin/lesson/public-lessons"), purpose: "VIEW-PUBLIC-LESSONS" },
    { method: "PATCH", pattern: toRegex("/admin/lesson/bulk/update"), purpose: "UPDATE-LESSON-BULK" },
    { method: "POST", pattern: toRegex("/admin/lesson/add-resource"), purpose: "ADD-LESSON-RESOURCE" },
    { method: "DELETE", pattern: toRegex("/admin/lesson/resource/:id"), purpose: "DELETE-LESSON-RESOURCE" },
    { method: "DELETE", pattern: toRegex("/admin/lesson/delete-pdf"), purpose: "DELETE-LESSON-PDF" },
    { method: "DELETE", pattern: toRegex("/admin/lesson/delete-video"), purpose: "DELETE-LESSON-VIDEO" },
    { method: "DELETE", pattern: toRegex("/admin/lesson/delete-video-compressed"), purpose: "DELETE-LESSON-VIDEO-COMPRESSED" },
    { method: "PATCH", pattern: toRegex("/admin/lesson/update"), purpose: "UPDATE-LESSON" },
    { method: "DELETE", pattern: toRegex("/admin/lesson/:id"), purpose: "DELETE-LESSON" },
    { method: "GET", pattern: toRegex("/admin/lesson/:id"), purpose: "VIEW-LESSON" },
    { method: "POST", pattern: toRegex("/admin/lesson/upload-video"), purpose: "UPLOAD-LESSON-VIDEO" },
    { method: "POST", pattern: toRegex("/admin/lesson/upload-file"), purpose: "UPLOAD-LESSON-FILE" },
    { method: "GET", pattern: toRegex("/admin/lesson/s3/resource"), purpose: "VIEW-LESSON-S3-RESOURCE" },

    // V2 system
    { method: "GET", pattern: toRegex("/system/"), purpose: "VIEW-SYSTEM" },
    { method: "GET", pattern: toRegex("/system/update-available"), purpose: "VIEW-SYSTEM-UPDATE" },
    { method: "POST", pattern: toRegex("/system/add"), purpose: "CREATE-SYSTEM" },
    { method: "PATCH", pattern: toRegex("/system/update"), purpose: "UPDATE-SYSTEM" },

    // V2 enrolment
    { method: "POST", pattern: toRegex("/admin/enrolment/"), purpose: "CREATE-ENROLMENT" },
    { method: "DELETE", pattern: toRegex("/admin/enrolment/:id"), purpose: "DELETE-ENROLMENT" },
    { method: "DELETE", pattern: toRegex("/admin/enrolment/delete-many"), purpose: "DELETE-ENROLMENT-MANY" },
    { method: "PATCH", pattern: toRegex("/admin/enrolment/deactivate-one"), purpose: "DEACTIVATE-ENROLMENT" },
    { method: "PUT", pattern: toRegex("/admin/enrolment/deactivate-many"), purpose: "DEACTIVATE-ENROLMENT-MANY" },
    { method: "PATCH", pattern: toRegex("/admin/enrolment/"), purpose: "UPDATE-ENROLMENT" },
    { method: "POST", pattern: toRegex("/admin/enrolment/add-many"), purpose: "CREATE-ENROLMENT-MANY" },
    { method: "POST", pattern: toRegex("/admin/enrolment/add-csv"), purpose: "CREATE-ENROLMENT-CSV" },
    { method: "GET", pattern: toRegex("/admin/enrolment/by-course/:id"), purpose: "VIEW-ENROLMENT-BY-COURSE" },
    { method: "GET", pattern: toRegex("/admin/enrolment/by-user/:email"), purpose: "VIEW-ENROLMENT-BY-USER" },
    { method: "POST", pattern: toRegex("/admin/enrolment/enroll-user-to-many-courses"), purpose: "ENROLL-USER-MANY-COURSES" },
    { method: "DELETE", pattern: toRegex("/admin/enrolment/unenroll-user-from-many-courses"), purpose: "UNENROLL-USER-MANY-COURSES" },
  ];

  const matched = rules.find(
    (rule) => rule.method === normalizedMethod && rule.pattern.test(path)
  );

  return matched?.purpose;
};

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const start = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const currentUser = req["currentUser"] as
      | {
          id?: string;
          firstname?: string;
          lastname?: string;
          email?: string;
          role?: string;
        }
      | undefined;

    const purpose = getPurpose(req.method, req.originalUrl || req.url);
    if (!purpose) {
      return;
    }

    const logData = {
      userId: currentUser?.id,
      firstname: currentUser?.firstname,
      lastname: currentUser?.lastname,
      email: currentUser?.email,
      role: currentUser?.role,
      method: req.method,
      endpoint: req.originalUrl || req.url,
      purpose,
      statusCode: res.statusCode,
      success: res.statusCode < 400,
      durationMs,
      ip: req.ip,
      userAgent: req.get("user-agent"),
      query: req.query,
      params: req.params,
    };

    setImmediate(() => {
      RequestLog.create(logData).catch(() => {});
    });
  });

  next();
};
