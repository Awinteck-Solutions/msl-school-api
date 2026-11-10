import sanitizeHtml = require("sanitize-html");
import type { Content } from "@google/generative-ai";
import { geminiChatModel } from "../../geminiAi/controllers/geminiAi.shared";

/**
 * Reads a past-question PDF with Gemini and returns each question, suggested solution and
 * examiner note as HTML, so tables, lists and emphasis from the original paper survive.
 */

export type FormattedQuestion = {
  number: string;
  questionHtml: string;
  answerHtml: string;
  answerNotesHtml: string;
  marks: number | null;
};

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "sub",
  "sup",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "h4",
  "h5",
  "blockquote",
];

/** Allowlist-only HTML: no scripts, styles, links, images or event handlers. */
export const sanitizeQuestionHtml = (html: unknown): string =>
  sanitizeHtml(String(html ?? ""), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
      ol: ["type", "start"],
    },
    allowedSchemes: [],
    disallowedTagsMode: "discard",
  })
    .replace(/<p>\s*(?:<br\s*\/?>)?\s*<\/p>/gi, "")
    .trim();

const decodeEntities = (value: string) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/**
 * Readable plain text for the same content: paragraphs and rows on their own lines,
 * bullets as "•", numbered lists as "1.", table cells separated by " | ".
 */
export const htmlToPlainText = (html: unknown): string => {
  let text = String(html ?? "");
  if (!text.trim()) return "";

  // Numbered lists get their numbers before the tags are stripped.
  text = text.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_match, inner: string) => {
    let index = 0;
    return inner.replace(/<li[^>]*>/gi, () => `\n${(index += 1)}. `);
  });
  text = text
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(td|th)>\s*<(td|th)[^>]*>/gi, " | ")
    .replace(/<\/(p|tr|li|ul|ol|table|caption|h4|h5|blockquote|thead|tbody)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const tokens = (value: string) =>
  new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((word) => word.length > 2)
  );

/** 0..1 overlap of the words in two texts (smaller text is the denominator). */
export const textOverlap = (a: string, b: string) => {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  left.forEach((word) => {
    if (right.has(word)) shared += 1;
  });
  return shared / Math.min(left.size, right.size);
};

/** "1(a)(ii)", "1 (a) (ii)" and "1a.ii" all compare equal. */
export const normaliseNumber = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/question|part/g, "")
    .replace(/[^a-z0-9]+/g, "");

const parseJson = (raw: string) => {
  const cleaned = String(raw || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
};

const FORMAT_PROMPT = `You are digitising an exam past-question paper that has been supplied as a PDF.
The paper contains questions, then (usually later) suggested solutions and examiner's comments.
Return ONLY a JSON array (no markdown fences, no commentary). Each element is:
{
  "number": "1(a)",
  "questionHtml": "<p>...</p>",
  "answerHtml": "<p>...</p>",
  "answerNotesHtml": "<p>...</p>",
  "marks": 5
}

HTML rules (important):
- Reproduce the PDF content faithfully and completely. Do not summarise, shorten, reorder or correct it.
- Keep every table as a real <table> with <thead>/<tbody>, <tr>, <th>, <td>. Use colspan/rowspan for merged cells. Keep all numbers, currency symbols, brackets and alignment-relevant empty cells exactly.
- Keep bullet lists as <ul><li>, numbered lists as <ol><li> (use type="a"/"i" for lettered/roman lists). Nested lists go inside the parent <li>.
- Use <p> for paragraphs, <strong> for bold, <em> for italic, <u> for underline, <sub>/<sup> for subscripts and superscripts.
- Never output images, styles, classes, links, scripts or any tag not listed above.
- Escape &, < and > as entities. Do not invent bullet glyphs; use list tags.
- The question text must not include the suggested solution, and vice versa.
- Put a question's mark allocation in "marks" as a number when given, else null.
- If a question has no suggested solution or examiner's notes in the paper, return "" for those fields.
- Keep lettered parts as separate entries when the paper numbers them separately (for example 1(a), 1(b), 1(c)(i)).`;

const fenceHints = (hints: Array<{ number: string; question: string }>) =>
  hints
    .map((hint) => `- ${hint.number}: ${hint.question.replace(/\s+/g, " ").slice(0, 90)}`)
    .join("\n");

/**
 * `hints` are the questions already stored for this paper. When given, Gemini is asked to return
 * exactly those numbers so the HTML can be matched to the existing records.
 */
export const extractFormattedQuestionsFromPdf = async (
  pdf: Buffer,
  hints: Array<{ number: string; question: string }> = []
): Promise<FormattedQuestion[]> => {
  const instruction = hints.length
    ? `${FORMAT_PROMPT}\n\nThis paper already has these questions on record. Return exactly one element for each number below, in this order, using the same number strings, and no others. When a number is a whole question (for example "1"), return a single element that contains ALL of its parts (a), (b), (c)... together in order, and do not split it into 1(a), 1(b). This overrides the rule about lettered parts:\n${fenceHints(hints)}`
    : FORMAT_PROMPT;

  const contents: Content[] = [
    {
      role: "user",
      parts: [
        { inlineData: { mimeType: "application/pdf", data: pdf.toString("base64") } },
        { text: instruction },
      ],
    },
  ];

  // Long papers sometimes come back with an unescaped quote that breaks the JSON. Retry once in
  // JSON mode, which forces valid escaping.
  let parsed: unknown = null;
  for (const jsonMode of [false, true]) {
    const completion = await geminiChatModel.generateContent({
      contents,
      generationConfig: {
        maxOutputTokens: 65000,
        temperature: 0,
        ...(jsonMode ? ({ responseMimeType: "application/json" } as any) : {}),
      },
    });
    parsed = parseJson(completion.response.text());
    if (Array.isArray(parsed)) break;
  }
  if (!Array.isArray(parsed)) throw new Error("Gemini did not return a question list for this PDF");

  return parsed
    .filter((row) => row && typeof row === "object")
    .map((row: any, index: number) => ({
      number: String(row.number || index + 1).trim(),
      questionHtml: sanitizeQuestionHtml(row.questionHtml ?? row.question),
      answerHtml: sanitizeQuestionHtml(row.answerHtml ?? row.answer),
      answerNotesHtml: sanitizeQuestionHtml(row.answerNotesHtml ?? row.answerNotes),
      marks:
        row.marks === null || row.marks === undefined || row.marks === "" || Number.isNaN(Number(row.marks))
          ? null
          : Number(row.marks),
    }))
    .filter((row) => row.questionHtml);
};
