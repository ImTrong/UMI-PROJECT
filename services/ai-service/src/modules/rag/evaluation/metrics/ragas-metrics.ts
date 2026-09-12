/**
 * RAGAS-style Metrics — Native TypeScript implementation.
 *
 * RAG evaluation based on RAGAS methodology.
 * Metric definitions and calculation logic are implemented based on
 * the published RAGAS methodology and documented explicitly.
 *
 * This is NOT an official RAGAS implementation.
 *
 * Metrics:
 *   - Faithfulness:       supported_claims / total_claims
 *   - Answer Relevancy:   LLM-judged relevancy score [0,1]
 *   - Context Precision:  weighted precision@k favoring relevant chunks at top
 *   - Context Recall:     covered_facts / total_facts
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { MetricScore } from '../types';
import * as prompts from './judge-prompts';
import logger from '../../../../utils/logger';

const JUDGE_TEMPERATURE = 0;
const RETRY_MAX = 5;
const RETRY_DELAY_MS = 3000;
const CALL_DELAY_MS = 4000; // 4s between calls to stay under 15 RPM quota

let geminiCallCount = 0;

export function getGeminiCallCount(): number {
  return geminiCallCount;
}

export function resetGeminiCallCount(): void {
  geminiCallCount = 0;
}

/**
 * Call Gemini as judge with quota-aware retry.
 * Uses gemini-2.0-flash for judge calls (separate quota from generation model).
 */
async function judgeCall(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  // Use a DIFFERENT model from generation to avoid quota competition
  const judgeModel = process.env.JUDGE_MODEL || 'gemini-2.0-flash';

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: judgeModel,
    generationConfig: { temperature: JUDGE_TEMPERATURE },
  });

  for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
    try {
      // Rate limiting between calls
      await sleep(CALL_DELAY_MS);
      geminiCallCount++;

      const result = await Promise.race([
        model.generateContent(prompt),
        timeout(30000), // 30s timeout
      ]) as any;

      return result.response.text();
    } catch (e: any) {
      const msg = e.message || '';
      logger.warn(`[Judge] Attempt ${attempt}/${RETRY_MAX} failed: ${msg.substring(0, 120)}`);

      // Parse retryDelay from 429 response
      const retryMatch = msg.match(/retryDelay.*?(\d+)s/);
      const quotaWait = retryMatch ? parseInt(retryMatch[1], 10) * 1000 : 0;

      if (attempt < RETRY_MAX) {
        const waitMs = Math.max(RETRY_DELAY_MS * attempt, quotaWait + 2000);
        logger.info(`[Judge] Waiting ${Math.round(waitMs / 1000)}s before retry...`);
        await sleep(waitMs);
      } else {
        throw new Error(`Judge call failed after ${RETRY_MAX} retries: ${msg.substring(0, 200)}`);
      }
    }
  }
  throw new Error('Unreachable');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
  );
}

/**
 * Parse JSON from LLM response, stripping markdown fences if present.
 */
function parseJSON(text: string): any {
  let cleaned = text.trim();
  // Remove markdown code fences
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(cleaned);
}

// ==================== FAITHFULNESS ====================

/**
 * Faithfulness = supported_claims / total_claims
 *
 * Measures if the generated answer is factually consistent with the retrieved context.
 * A score of 1.0 means all claims in the answer are supported by the context.
 */
export async function computeFaithfulness(
  answer: string,
  contexts: string[],
): Promise<MetricScore> {
  const combinedContext = contexts.join('\n\n');

  // Step 1: Extract claims from the answer
  const extractPrompt = prompts.FAITHFULNESS_EXTRACT_CLAIMS
    .replace('{answer}', answer);

  let claims: string[];
  try {
    const claimsRaw = await judgeCall(extractPrompt);
    claims = parseJSON(claimsRaw);
    if (!Array.isArray(claims) || claims.length === 0) {
      return {
        metric: 'faithfulness',
        score: 1.0, // No claims = vacuously faithful
        rawData: { claims: [], supported: [], note: 'No claims extracted' },
      };
    }
  } catch (e: any) {
    logger.error(`[Faithfulness] Failed to extract claims: ${e.message}`);
    return {
      metric: 'faithfulness',
      score: 0,
      rawData: { error: e.message },
    };
  }

  // Step 2: Verify each claim against context
  const supported: boolean[] = [];
  const explanations: string[] = [];

  for (const claim of claims) {
    try {
      const verifyPrompt = prompts.FAITHFULNESS_VERIFY_CLAIM
        .replace('{claim}', claim)
        .replace('{context}', combinedContext);

      const raw = await judgeCall(verifyPrompt);
      const result = parseJSON(raw);
      supported.push(!!result.supported);
      explanations.push(result.explanation || '');
    } catch (e: any) {
      logger.warn(`[Faithfulness] Failed to verify claim: ${e.message}`);
      supported.push(false);
      explanations.push(`Error: ${e.message}`);
    }
  }

  const supportedCount = supported.filter(Boolean).length;
  const score = claims.length > 0 ? supportedCount / claims.length : 1.0;

  return {
    metric: 'faithfulness',
    score: Math.round(score * 1000) / 1000,
    rawData: { claims, supported, explanations, supportedCount, totalClaims: claims.length },
  };
}

