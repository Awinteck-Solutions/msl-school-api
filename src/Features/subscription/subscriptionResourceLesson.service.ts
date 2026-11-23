import mongoose from "mongoose";
import * as path from "path";
import { sanitizeVideoTimestamps } from "../../helpers/videoTimestamps";
import Category from "../category/schema/category.schema";
import Course from "../course/schema/course.schema";
import Lesson from "../lesson/schema/lesson.schema";
import {
  SubscriptionContentStatus,
  SubscriptionResourceFileStatus,
  SubscriptionResourceType,
} from "./enums/subscription.enum";
import SubscriptionResource from "./schema/subscriptionResource.schema";
import SubscriptionResourceFile from "./schema/subscriptionResourceFile.schema";
import SubscriptionResourceLesson from "./schema/subscriptionResourceLesson.schema";

export const SUBSCRIPTION_LESSON_VIDEO_KEYS = [
  "video",
  "video1",
  "video2",
  "video3",
  "video4",
  "video5",
  "video6",
  "video7",
  "video8",
  "video9",
  "video10",
] as const;

export const SUBSCRIPTION_LESSON_PDF_KEYS = [
  "pdf",
  "pdf1",
  "pdf2",
  "pdf3",
  "pdf4",
  "pdf5",
  "pdf6",
  "pdf7",
  "pdf8",
  "pdf9",
  "pdf10",
] as const;

export type SubscriptionLessonMediaKey =
  | (typeof SUBSCRIPTION_LESSON_VIDEO_KEYS)[number]
  | (typeof SUBSCRIPTION_LESSON_PDF_KEYS)[number];

