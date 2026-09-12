/**
 * Judge Prompts — Versioned prompts for LLM-as-judge evaluation.
 *
 * RAG evaluation based on RAGAS methodology.
 * Metric definitions and calculation logic are implemented based on
 * the published RAGAS methodology and documented explicitly.
 *
 * This is NOT an official RAGAS implementation.
 *
 * Version: v1
 */

export const JUDGE_PROMPT_VERSION = 'v1';

/**
 * Faithfulness: Extract atomic claims from the answer,
 * then check if each claim is supported by the retrieved context.
 */
export const FAITHFULNESS_EXTRACT_CLAIMS = `You are an expert claim extractor. Given an answer, extract ALL atomic factual claims.

An atomic claim is a single, verifiable statement of fact. Break compound sentences into individual claims.

Answer:
"""
{answer}
"""

Return a JSON array of strings, each being one atomic claim.
Example: ["claim 1", "claim 2", "claim 3"]

Return ONLY the JSON array, no other text.`;

export const FAITHFULNESS_VERIFY_CLAIM = `You are a precise fact-checker. Given a claim and a context, determine if the claim can be inferred from the context.

Claim:
"""
{claim}
"""

Context:
"""
{context}
"""

Can this claim be directly inferred or logically deduced from the context?

Return a JSON object:
{
  "supported": true or false,
  "explanation": "brief explanation"
}

Return ONLY the JSON object, no other text.`;

/**
 * Answer Relevancy: Judge if the answer addresses the question.
 */
export const ANSWER_RELEVANCY = `You are an expert evaluator. Given a question and an answer, judge how relevant the answer is to the question.

Question:
"""
{question}
"""

Answer:
"""
{answer}
"""

Score the relevancy from 0.0 to 1.0:
- 1.0: The answer directly and completely addresses the question
- 0.7-0.9: The answer mostly addresses the question with minor gaps
- 0.4-0.6: The answer partially addresses the question
- 0.1-0.3: The answer barely relates to the question
- 0.0: The answer does not address the question at all

If the answer explicitly states it doesn't have enough information to answer (and this is correct because the question is out of knowledge), score 0.8-1.0 for honest acknowledgment.

Return a JSON object:
{
  "score": <number between 0 and 1>,
  "explanation": "brief explanation"
}

Return ONLY the JSON object, no other text.`;

/**
 * Context Precision: For each retrieved chunk, judge if it's relevant to answering the question.
 */
export const CONTEXT_PRECISION = `You are an expert relevance judge. Given a question and a retrieved text chunk, determine if this chunk contains information relevant to answering the question.

Question:
"""
{question}
"""

Retrieved Chunk:
"""
{chunk}
"""

Is this chunk relevant to answering the question?

Return a JSON object:
{
  "relevant": true or false,
  "explanation": "brief explanation"
}

Return ONLY the JSON object, no other text.`;

/**
 * Context Recall: Check if each ground truth fact is covered by the retrieved context.
 */
export const CONTEXT_RECALL_EXTRACT_FACTS = `You are an expert fact extractor. Given a ground truth answer, extract ALL key facts.

Ground Truth:
"""
{groundTruth}
"""

Return a JSON array of strings, each being one key fact.
Example: ["fact 1", "fact 2", "fact 3"]

Return ONLY the JSON array, no other text.`;

export const CONTEXT_RECALL_VERIFY_FACT = `You are a precise fact-checker. Given a fact and a context, determine if this fact is covered (mentioned or can be inferred) from the context.

Fact:
"""
{fact}
"""

Context:
"""
{context}
"""

Is this fact covered by the context?

Return a JSON object:
{
  "covered": true or false,
  "explanation": "brief explanation"
}

Return ONLY the JSON object, no other text.`;
