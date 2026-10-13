/**
 * Compares optimized allStudentsUsage responses with the previous implementation
 * and checks index use on a representative AiUsage volume.
 *
 * Run: npm run test:all-students-usage
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { AdminGeminiAiV2Controller } from "../src/Features/geminiAi/controllers/admin.geminiAi.v2.controller";
import User from "../src/Features/user/schema/user.schema";
import AiUsage from "../src/Features/mslAi/schema/aiUsage.schema";
import GlobalAiLimit from "../src/Features/mslAi/schema/globalAiLimit.schema";

type Query = Record<string, string | undefined>;

const usageBounds = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endOfMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  );
  const previousMonth = new Date(startOfMonth);
  previousMonth.setDate(previousMonth.getDate() - 3);
  return { today, tomorrow, startOfMonth, endOfMonth, previousMonth };
};

const invokeOptimized = (query: Query) =>
  new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = { query };
    let statusCode = 200;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: any) {
        resolve({ status: statusCode, body });
        return this;
      },
    };

    Promise.resolve(
      AdminGeminiAiV2Controller.allStudentsUsage(req as any, res as any)
    ).catch(reject);
  });

/** Previous controller behavior, kept here as the equivalence oracle. */
const invokeOriginal = async (query: Query) => {
  const page = parseInt(query.page as string) || 1;
  const limit = parseInt(query.limit as string) || 50;
  const search = query.search || "";
  const skip = (page - 1) * limit;

  if (page < 1) {
    return {
      status: 400,
      body: { success: false, message: "Page number must be greater than 0" },
    };
  }

  let globalLimits = await GlobalAiLimit.findOne({});
  if (!globalLimits) {
    globalLimits = { dailyLimit: 10, monthlyLimit: 100 } as any;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endOfMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  );

  const monthlyUsageAgg = await AiUsage.aggregate([
    { $match: { createdAt: { $gte: startOfMonth, $lte: endOfMonth } } },
    { $group: { _id: "$student", count: { $sum: 1 } } },
  ]);
  const studentIdsWithUsage = monthlyUsageAgg.map((item) => item._id);

  if (studentIdsWithUsage.length === 0) {
    return {
      status: 200,
      body: {
        success: true,
        message: "No students used AI this month",
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false,
        },
        data: [],
        summary: {
          globalLimits,
          totalStudents: 0,
          studentsWithCustomLimits: 0,
          studentsUsingGlobalLimits: 0,
        },
      },
    };
  }

  const userQuery: Record<string, any> = { _id: { $in: studentIdsWithUsage } };
  if (search) {
    userQuery.$or = [
      { email: { $regex: search, $options: "i" } },
      { firstname: { $regex: search, $options: "i" } },
      { lastname: { $regex: search, $options: "i" } },
      {
        $expr: {
          $regexMatch: {
            input: { $concat: ["$firstname", " ", "$lastname"] },
            regex: search,
            options: "i",
          },
        },
      },
    ];
  }

  const totalUsers = await User.countDocuments(userQuery);
  const users = await User.find(userQuery)
    .select("_id email firstname lastname image ai_limit createdAt")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  const userIds = users.map((user: any) => user._id);

  const [dailyUsageAgg, monthlyUsageAggPage, totalUsageAgg] = await Promise.all([
    AiUsage.aggregate([
      {
        $match: {
          student: { $in: userIds },
          createdAt: { $gte: today, $lt: tomorrow },
        },
      },
      { $group: { _id: "$student", count: { $sum: 1 } } },
    ]),
    AiUsage.aggregate([
      {
        $match: {
          student: { $in: userIds },
          createdAt: { $gte: startOfMonth, $lte: endOfMonth },
        },
      },
      { $group: { _id: "$student", count: { $sum: 1 } } },
    ]),
    AiUsage.aggregate([
      { $match: { student: { $in: userIds } } },
      { $group: { _id: "$student", count: { $sum: 1 } } },
    ]),
  ]);

  const dailyUsageMap: Record<string, number> = {};
  dailyUsageAgg.forEach((item) => {
    dailyUsageMap[item._id.toString()] = item.count;
  });
  const monthlyUsageMap: Record<string, number> = {};
  monthlyUsageAggPage.forEach((item) => {
    monthlyUsageMap[item._id.toString()] = item.count;
  });
  const totalUsageMap: Record<string, number> = {};
  totalUsageAgg.forEach((item) => {
    totalUsageMap[item._id.toString()] = item.count;
  });

  const studentsWithUsage = users.map((user: any) => {
    const dailyLimit = user.ai_limit?.dailyLimit || globalLimits.dailyLimit;
    const monthlyLimit = user.ai_limit?.monthlyLimit || globalLimits.monthlyLimit;
    const dailyUsage = dailyUsageMap[user._id.toString()] || 0;
    const monthlyUsage = monthlyUsageMap[user._id.toString()] || 0;
    const totalUsage = totalUsageMap[user._id.toString()] || 0;

    return {
      student: {
        id: user._id,
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        image: user.image,
        aiLimit: user.ai_limit,
        createdAt: user.createdAt,
      },
      usage: {
        daily: {
          used: dailyUsage,
          limit: dailyLimit,
          remaining: Math.max(0, dailyLimit - dailyUsage),
          percentage:
            dailyLimit > 0 ? Math.round((dailyUsage / dailyLimit) * 100) : 0,
        },
        monthly: {
          used: monthlyUsage,
          limit: monthlyLimit,
          remaining: Math.max(0, monthlyLimit - monthlyUsage),
          percentage:
            monthlyLimit > 0 ? Math.round((monthlyUsage / monthlyLimit) * 100) : 0,
        },
        total: totalUsage,
      },
      limits: {
        isUsingGlobalLimits:
          !user.ai_limit?.dailyLimit && !user.ai_limit?.monthlyLimit,
      },
    };
  });

  const totalPages = Math.ceil(totalUsers / limit);
  return {
    status: 200,
    body: {
      success: true,
      message: "All students AI usage retrieved successfully",
      pagination: {
        page,
        limit,
        total: totalUsers,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      data: studentsWithUsage,
      summary: {
        globalLimits,
        totalStudents: totalUsers,
        studentsWithCustomLimits: studentsWithUsage.filter(
          (student) => !student.limits.isUsingGlobalLimits
        ).length,
        studentsUsingGlobalLimits: studentsWithUsage.filter(
          (student) => student.limits.isUsingGlobalLimits
        ).length,
      },
    },
  };
};