export function subscriptionS3KeyOwnedByResource(fileKey?: string | null): boolean {
  if (!fileKey) return false;
  const key = fileKey.trim();
  if (!key || /^https?:\/\//i.test(key)) return false;
  return key.startsWith("subscription-ai/");
}

export function inferSubscriptionFileType(
  fileKey: string,
  slot?: string
): SubscriptionResourceType {
  const ext = path.extname(fileKey).toLowerCase();
  if (ext === ".pdf" || slot?.startsWith("pdf")) {
    return SubscriptionResourceType.PDF;
  }
  return SubscriptionResourceType.VIDEO;
}

export function collectLessonMediaSlots(
  lesson: Record<string, unknown>
): Array<{ slot: SubscriptionLessonMediaKey; fileKey: string }> {
  const out: Array<{ slot: SubscriptionLessonMediaKey; fileKey: string }> = [];
  const keys = [
    ...SUBSCRIPTION_LESSON_VIDEO_KEYS,
    ...SUBSCRIPTION_LESSON_PDF_KEYS,
  ];
  for (const slot of keys) {
    const value = lesson[slot];
    if (typeof value === "string" && value.trim()) {
      out.push({ slot, fileKey: value.trim() });
    }
  }
  return out;
}

function fileNameFromKey(fileKey: string, slot: string) {
  const base = path.basename(fileKey.split("?")[0]) || slot;
  return base;
}

export async function syncSubscriptionFilesFromLesson(
  lessonId: mongoose.Types.ObjectId | string,
  options: { sharedS3Key?: boolean } = {}
) {
  const lesson = await SubscriptionResourceLesson.findById(lessonId).lean();
  if (!lesson) return { synced: 0 };
  const resourceId = lesson.resource;
  const shared = Boolean(options.sharedS3Key);
  const slots = collectLessonMediaSlots(lesson as Record<string, unknown>);
  const activeKeys = new Set(slots.map((s) => s.fileKey));

  const existing = await SubscriptionResourceFile.find({
    lesson: lessonId,
  });
  for (const row of existing) {
    if (!activeKeys.has(row.fileKey)) {
      await SubscriptionResourceFile.deleteOne({ _id: row._id });
    }
  }

  let synced = 0;
  for (const { slot, fileKey } of slots) {
    const fileType = inferSubscriptionFileType(fileKey, slot);
    await SubscriptionResourceFile.findOneAndUpdate(
      { resource: resourceId, fileKey },
      {
        $set: {
          resource: resourceId,
          lesson: lessonId,
          fileKey,
          fileName: fileNameFromKey(fileKey, slot),
          fileType,
          sharedS3Key: shared,
          status: SubscriptionResourceFileStatus.PENDING,
        },
        $setOnInsert: {
          uploadedBy: shared ? "course-clone" : "lesson",
        },
      },
      { upsert: true, new: true }
    );
    synced += 1;
  }
  return { synced };
}

export async function syncAllSubscriptionFilesForResource(resourceId: string) {
  const lessons = await SubscriptionResourceLesson.find({ resource: resourceId })
    .sort({ position: 1 })
    .lean();
  let total = 0;
  for (const lesson of lessons) {
    const shared = Boolean(lesson.sourceLessonId);
    const result = await syncSubscriptionFilesFromLesson(String(lesson._id), {
      sharedS3Key: shared,
    });
    total += result.synced;
  }
  return { synced: total };
}

export async function listLessonsForResources(resourceIds: string[]) {
  if (!resourceIds.length) return new Map<string, any[]>();
  const lessons = await SubscriptionResourceLesson.find({
    resource: { $in: resourceIds },
    status: "ACTIVE",
  })
    .sort({ position: 1 })
    .lean();
  const map = new Map<string, any[]>();
  for (const lesson of lessons) {
    const key = String(lesson.resource);
    const list = map.get(key) || [];
    list.push(lesson);
    map.set(key, list);
  }
  return map;
}

export async function migrateFlatFilesToLessonOne() {
  const resources = await SubscriptionResource.find({}).select("_id title").lean();
  let resourcesMigrated = 0;
  let filesAttached = 0;

  for (const resource of resources) {
    const resourceId = String(resource._id);
    const lessonCount = await SubscriptionResourceLesson.countDocuments({
      resource: resourceId,
    });
    if (lessonCount > 0) continue;

    const flatFiles = await SubscriptionResourceFile.find({ resource: resourceId })
      .sort({ createdAt: 1 })
      .lean();
    if (!flatFiles.length) continue;

    const lesson = await SubscriptionResourceLesson.create({
      resource: resourceId,
      title: "Lesson 1",
      description: "Migrated from legacy flat files",
      position: 1,
      status: "ACTIVE",
    });

    let pdfIndex = 0;
    let videoIndex = 0;
    const update: Record<string, string> = {};

    for (const file of flatFiles) {
      const key = file.fileKey;
      if (!key) continue;
      const type = String(file.fileType || "").toUpperCase();
      if (type === "PDF") {
        const slot =
          pdfIndex === 0 ? "pdf" : (`pdf${pdfIndex}` as SubscriptionLessonMediaKey);
        if (pdfIndex <= 10) {
          update[slot] = key;
          pdfIndex += 1;
        }
      } else {
        const slot =
          videoIndex === 0
            ? "video"
            : (`video${videoIndex}` as SubscriptionLessonMediaKey);
        if (videoIndex <= 10) {
          update[slot] = key;
          videoIndex += 1;
        }
      }
      await SubscriptionResourceFile.updateOne(
        { _id: file._id },
        { $set: { lesson: lesson._id, sharedS3Key: !subscriptionS3KeyOwnedByResource(key) } }
      );
      filesAttached += 1;
    }

    if (Object.keys(update).length) {
      await SubscriptionResourceLesson.updateOne({ _id: lesson._id }, { $set: update });
    }
    resourcesMigrated += 1;
  }

  return { resourcesMigrated, filesAttached };
}

const RESOURCE_STATUSES = new Set(Object.values(SubscriptionContentStatus));

export function normalizeResourceStatus(status?: string | null) {
  const value = String(status || "").trim();
  return RESOURCE_STATUSES.has(value as SubscriptionContentStatus)
    ? value
    : SubscriptionContentStatus.ACTIVE;
}

export async function resourceCategoryFields(categoryId?: string | null) {
  if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
    return { category: null as string | null, categoryId: null as string | null };
  }
  const row = await Category.findById(categoryId).select("name").lean();
  return {
    category: (row as { name?: string } | null)?.name || null,
    categoryId,
  };
}

const LESSON_MEDIA_KEYS = [
  ...SUBSCRIPTION_LESSON_VIDEO_KEYS,
  ...SUBSCRIPTION_LESSON_PDF_KEYS,
];