// ==================== ANSWER RELEVANCY ====================

/**
 * Answer Relevancy = LLM-judged score [0,1]
 *
 * Measures if the answer addresses the user's question.
 */
export async function computeAnswerRelevancy(
  question: string,
  answer: string,
): Promise<MetricScore> {
  try {
    const prompt = prompts.ANSWER_RELEVANCY
      .replace('{question}', question)
      .replace('{answer}', answer);

    const raw = await judgeCall(prompt);
    const result = parseJSON(raw);
    const score = Math.max(0, Math.min(1, Number(result.score) || 0));

    return {
      metric: 'answer_relevancy',
      score: Math.round(score * 1000) / 1000,
      rawData: { score, explanation: result.explanation },
    };
  } catch (e: any) {
    logger.error(`[AnswerRelevancy] Failed: ${e.message}`);
    return {
      metric: 'answer_relevancy',
      score: 0,
      rawData: { error: e.message },
    };
  }
}

// ==================== CONTEXT PRECISION ====================

/**
 * Context Precision = average precision@k weighted by relevance
 *
 * Measures if the most relevant retrieved chunks appear at the top of the ranking.
 * Formula: Σ(precision@k × is_relevant@k) / total_relevant
 */
export async function computeContextPrecision(
  question: string,
  contexts: string[],
): Promise<MetricScore> {
  if (contexts.length === 0) {
    return {
      metric: 'context_precision',
      score: 0,
      rawData: { note: 'No contexts retrieved' },
    };
  }

  const relevanceLabels: boolean[] = [];
  const explanations: string[] = [];

  for (const chunk of contexts) {
    try {
      const prompt = prompts.CONTEXT_PRECISION
        .replace('{question}', question)
        .replace('{chunk}', chunk);

      const raw = await judgeCall(prompt);
      const result = parseJSON(raw);
      relevanceLabels.push(!!result.relevant);
      explanations.push(result.explanation || '');
    } catch (e: any) {
      logger.warn(`[ContextPrecision] Failed to judge chunk: ${e.message}`);
      relevanceLabels.push(false);
      explanations.push(`Error: ${e.message}`);
    }
  }

  // Calculate Average Precision
  const totalRelevant = relevanceLabels.filter(Boolean).length;
  if (totalRelevant === 0) {
    return {
      metric: 'context_precision',
      score: 0,
      rawData: { relevanceLabels, explanations, totalRelevant: 0 },
    };
  }

  let sumPrecisionAtK = 0;
  let relevantSoFar = 0;
  for (let k = 0; k < relevanceLabels.length; k++) {
    if (relevanceLabels[k]) {
      relevantSoFar++;
      sumPrecisionAtK += relevantSoFar / (k + 1);
    }
  }
  const score = sumPrecisionAtK / totalRelevant;

  return {
    metric: 'context_precision',
    score: Math.round(score * 1000) / 1000,
    rawData: { relevanceLabels, explanations, totalRelevant },
  };
}

// ==================== CONTEXT RECALL ====================

/**
 * Context Recall = covered_facts / total_facts
 *
 * Measures if the retrieved context contains all the information needed
 * to produce the ground truth answer.
 * Requires ground truth; skipped for out-of-knowledge samples.
 */
export async function computeContextRecall(
  groundTruth: string,
  contexts: string[],
): Promise<MetricScore> {
  const combinedContext = contexts.join('\n\n');

  // Step 1: Extract facts from ground truth
  let facts: string[];
  try {
    const extractPrompt = prompts.CONTEXT_RECALL_EXTRACT_FACTS
      .replace('{groundTruth}', groundTruth);

    const raw = await judgeCall(extractPrompt);
    facts = parseJSON(raw);
    if (!Array.isArray(facts) || facts.length === 0) {
      return {
        metric: 'context_recall',
        score: 1.0,
        rawData: { facts: [], covered: [], note: 'No facts extracted from ground truth' },
      };
    }
  } catch (e: any) {
    logger.error(`[ContextRecall] Failed to extract facts: ${e.message}`);
    return {
      metric: 'context_recall',
      score: 0,
      rawData: { error: e.message },
    };
  }

  // Step 2: Check each fact against context
  const covered: boolean[] = [];
  const explanations: string[] = [];

  for (const fact of facts) {
    try {
      const verifyPrompt = prompts.CONTEXT_RECALL_VERIFY_FACT
        .replace('{fact}', fact)
        .replace('{context}', combinedContext);

      const raw = await judgeCall(verifyPrompt);
      const result = parseJSON(raw);
      covered.push(!!result.covered);
      explanations.push(result.explanation || '');
    } catch (e: any) {
      logger.warn(`[ContextRecall] Failed to verify fact: ${e.message}`);
      covered.push(false);
      explanations.push(`Error: ${e.message}`);
    }
  }

  const coveredCount = covered.filter(Boolean).length;
  const score = facts.length > 0 ? coveredCount / facts.length : 1.0;

  return {
    metric: 'context_recall',
    score: Math.round(score * 1000) / 1000,
    rawData: { facts, covered, explanations, coveredCount, totalFacts: facts.length },
  };
}
