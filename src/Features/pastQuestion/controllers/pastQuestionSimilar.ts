/**
 * Finds near-duplicate questions across the sittings of one exam paper.
 *
 * The scoring is a word-overlap (Dice) percentage and matches what the web notebook has always
 * computed in the browser (`web/src/lib/questionGroups.js`), so the same questions score the same
 * whichever side calculates them.
 */

const STOP_WORDS = new Set(
  "the a an of and to in for on with is are be by or as at from that this it its was were been being not no into over under about after before than then your you we they their our".split(
    " "
  )
);

export const DEFAULT_SIMILAR_MINIMUM = 46;
export const DEFAULT_PEERS_PER_QUESTION = 8;
export const DEFAULT_TOP_LINKS = 40;
/**
 * Cap on questions compared at once, so a very large course cannot make one request slow.
 * 1,200 questions is about 720,000 comparisons, well under a second.
 */
const COMPARISON_LIMIT = 1200;

export type SimilarQuestion = {
  _id: string;
  paperId: string;
  number: string;
  question: string;
  questionHtml: string;
  marks: number | null;
  year: number | string;
  sitting: string;
  title: string;
  level: string;
  paperCode: string;
};

export type SimilarPair = { score: number; left: SimilarQuestion; right: SimilarQuestion };

const tokens = (text: unknown) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

const dice = (left: Set<string>, right: Set<string>) => {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  left.forEach((word) => {
    if (right.has(word)) shared += 1;
  });
  return Math.round((2 * shared * 100) / (left.size + right.size));
};

/** Keeps an even share of each sitting when there are more questions than the comparison limit. */
const comparisonPool = (questions: SimilarQuestion[]) => {
  if (questions.length <= COMPARISON_LIMIT) return questions;
  const byPaper = new Map<string, SimilarQuestion[]>();
  questions.forEach((question) => {
    const list = byPaper.get(question.paperId) || [];
    list.push(question);
    byPaper.set(question.paperId, list);
  });
  const perPaper = Math.max(8, Math.floor(COMPARISON_LIMIT / byPaper.size));
  return Array.from(byPaper.values()).flatMap((list) => list.slice(0, perPaper));
};

/** Every pair of questions from different sittings that scores at least `minimum`, best first. */
export const buildSimilarPairs = (
  questions: SimilarQuestion[],
  minimum = DEFAULT_SIMILAR_MINIMUM
): SimilarPair[] => {
  const prepared = comparisonPool(questions).map((question) => ({
    question,
    words: new Set(tokens(question.question)),
  }));
  const pairs: SimilarPair[] = [];
  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const left = prepared[i].question;
      const right = prepared[j].question;
      if (left.paperId === right.paperId) continue;
      if (left.year === right.year && String(left.sitting) === String(right.sitting)) continue;
      const score = dice(prepared[i].words, prepared[j].words);
      if (score >= minimum) pairs.push({ score, left, right });
    }
  }
  return pairs.sort((a, b) => b.score - a.score);
};

/**
 * For each question id, its most similar questions from other sittings (best first).
 * Only ids in `focusIds` are returned when given.
 */
export const peersByQuestion = (
  pairs: SimilarPair[],
  perQuestion = DEFAULT_PEERS_PER_QUESTION,
  focusIds?: Set<string>
) => {
  const peers = new Map<string, Array<{ score: number; question: SimilarQuestion }>>();
  const add = (id: string, score: number, question: SimilarQuestion) => {
    if (focusIds && !focusIds.has(id)) return;
    const list = peers.get(id) || [];
    if (list.some((item) => item.question._id === question._id)) return;
    list.push({ score, question });
    peers.set(id, list);
  };
  pairs.forEach(({ score, left, right }) => {
    add(left._id, score, right);
    add(right._id, score, left);
  });
  peers.forEach((list, id) => {
    peers.set(
      id,
      list
        .sort(
          (a, b) =>
            b.score - a.score || String(a.question.year).localeCompare(String(b.question.year))
        )
        .slice(0, perQuestion)
    );
  });
  return peers;
};