/** Lesson payload aligned with a course lesson, without linked courses. */
export function serializeSubscriptionLesson(lesson: Record<string, any>) {
  const media: Record<string, string | null> = {};
  for (const key of LESSON_MEDIA_KEYS) {
    const value = lesson[key];
    media[key] = typeof value === "string" && value.trim() ? value.trim() : null;
  }
  return {
    _id: lesson._id,
    resource: lesson.resource,
    title: lesson.title,
    description: lesson.description ?? null,
    position: lesson.position,
    public: Boolean(lesson.public),
    ...media,
    status: lesson.status || "ACTIVE",
    author: lesson.author || lesson.authorId || null,
    videoTimestamps: Array.isArray(lesson.videoTimestamps) ? lesson.videoTimestamps : [],
    createdAt: lesson.createdAt,
    updatedAt: lesson.updatedAt,
  };
}

/** Resource payload aligned with a course, without link, price, students, or linked courses. */
export function serializeSubscriptionResource(
  resource: Record<string, any>,
  extras: { lessons?: any[]; files?: any[] } = {}
) {
  const lessons = (extras.lessons ?? resource.lessons ?? []).map(serializeSubscriptionLesson);
  const payload: Record<string, unknown> = {
    _id: resource._id,
    title: resource.title,
    description: resource.description ?? null,
    thumbnail: resource.thumbnail ?? null,
    category: resource.category ?? null,
    categoryId: resource.categoryId ?? null,
    archived: Boolean(resource.archived),
    status: resource.status || SubscriptionContentStatus.ACTIVE,
    author: resource.author || resource.authorId || null,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
    lessons,
  };
  if (extras.files || resource.files) {
    payload.files = extras.files ?? resource.files;
  }
  return payload;
}

const pickLessonMediaFields = (source: Record<string, unknown>) => {
  const payload: Record<string, string | null> = {};
  for (const key of [
    ...SUBSCRIPTION_LESSON_VIDEO_KEYS,
    ...SUBSCRIPTION_LESSON_PDF_KEYS,
  ]) {
    const val = source[key];
    payload[key] = typeof val === "string" && val.trim() ? val.trim() : null;
  }
  return payload;
};