const snapshot = (value: unknown) => JSON.parse(JSON.stringify(value));

const assertEqual = (actual: unknown, expected: unknown, label: string) => {
  const actualJson = JSON.stringify(snapshot(actual));
  const expectedJson = JSON.stringify(snapshot(expected));
  if (actualJson !== expectedJson) {
    throw new Error(
      `${label}\noptimized: ${actualJson.slice(0, 2500)}\noriginal: ${expectedJson.slice(0, 2500)}`
    );
  }
};

const assert = (condition: unknown, label: string) => {
  if (!condition) throw new Error(label);
};

const summarizeExplain = (explain: any) => {
  let docs = 0;
  let keys = 0;
  let millis = 0;
  const stages: string[] = [];

  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.totalDocsExamined === "number") {
      docs = Math.max(docs, node.totalDocsExamined);
    }
    if (typeof node.totalKeysExamined === "number") {
      keys = Math.max(keys, node.totalKeysExamined);
    }
    if (typeof node.executionTimeMillis === "number") {
      millis = Math.max(millis, node.executionTimeMillis);
    }
    if (typeof node.stage === "string") {
      stages.push(node.indexName ? `${node.stage}:${node.indexName}` : node.stage);
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") visit(value);
    }
  };

  visit(explain);
  return { docs, keys, millis, stages };
};

const compare = async (query: Query, label: string) => {
  const [optimized, original] = await Promise.all([
    invokeOptimized(query),
    invokeOriginal(query),
  ]);
  assertEqual(optimized.status, original.status, `${label} status`);
  assertEqual(optimized.body, original.body, `${label} body`);
  return optimized;
};

