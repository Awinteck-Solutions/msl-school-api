import sanitizeHtml = require("sanitize-html");
import type { Content } from "@google/generative-ai";
import { geminiChatModel } from "../../geminiAi/controllers/geminiAi.shared";

/**
 * Reads a past-question PDF with Gemini and returns each question, suggested solution and
 * examiner note as HTML, so tables, lists and emphasis from the original paper survive.
 * Also returns optional case-study / pre-seen material that appears before Question 1.
 */

export type FormattedQuestion = {
  number: string;
  questionHtml: string;
  answerHtml: string;
  answerNotesHtml: string;
  marks: number | null;
};

export type FormattedExtraction = {
  backgroundHtml: string;
  questions: FormattedQuestion[];
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
  "colgroup",
  "col",
  "h4",
  "h5",
  "blockquote",
  "span",
  "div",
  "img",
  "figure",
  "figcaption",
];

const STYLE_FILTER: Record<string, RegExp[]> = {
  color: [/^#(0x)?[0-9a-f]+$/i, /^rgb\(/i, /^rgba\(/i, /^hsl\(/i, /^[a-z]+$/i],
  "background-color": [/^#(0x)?[0-9a-f]+$/i, /^rgb\(/i, /^rgba\(/i, /^transparent$/i],
  "font-size": [/^\d+(\.\d+)?(px|pt|em|rem|%)$/i],
  "font-weight": [/^(normal|bold|[1-9]00)$/i],
  "font-style": [/^(normal|italic)$/i],
  "text-align": [/^(left|right|center|justify)$/i],
  "vertical-align": [/^(top|middle|bottom|baseline)$/i],
  width: [/^\d+(\.\d+)?(px|pt|em|rem|%)$/i],
  "min-width": [/^\d+(\.\d+)?(px|pt|em|rem|%)$/i],
  "max-width": [/^\d+(\.\d+)?(px|pt|em|rem|%)$/i],
  height: [/^\d+(\.\d+)?(px|pt|em|rem|%)$/i],
  border: [/^[\w\s#%,.()/-]+$/i],
  "border-collapse": [/^collapse$/i],
  padding: [/^\d+(\.\d+)?(px|pt|em|rem|%)(\s+\d+(\.\d+)?(px|pt|em|rem|%)){0,3}$/i],
  margin: [/^\d+(\.\d+)?(px|pt|em|rem|%)(\s+\d+(\.\d+)?(px|pt|em|rem|%)){0,3}$/i],
};

/** Allowlist-only HTML: no scripts, links, or event handlers. Limited inline styles and images. */
export const sanitizeQuestionHtml = (html: unknown): string =>
  sanitizeHtml(String(html ?? ""), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      th: ["colspan", "rowspan", "align", "valign", "width", "style", "class"],
      td: ["colspan", "rowspan", "align", "valign", "width", "style", "class"],
      col: ["span", "width", "style"],
      ol: ["type", "start"],
      p: ["align", "style"],
      div: ["align", "style", "class"],
      span: ["style", "class"],
      table: ["width", "border", "cellpadding", "cellspacing", "style", "class"],
      img: ["src", "alt", "width", "height", "style"],
      figure: ["style", "class"],
      "*": ["style"],
    },
    allowedStyles: {
      "*": STYLE_FILTER,
    },
    allowedSchemes: ["https", "http", "data"],
    allowedSchemesAppliedToAttributes: ["src"],
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

  text = text.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_match, inner: string) => {
    let index = 0;
    return inner.replace(/<li[^>]*>/gi, () => `\n${(index += 1)}. `);
  });
  text = text
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(td|th)>\s*<(td|th)[^>]*>/gi, " | ")
    .replace(/<\/(p|tr|li|ul|ol|table|caption|h4|h5|blockquote|thead|tbody|figure|figcaption)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<img[^>]*>/gi, " [figure] ")
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

/** Strip trailing "Paper" / "Solutions" noise from exam titles. */
export const normalizePaperTitle = (title: unknown) =>
  String(title || "")
    .replace(/\s+Solutions?\s*$/i, "")
    .replace(/\s+Paper\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

const parseJson = (raw: string) => {
  const cleaned = String(raw || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const objectStart = cleaned.indexOf("{");
    const objectEnd = cleaned.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      try {
        return JSON.parse(cleaned.slice(objectStart, objectEnd + 1));
      } catch {
        /* fall through to array */
      }
    }
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
The paper may start with additional information, background, or pre-seen material (a case study, scenario, exhibits, appendices, or company facts) BEFORE the numbered questions. Headings to look for include "Additional information", "Additional material", "Background", "Pre-seen", "Pre seen", and "Case study". Then it contains questions, then (usually later) suggested solutions and examiner's comments.
Return ONLY JSON (no markdown fences, no commentary) with this shape:
{
  "backgroundHtml": "<p>...</p>",
  "questions": [
    {
      "number": "1(a)",
      "questionHtml": "<p>...</p>",
      "answerHtml": "<p>...</p>",
      "answerNotesHtml": "<p>...</p>",
      "marks": 5
    }
  ]
}

backgroundHtml rules:
- Put ONLY material that appears before the first numbered question: additional information, background, pre-seen material, case studies, exhibits, company facts, and appendices the questions rely on.
- Keep the section heading when the paper has one.
- If the paper has no such material, return "".
- Do NOT put numbered exam questions into backgroundHtml.

HTML rules (important):
- Reproduce the PDF content faithfully and completely. Do not summarise, shorten, reorder or correct it.
- Keep every table as a real <table> with <thead>/<tbody>, <tr>, <th>, <td>. Use colspan/rowspan for merged cells. Keep all numbers, currency symbols, brackets and alignment-relevant empty cells exactly.
- Prefer text-align via style or align attributes so columns that are right/centre aligned in the PDF stay that way. Paragraphs of prose may use style="text-align:justify".
- Keep bullet lists as <ul><li>, numbered lists as <ol><li> (use type="a"/"i" for lettered/roman lists). Nested lists go inside the parent <li>.
- Use <p> for paragraphs, <strong> for bold, <em> for italic, <u> for underline, <sub>/<sup> for subscripts and superscripts.
- Preserve meaningful colour and font-size with limited inline style attributes when they appear in the paper (for example red loss figures, bold headings).
- For figures/diagrams that are essential, include an <img> only when you can describe them as a short caption inside <figure><figcaption>…</figcaption></figure> if the image itself cannot be embedded. Prefer capturing tabular data as tables, not images.
- Never output scripts, links, or event handlers.
- Escape &, < and > as entities. Do not invent bullet glyphs; use list tags.
- The question text must not include the suggested solution, and vice versa.
- Put a question's mark allocation in "marks" as a number when given, else null.
- If a question has no suggested solution or examiner's notes in the paper, return "" for those fields.
- Keep lettered parts as separate entries when the paper numbers them separately (for example 1(a), 1(b), 1(c)(i)).`;

const fenceHints = (hints: Array<{ number: string; question: string }>) =>
  hints
    .map((hint) => `- ${hint.number}: ${hint.question.replace(/\s+/g, " ").slice(0, 90)}`)
    .join("\n");

const mapQuestions = (parsed: any[]): FormattedQuestion[] =>
  parsed
    .filter((row) => row && typeof row === "object")
    .map((row: any, index: number) => ({
      number: String(row.number || index + 1).trim(),
      questionHtml: sanitizeQuestionHtml(row.questionHtml ?? row.question),
      answerHtml: sanitizeQuestionHtml(row.answerHtml ?? row.answer),
      answerNotesHtml: sanitizeQuestionHtml(row.answerNotesHtml ?? row.answerNotes),
      marks:
        row.marks === null ||
        row.marks === undefined ||
        row.marks === "" ||
        Number.isNaN(Number(row.marks))
          ? null
          : Number(row.marks),
    }))
    .filter((row) => row.questionHtml);

const BACKGROUND_HEADING =
  /^(additional(?:\s+information|\s+material)?|background(?:\s+information|\s+material)?|pre[-\s]?seen(?:\s+material|\s+information)?|case\s*study)\b/i;

/** If the model filed the opening material as a question, move it above Question 1. */
const peelLeadingBackground = (
  backgroundHtml: string,
  questions: FormattedQuestion[]
): { backgroundHtml: string; questions: FormattedQuestion[] } => {
  if (String(backgroundHtml || "").trim() || !questions.length) {
    return { backgroundHtml, questions };
  }
  const first = questions[0];
  const number = String(first.number || "").trim();
  const opening = htmlToPlainText(first.questionHtml).replace(/\s+/g, " ").trim().slice(0, 160);
  const numberIsHeading = BACKGROUND_HEADING.test(number);
  const textIsHeading = BACKGROUND_HEADING.test(opening) && !/^\d/.test(number);
  if (!numberIsHeading && !textIsHeading) return { backgroundHtml, questions };
  return { backgroundHtml: first.questionHtml, questions: questions.slice(1) };
};

/**
 * `hints` are the questions already stored for this paper. When given, Gemini is asked to return
 * exactly those numbers so the HTML can be matched to the existing records.
 */
export const extractFormattedQuestionsFromPdf = async (
  pdf: Buffer,
  hints: Array<{ number: string; question: string }> = []
): Promise<FormattedExtraction> => {
  const instruction = hints.length
    ? `${FORMAT_PROMPT}\n\nThis paper already has these questions on record. Return exactly one questions[] element for each number below, in this order, using the same number strings, and no others. When a number is a whole question (for example "1"), return a single element that contains ALL of its parts (a), (b), (c)... together in order, and do not split it into 1(a), 1(b). This overrides the rule about lettered parts. Still return backgroundHtml for any pre-seen / case-study material before Question 1:\n${fenceHints(hints)}`
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
    if (Array.isArray(parsed) || (parsed && typeof parsed === "object")) break;
  }

  if (Array.isArray(parsed)) {
    return peelLeadingBackground("", mapQuestions(parsed));
  }
  if (parsed && typeof parsed === "object") {
    const row = parsed as Record<string, unknown>;
    const questions = Array.isArray(row.questions) ? row.questions : [];
    const backgroundSource =
      row.backgroundHtml || row.additionalHtml || row.preSeenHtml || row.background || "";
    return peelLeadingBackground(sanitizeQuestionHtml(backgroundSource), mapQuestions(questions as any[]));
  }
  throw new Error("Gemini did not return a question list for this PDF");
};