/** Same lesson set and order the course player uses. */
async function lessonsInCourseOrder(courseId: string) {
  const courseOid = new mongoose.Types.ObjectId(courseId);
  const lessons = await Lesson.find({
    status: "ACTIVE",
    $or: [{ course: courseOid }, { "linkedCourses.course": courseOid }],
  }).lean();

  const rank = (lesson: {
    position?: number;
    linkedCourses?: Array<{ course?: unknown; position?: number }>;
  }) => {
    const link = (lesson.linkedCourses || []).find(
      (entry) => String(entry.course) === courseId
    );
    if (link && typeof link.position === "number") return link.position;
    return typeof lesson.position === "number" ? lesson.position : 0;
  };

  const seen = new Set<string>();
  return lessons
    .filter((lesson) => {
      const id = String(lesson._id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => rank(a) - rank(b) || String(a.title || "").localeCompare(String(b.title || "")));
}

export async function cloneCourseToSubscriptionResource(opts: {
  courseId: string;
  title?: string;
  description?: string;
  categoryId?: string;
  authorId?: string;
}) {
  const { courseId } = opts;
  if (!mongoose.Types.ObjectId.isValid(courseId)) {
    throw new Error("Invalid course id");
  }
  const course = await Course.findById(courseId).lean();
  if (!course) throw new Error("Course not found");

  const courseLessons = await lessonsInCourseOrder(courseId);

  const source = course as {
    title?: string;
    description?: string;
    thumbnail?: string;
    category?: string;
    categoryId?: string;
    archived?: boolean;
    status?: string;
    author?: string;
  };
  const categoryFields = opts.categoryId
    ? await resourceCategoryFields(opts.categoryId)
    : {
        category: source.category ?? null,
        categoryId: source.categoryId,
      };
  const resource = await SubscriptionResource.create({
    title: opts.title?.trim() || source.title || "Cloned course",
    description: opts.description ?? source.description ?? null,
    thumbnail: source.thumbnail ?? null,
    category: categoryFields.category,
    categoryId: categoryFields.categoryId,
    archived: Boolean(source.archived),
    status: normalizeResourceStatus(source.status),
    author: opts.authorId || source.author,
  });

  const resourceId = String(resource._id);
  let lessonCount = 0;

  for (const [index, src] of courseLessons.entries()) {
    const media = pickLessonMediaFields(src as Record<string, unknown>);
    const created = await SubscriptionResourceLesson.create({
      resource: resourceId,
      title: src.title,
      description: src.description,
      position: index + 1,
      public: Boolean((src as { public?: boolean }).public),
      status: "ACTIVE",
      author: (src as { author?: string }).author || opts.authorId,
      sourceCourseId: courseId,
      sourceLessonId: src._id,
      videoTimestamps: sanitizeVideoTimestamps(
        (src as { videoTimestamps?: unknown }).videoTimestamps
      ) || [],
      ...media,
    });
    await syncSubscriptionFilesFromLesson(String(created._id), { sharedS3Key: true });
    lessonCount += 1;
  }

  return { resource, lessonCount };
}

export async function hydrateSubscriptionResources(items: any[]) {
  if (!items.length) return [];
  const resourceIds = items.map((item) => String(item._id));
  const [lessons, files] = await Promise.all([
    SubscriptionResourceLesson.find({ resource: { $in: resourceIds } })
      .sort({ position: 1 })
      .lean(),
    SubscriptionResourceFile.find({ resource: { $in: resourceIds } })
      .sort({ createdAt: -1 })
      .lean(),
  ]);
  const lessonsByResource = new Map<string, any[]>();
  for (const lesson of lessons) {
    const key = String(lesson.resource);
    const list = lessonsByResource.get(key) || [];
    list.push(lesson);
    lessonsByResource.set(key, list);
  }
  const filesByResource = new Map<string, any[]>();
  for (const file of files) {
    const key = String(file.resource);
    const list = filesByResource.get(key) || [];
    list.push(file);
    filesByResource.set(key, list);
  }
  return items.map((item) =>
    serializeSubscriptionResource(item, {
      lessons: lessonsByResource.get(String(item._id)) || [],
      files: filesByResource.get(String(item._id)) || [],
    })
  );
}

export async function assignFlatFileToLessonSlot(
  resourceId: string,
  fileKey: string,
  fileType: SubscriptionResourceType
) {
  const kind = fileType === SubscriptionResourceType.PDF ? "pdf" : "video";
  const keys =
    kind === "pdf" ? SUBSCRIPTION_LESSON_PDF_KEYS : SUBSCRIPTION_LESSON_VIDEO_KEYS;
  const lessons = await SubscriptionResourceLesson.find({ resource: resourceId }).sort({
    position: 1,
  });
  const hasRoom = (item: { toObject: () => Record<string, unknown> }) => {
    const obj = item.toObject();
    return keys.some((key) => {
      const value = obj[key];
      return !value || (typeof value === "string" && !value.trim());
    });
  };
  let lesson = lessons.find((item) => hasRoom(item));
  if (!lesson) {
    const position = (lessons[lessons.length - 1]?.position || 0) + 1;
    lesson = await SubscriptionResourceLesson.create({
      resource: resourceId,
      title: `Lesson ${position}`,
      position,
      status: "ACTIVE",
    });
  }
  const lessonObj = lesson.toObject() as Record<string, unknown>;
  let slot: string | null = null;
  for (const key of keys) {
    const val = lessonObj[key];
    if (!val || (typeof val === "string" && !val.trim())) {
      slot = key;
      break;
    }
  }
  if (!slot) return null;
  lesson.set(slot, fileKey);
  await lesson.save();
  await SubscriptionResourceFile.updateMany(
    { resource: resourceId, fileKey },
    { $set: { lesson: lesson._id, sharedS3Key: false } }
  );
  await syncSubscriptionFilesFromLesson(String(lesson._id), { sharedS3Key: false });
  return { lessonId: lesson._id, slot };
}

export function subscriptionFileKeysSafeToDeleteFromS3(
  files: Array<{ fileKey?: string; sharedS3Key?: boolean }>,
  resourceThumbnail?: string | null
): string[] {
  const keys: string[] = [];
  if (resourceThumbnail && subscriptionS3KeyOwnedByResource(resourceThumbnail)) {
    keys.push(resourceThumbnail);
  }
  for (const file of files) {
    if (file.sharedS3Key) continue;
    if (!subscriptionS3KeyOwnedByResource(file.fileKey)) continue;
    if (file.fileKey) keys.push(file.fileKey);
  }
  return keys;
}