import mongoose from "mongoose";
import * as dotenv from "dotenv";

dotenv.config();

const OLD_COURSE_ID = "69fdf3a6f3c53d7d19a3dc5c";
const NEW_COURSE_ID = "69ab1373ab6ca43df6b10e77";

const updateCourseLinkedCourses = async (
  oldId: mongoose.Types.ObjectId,
  newId: mongoose.Types.ObjectId,
  session: mongoose.ClientSession
) => {
  const result = await mongoose.connection.db
    .collection("courses")
    .updateMany(
      { "linkedCourses.course": oldId },
      { $set: { "linkedCourses.$[item].course": newId } },
      { arrayFilters: [{ "item.course": oldId }], session }
    );

  return result.modifiedCount;
};

const changeCourseId = async () => {
  if (!process.env.DB_URL) {
    throw new Error("DB_URL is not set.");
  }

  if (
    !mongoose.Types.ObjectId.isValid(OLD_COURSE_ID) ||
    !mongoose.Types.ObjectId.isValid(NEW_COURSE_ID)
  ) {
    throw new Error("One or both Course ids are invalid MongoDB ObjectIds.");
  }

  const oldId = new mongoose.Types.ObjectId(OLD_COURSE_ID);
  const newId = new mongoose.Types.ObjectId(NEW_COURSE_ID);

  await mongoose.connect(process.env.DB_URL, {
    sanitizeFilter: true,
    autoCreate: false,
  });

  const session = await mongoose.startSession();

  try {
    let linkedCoursesModified = 0;

    await session.withTransaction(async () => {
      const courses = mongoose.connection.db.collection("courses");
      const existingCourse = await courses.findOne({ _id: oldId }, { session });

      if (!existingCourse) {
        throw new Error(`Course ${OLD_COURSE_ID} was not found.`);
      }

      const replacementCourse = await courses.findOne({ _id: newId }, { session });

      if (replacementCourse) {
        throw new Error(`Course ${NEW_COURSE_ID} already exists.`);
      }

      const { _id, ...courseWithoutId } = existingCourse;
      await courses.insertOne({ ...courseWithoutId, _id: newId }, { session });

      linkedCoursesModified = await updateCourseLinkedCourses(oldId, newId, session);

      const deleteResult = await courses.deleteOne({ _id: oldId }, { session });

      if (deleteResult.deletedCount !== 1) {
        throw new Error(`Failed to delete old Course ${OLD_COURSE_ID}.`);
      }
    });

    console.log(`Changed Course _id from ${OLD_COURSE_ID} to ${NEW_COURSE_ID}.`);
    console.log(`Updated ${linkedCoursesModified} Course linkedCourses reference(s).`);
  } finally {
    await session.endSession();
    await mongoose.disconnect();
  }
};

changeCourseId().catch((error) => {
  console.error("Failed to change Course _id:", error);
  process.exit(1);
});
