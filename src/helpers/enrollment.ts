import Enrolled from "../Features/course/schema/enroll.schema";

export const countActiveCourseEnrollments = async (
  email: string
): Promise<number> => {
  const counted = (await Enrolled.aggregate([
    { $match: { email, status: "ACTIVE" } },
    {
      $lookup: {
        from: "courses",
        localField: "course",
        foreignField: "_id",
        as: "courseDoc",
      },
    },
    { $unwind: "$courseDoc" },
    {
      $match: {
        "courseDoc.status": "ACTIVE",
        "courseDoc.archived": { $ne: true },
      },
    },
    { $count: "total" },
  ])) as { total?: number }[];

  return counted[0]?.total ?? 0;
};

export const getActiveEnrolledCourseIds = async (
  email: string
): Promise<string[]> => {
  const rows = (await Enrolled.aggregate([
    { $match: { email, status: "ACTIVE" } },
    {
      $lookup: {
        from: "courses",
        localField: "course",
        foreignField: "_id",
        as: "courseDoc",
      },
    },
    { $unwind: "$courseDoc" },
    {
      $match: {
        "courseDoc.status": "ACTIVE",
        "courseDoc.archived": { $ne: true },
      },
    },
    {
      $project: {
        courseId: { $toString: "$course" },
      },
    },
  ])) as { courseId?: string }[];

  return rows.map((row) => String(row.courseId || "")).filter(Boolean);
};
