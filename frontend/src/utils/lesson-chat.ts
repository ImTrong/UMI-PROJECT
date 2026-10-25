import { toRagChatError } from '../services/rag-chat.service';
import type { RagChatError, RagChatErrorKind, RagChatResult, RagScope, RagSource } from '../services/rag-chat.service';

/**
 * RAG-MVP-05A — state of the lesson chat ("Hỏi về bài học"), kept free of React so it can be tested without a DOM.
 *
 * One thread per lesson (scope key = courseId:lessonId): its own conversationId, messages, pending flag and error.
 * Every action names the thread it belongs to, so an answer that arrives after the learner moved to another lesson is
 * written to the lesson that asked, and a conversation is never continued with another lesson's scope.
 */
export const scopeKeyOf = (scope: RagScope) => `${scope.courseId}:${scope.lessonId}`;

// ==================== citations ====================

/** Numbers cited as "[Nguồn 1]", "[Nguồn 1, 3]", "[nguồn 2 và 4]" in the answer (Unicode-normalized). */
export function extractCitedIndexes(answer: string): number[] {
  const text = answer.normalize('NFC');
  const cited = new Set<number>();
  for (const match of text.matchAll(/\[\s*nguồn\s+([^\]]+)\]/giu)) {
    for (const n of match[1].matchAll(/\d+/g)) cited.add(Number(n[0]));
  }
  return [...cited].sort((a, b) => a - b);
}

export interface SourceSplit {
  /** Sources the answer actually cites, in citation-number order. */
  used: RagSource[];
  /** Sources given to the model but not cited: shown apart, never as "used". */
  unused: RagSource[];
  /** "[Nguồn n]" markers with no matching source (the model cited something it was not given). */
  unknownMarkers: number[];
}

export function splitSources(answer: string, sources: RagSource[]): SourceSplit {
  const cited = extractCitedIndexes(answer);
  const byIndex = new Map(sources.map((s) => [s.sourceIndex, s]));
  return {
    used: cited.filter((n) => byIndex.has(n)).map((n) => byIndex.get(n)!),
    unused: sources.filter((s) => !cited.includes(s.sourceIndex)).sort((a, b) => a.sourceIndex - b.sourceIndex),
    unknownMarkers: cited.filter((n) => !byIndex.has(n)),
  };
}

// ==================== threads ====================

export interface ChatTurn {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  /** assistant turns only */
  grounded?: boolean;
  sources?: SourceSplit;
}

export interface ThreadError {
  kind: RagChatErrorKind;
  message: string;
  retryable: boolean;
  /** the question that failed (resent by "Thử lại") */
  question: string;
}

export interface LessonThread {
  conversationId: string | null;
  turns: ChatTurn[];
  pending: boolean;
  error: ThreadError | null;
  /** 401 / 403: the learner cannot use this lesson's assistant (input disabled, no retry). */
  blocked: boolean;
}

export type ThreadsState = Record<string, LessonThread>;

export const emptyThread = (): LessonThread => ({ conversationId: null, turns: [], pending: false, error: null, blocked: false });

export type LessonChatAction =
  | { type: 'SEND_START'; scopeKey: string; question: string; turnId: string }
  | { type: 'SEND_SUCCESS'; scopeKey: string; turnId: string; result: RagChatResult }
  | { type: 'SEND_FAILURE'; scopeKey: string; turnId: string; question: string; error: RagChatError }
  | { type: 'DISMISS_ERROR'; scopeKey: string };

export function threadOf(state: ThreadsState, scopeKey: string): LessonThread {
  return state[scopeKey] ?? emptyThread();
}

export function lessonChatReducer(state: ThreadsState, action: LessonChatAction): ThreadsState {
  const thread = threadOf(state, action.scopeKey);
  switch (action.type) {
    case 'SEND_START':
      return {
        ...state,
        [action.scopeKey]: {
          ...thread,
          pending: true,
          error: null,
          turns: [...thread.turns, { id: `${action.turnId}-q`, role: 'USER', content: action.question }],
        },
      };
    case 'SEND_SUCCESS': {
      const { result } = action;
      return {
        ...state,
        [action.scopeKey]: {
          ...thread,
          pending: false,
          error: null,
          conversationId: result.conversationId,
          turns: [
            ...thread.turns,
            {
              id: `${action.turnId}-a`,
              role: 'ASSISTANT',
              content: result.message,
              grounded: result.grounded,
              sources: splitSources(result.message, result.sources),
            },
          ],
        },
      };
    }
    case 'SEND_FAILURE': {
      const { error } = action;
      return {
        ...state,
        [action.scopeKey]: {
          ...thread,
          pending: false,
          // the backend saved nothing for a failed question: drop it from the thread, offer to resend it
          turns: thread.turns.filter((t) => t.id !== `${action.turnId}-q`),
          conversationId: error.kind === 'CONVERSATION_GONE' ? null : thread.conversationId,
          blocked: thread.blocked || error.kind === 'ACCESS_DENIED' || error.kind === 'SESSION_EXPIRED',
          error: { kind: error.kind, message: error.message, retryable: error.retryable, question: action.question },
        },
      };
    }
    case 'DISMISS_ERROR':
      return { ...state, [action.scopeKey]: { ...thread, error: null } };
    default:
      return state;
  }
}

let turnSeq = 0;

/**
 * Sends one question of the lesson `scope`: SEND_START, then SEND_SUCCESS / SEND_FAILURE for THAT scope, whatever lesson is
 * displayed when the answer arrives. The conversation continued is the one of this lesson's thread (null -> a new one).
 */
export async function askLesson(
  scope: RagScope,
  thread: LessonThread,
  question: string,
  dispatch: (action: LessonChatAction) => void,
  ask: (scope: RagScope, message: string, conversationId?: string | null) => Promise<RagChatResult>,
): Promise<void> {
  const scopeKey = scopeKeyOf(scope);
  const turnId = `t${++turnSeq}`;
  dispatch({ type: 'SEND_START', scopeKey, question, turnId });
  try {
    const result = await ask({ courseId: scope.courseId, lessonId: scope.lessonId }, question, thread.conversationId);
    dispatch({ type: 'SEND_SUCCESS', scopeKey, turnId, result });
  } catch (error) {
    dispatch({ type: 'SEND_FAILURE', scopeKey, turnId, question, error: toRagChatError(error) });
  }
}