const resetCollections = async () => {
  await Promise.all([
    User.deleteMany({}),
    AiUsage.deleteMany({}),
    GlobalAiLimit.deleteMany({}),
  ]);
};

const insertUsage = async (
  rows: Array<{ student: mongoose.Types.ObjectId; createdAt: Date; question?: string }>
) => {
  if (rows.length === 0) return;
  await AiUsage.collection.insertMany(
    rows.map((row) => ({
      student: row.student,
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
      question: row.question || "question",
      answer: "answer",
      source: "course",
    }))
  );
};

const run = async () => {
  const memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri());
  await Promise.all([AiUsage.createIndexes(), User.createIndexes()]);

  try {
    const bounds = usageBounds();
    const earlierThisMonth = new Date(bounds.startOfMonth);
    if (bounds.today.getTime() !== bounds.startOfMonth.getTime()) {
      earlierThisMonth.setHours(12, 0, 0, 0);
    }

    await compare({}, "empty month without limits");
    await compare({ search: "ada" }, "empty month with search");
    await compare({ page: "4" }, "empty month later page");

    const globalLimits = await GlobalAiLimit.create({
      dailyLimit: 10,
      monthlyLimit: 100,
      description: "Global AI query limits for all users",
      isActive: true,
      updatedBy: "system",
    });

    const baseCreatedAt = bounds.today.getTime() - 86_400_000;
    const students = await User.create(
      [
        {
          email: "ada@school.test",
          firstname: "Ada",
          lastname: "Lovelace",
          image: "ada.png",
          otp: "111111",
          ai_limit: { dailyLimit: 2, monthlyLimit: 20, isActive: true },
          createdAt: new Date(baseCreatedAt + 80_000),
        },
        {
          email: "grace@school.test",
          firstname: "Grace",
          lastname: "Hopper",
          image: null,
          otp: "222222",
          ai_limit: { dailyLimit: null, monthlyLimit: 4, isActive: true },
          createdAt: new Date(baseCreatedAt + 70_000),
        },
        {
          email: "alan@school.test",
          firstname: "Alan",
          lastname: "Turing",
          image: "alan.png",
          otp: "333333",
          createdAt: new Date(baseCreatedAt + 60_000),
        },
        {
          email: "mary.jane@school.test",
          firstname: "Mary",
          lastname: "Jane",
          image: null,
          otp: "444444",
          ai_limit: { dailyLimit: 1, monthlyLimit: null, isActive: true },
          createdAt: new Date(baseCreatedAt + 50_000),
        },
        {
          email: "linus@school.test",
          firstname: "Linus",
          lastname: "Torvalds",
          image: null,
          otp: "555555",
          ai_limit: { dailyLimit: 5, monthlyLimit: 8, isActive: true },
          createdAt: new Date(baseCreatedAt + 40_000),
        },
        {
          email: "past-only@school.test",
          firstname: "Past",
          lastname: "Only",
          image: null,
          otp: "666666",
          createdAt: new Date(baseCreatedAt + 30_000),
        },
        {
          email: "idle@school.test",
          firstname: "Idle",
          lastname: "Student",
          image: null,
          otp: "777777",
          createdAt: new Date(baseCreatedAt + 90_000),
        },
        {
          email: "zero@school.test",
          firstname: "Zero",
          lastname: "Limit",
          image: null,
          otp: "888888",
          ai_limit: { dailyLimit: 3, monthlyLimit: 3, isActive: true },
          createdAt: new Date(baseCreatedAt + 20_000),
        },
        {
          email: "katherine@school.test",
          firstname: "Katherine",
          lastname: "Johnson",
          image: "kj.png",
          otp: "999999",
          createdAt: new Date(baseCreatedAt + 10_000),
        },
        {
          email: "edsger@school.test",
          firstname: "Edsger",
          lastname: "Dijkstra",
          image: null,
          otp: "101010",
          createdAt: new Date(baseCreatedAt),
        },
      ].map((user) => ({ ...user, password: "secret" }))
    );

    await User.collection.updateOne(
      { email: "zero@school.test" },
      { $set: { "ai_limit.dailyLimit": 0, "ai_limit.monthlyLimit": 0 } }
    );
    await User.collection.updateOne(
      { email: "linus@school.test" },
      { $set: { "ai_limit.monthlyLimit": 0 } }
    );

    const byEmail = new Map(students.map((student) => [student.email, student]));
    const idOf = (email: string) => byEmail.get(email)!._id;
    const now = new Date();
    const historical = new Date(bounds.previousMonth);
    historical.setHours(15, 0, 0, 0);

    const usageRows: Array<{ student: mongoose.Types.ObjectId; createdAt: Date }> = [];
    const add = (email: string, createdAt: Date, count: number) => {
      for (let index = 0; index < count; index += 1) {
        usageRows.push({
          student: idOf(email),
          createdAt: new Date(createdAt.getTime() + index),
        });
      }
    };

    add("ada@school.test", now, 3);
    add("ada@school.test", earlierThisMonth, bounds.today.getDate() === 1 ? 0 : 2);
    add("ada@school.test", historical, 10);
    add("grace@school.test", earlierThisMonth, 1);
    add("alan@school.test", now, 4);
    add("alan@school.test", historical, 6);
    add("mary.jane@school.test", now, 2);
    add("linus@school.test", now, 1);
    add("past-only@school.test", historical, 8);
    add("zero@school.test", now, 1);
    add("katherine@school.test", earlierThisMonth, 1);
    add("edsger@school.test", now, 1);
    await insertUsage(usageRows);

    const orphanId = new mongoose.Types.ObjectId();
    await insertUsage([{ student: orphanId, createdAt: now }]);

    const queries: Array<[Query, string]> = [
      [{}, "default page"],
      [{ page: "1", limit: "3" }, "page 1"],
      [{ page: "2", limit: "3" }, "page 2"],
      [{ page: "4", limit: "3" }, "page past content"],
      [{ page: "0" }, "page zero coerced to 1"],
      [{ page: "-2" }, "negative page"],
      [{ limit: "0" }, "limit zero coerced to 50"],
      [{ limit: "100" }, "limit 100"],
      [{ search: "ada@school.test" }, "email search"],
      [{ search: "GRACE" }, "firstname search"],
      [{ search: "turing" }, "lastname search"],
      [{ search: "Mary Jane" }, "full name search"],
      [{ search: "mary jane" }, "full name search lowercase"],
      [{ search: "nobody-matches" }, "search miss"],
      [{ search: "ada", page: "1", limit: "1" }, "search pagination"],
    ];

    for (const [query, label] of queries) {
      const result = await compare(query, label);
      if (result.status === 200 && result.body.message.includes("retrieved")) {
        for (const row of result.body.data) {
          assert(row.usage.daily.remaining >= 0, `${label} daily remaining`);
          assert(row.usage.monthly.remaining >= 0, `${label} monthly remaining`);
          assert(
            Object.keys(row.student).sort().join() ===
              "aiLimit,createdAt,email,firstname,id,image,lastname",
            `${label} student fields`
          );
          assert(
            Object.keys(row.usage).sort().join() === "daily,monthly,total",
            `${label} usage fields`
          );
        }
      }
    }

    const pageOne = await invokeOptimized({ limit: "50" });
    const returnedEmails = pageOne.body.data.map((row: any) => row.student.email);
    assert(!returnedEmails.includes("past-only@school.test"), "past-only student excluded");
    assert(!returnedEmails.includes("idle@school.test"), "idle student excluded");
    assert(
      !pageOne.body.data.some((row: any) => String(row.student.id) === String(orphanId)),
      "orphan usage excluded"
    );

    const ada = pageOne.body.data.find((row: any) => row.student.email === "ada@school.test");
    const adaMonthlyNotToday = bounds.today.getDate() === 1 ? 0 : 2;
    assert(ada.usage.daily.used === 3, "ada daily count");
    assert(ada.usage.monthly.used === 3 + adaMonthlyNotToday, "ada monthly count");
    assert(ada.usage.total === 13 + adaMonthlyNotToday, "ada lifetime count");
    assert(ada.usage.daily.limit === 2, "ada custom daily limit");
    assert(ada.usage.daily.remaining === 0, "ada remaining clamped");
    assert(ada.usage.daily.percentage === 150, "ada percentage");
    assert(ada.limits.isUsingGlobalLimits === false, "ada custom limits flag");

    const alan = pageOne.body.data.find((row: any) => row.student.email === "alan@school.test");
    assert(alan.usage.daily.limit === globalLimits.dailyLimit, "alan global daily fallback");
    assert(alan.usage.monthly.limit === globalLimits.monthlyLimit, "alan global monthly fallback");
    assert(alan.usage.total === 10, "alan lifetime includes history");
    assert(alan.limits.isUsingGlobalLimits === true, "alan uses global limits");

    const grace = pageOne.body.data.find(
      (row: any) => row.student.email === "grace@school.test"
    );
    assert(grace.usage.daily.limit === globalLimits.dailyLimit, "grace daily fallback");
    assert(grace.usage.monthly.limit === 4, "grace custom monthly limit");
    assert(grace.limits.isUsingGlobalLimits === false, "grace partial custom limits");

    const zero = pageOne.body.data.find((row: any) => row.student.email === "zero@school.test");
    assert(zero.usage.daily.limit === globalLimits.dailyLimit, "zero daily falls back");
    assert(zero.limits.isUsingGlobalLimits === true, "zero limits are falsy");

    const linus = pageOne.body.data.find(
      (row: any) => row.student.email === "linus@school.test"
    );
    assert(linus.usage.daily.limit === 5, "linus keeps daily limit");
    assert(linus.usage.monthly.limit === globalLimits.monthlyLimit, "linus monthly zero falls back");
    assert(linus.limits.isUsingGlobalLimits === false, "linus still has a custom daily limit");

    const tiedCreatedAt = new Date(baseCreatedAt + 15_000);
    const tiedUsers = await User.create([
      {
        email: "tie-a@school.test",
        firstname: "Tie",
        lastname: "Alpha",
        otp: "121212",
        createdAt: tiedCreatedAt,
      },
      {
        email: "tie-b@school.test",
        firstname: "Tie",
        lastname: "Beta",
        otp: "131313",
        createdAt: tiedCreatedAt,
      },
    ]);
    await User.collection.updateMany(
      { email: { $in: ["tie-a@school.test", "tie-b@school.test"] } },
      { $set: { createdAt: tiedCreatedAt } }
    );
    await insertUsage(tiedUsers.map((user) => ({ student: user._id, createdAt: now })));

    const tiedPage = await invokeOptimized({ search: "Tie", limit: "10" });
    assert(tiedPage.body.data.length === 2, "both tied students returned");
    const tiedIds = tiedPage.body.data.map((row: any) => String(row.student.id));
    const expectedTieOrder = tiedUsers
      .map((user) => String(user._id))
      .sort()
      .reverse();
    assertEqual(tiedIds, expectedTieOrder, "createdAt tie broken by _id desc");

    const literal = await invokeOptimized({ search: "mary.jane" });
    assert(
      literal.body.data.length === 1 &&
        literal.body.data[0].student.email === "mary.jane@school.test",
      "escaped regex stays literal"
    );

    const invalidRegex = await invokeOptimized({ search: "(" });
    assert(invalidRegex.status === 200, "invalid regex input does not 500");
    assert(invalidRegex.body.data.length === 0, "literal parenthesis matches nothing");

    const tooLarge = await invokeOptimized({ limit: "250" });
    assert(tooLarge.status === 400, "limit above 100 is rejected");
    assert(tooLarge.body.message === "Limit must be between 1 and 100", "limit message");

    const negativeLimit = await invokeOptimized({ limit: "-5" });
    assert(negativeLimit.status === 400, "negative limit is rejected");

    const emptyKeys = Object.keys(
      (await invokeOptimized({ search: "nobody-matches" })).body
    ).sort();
    assertEqual(
      emptyKeys,
      ["data", "message", "pagination", "success", "summary"],
      "top-level response keys"
    );

    await resetCollections();
    await compare({}, "month with no usage after reset");

    await User.create({
      email: "heavy@school.test",
      firstname: "Heavy",
      lastname: "User",
      otp: "141414",
      createdAt: new Date(bounds.today.getTime() - 10_000),
    });
    const heavy = await User.findOne({ email: "heavy@school.test" });
    const lightStudents = await User.create(
      Array.from({ length: 20 }, (_, index) => ({
        email: `light-${index}@school.test`,
        firstname: "Light",
        lastname: `User${index}`,
        otp: String(200000 + index),
        createdAt: new Date(bounds.today.getTime() - 20_000 - index * 1000),
      }))
    );

    const payload = "x".repeat(1024);
    const bulk: Array<{ student: mongoose.Types.ObjectId; createdAt: Date; question: string }> =
      [];
    for (let index = 0; index < 8000; index += 1) {
      bulk.push({
        student: heavy!._id,
        createdAt: new Date(historical.getTime() - index * 1000),
        question: payload,
      });
    }
    bulk.push({
      student: heavy!._id,
      createdAt: now,
      question: payload,
    });
    lightStudents.forEach((student, index) => {
      for (let copy = 0; copy < 100; copy += 1) {
        bulk.push({
          student: student._id,
          createdAt: new Date(now.getTime() - copy * 1000),
          question: payload,
        });
      }
      if (index >= 10) {
        bulk[bulk.length - 1].createdAt = historical;
      }
    });
    await insertUsage(bulk);

    const heavyQuery = { search: "heavy@school.test", limit: "10" };
    const timedOptimized = await invokeOptimized(heavyQuery);
    const startedOriginal = performance.now();
    const timedOriginal = await invokeOriginal(heavyQuery);
    const originalMs = performance.now() - startedOriginal;
    const startedOptimized = performance.now();
    await invokeOptimized(heavyQuery);
    const optimizedMs = performance.now() - startedOptimized;
    assertEqual(timedOptimized.body, timedOriginal.body, "heavy student response");
    console.log(
      `heavy student request ms: optimized=${optimizedMs.toFixed(1)} original=${originalMs.toFixed(1)}`
    );

    const monthPipeline = [
      { $match: { createdAt: { $gte: bounds.startOfMonth, $lte: bounds.endOfMonth } } },
      { $group: { _id: "$student" } },
    ];
    const withIndexExplain = summarizeExplain(
      await AiUsage.aggregate(monthPipeline).explain("executionStats")
    );
    await AiUsage.collection.dropIndex("createdAt_1_student_1");
    const withoutIndexExplain = summarizeExplain(
      await AiUsage.aggregate(monthPipeline).explain("executionStats")
    );
    await AiUsage.createIndexes();

    const usageExplain = summarizeExplain(
      await AiUsage.aggregate([
        { $match: { student: heavy!._id } },
        {
          $group: {
            _id: "$student",
            total: { $sum: 1 },
            daily: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ["$createdAt", bounds.today] },
                      { $lt: ["$createdAt", bounds.tomorrow] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]).explain("executionStats")
    );

    console.log("monthly group with createdAt index", withIndexExplain);
    console.log("monthly group without createdAt index", withoutIndexExplain);
    console.log("lifetime group for one heavy student", usageExplain);

    assert(
      withIndexExplain.stages.some((stage) => stage.includes("createdAt_1_student_1")),
      "monthly group uses createdAt_student index"
    );
    assert(
      !withIndexExplain.stages.includes("COLLSCAN"),
      "monthly group does not collection-scan when indexed"
    );
    assert(
      withIndexExplain.docs < withoutIndexExplain.docs,
      `indexed monthly scan examined fewer docs (${withIndexExplain.docs} vs ${withoutIndexExplain.docs})`
    );
    assert(
      usageExplain.stages.some((stage) => stage.includes("student_1")),
      "per-student usage uses the student index"
    );
    const usageCount = await AiUsage.countDocuments();
    assert(
      usageExplain.docs < usageCount,
      `per-student usage does not scan the whole collection (${usageExplain.docs} vs ${usageCount})`
    );

    console.log("allStudentsUsage equivalence checks passed");
  } finally {
    await mongoose.disconnect();
    await memoryServer.stop();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
