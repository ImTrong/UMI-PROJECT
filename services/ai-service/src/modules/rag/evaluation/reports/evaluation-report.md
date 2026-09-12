# RAG Baseline Evaluation Report

> RAG evaluation based on RAGAS methodology.
> This is NOT an official RAGAS implementation.

## Configuration

| Parameter | Value |
|-----------|-------|
| Evaluation ID | eval-2026-09-08T06-35-37 |
| Dataset Version | v1 |
| LLM Model | gemini-3.6-flash |
| Embedding Model | gemini-embedding-001 |
| Embedding Dimension | 768 |
| Retrieval TopK | 5 |
| Relevance Threshold | 0.56 |
| Chunk Size | 600 |
| Judge Prompt Version | v1 |
| Total Samples | 23 |
| Timestamp | 2026-09-08T06:35:37.729Z |

## Overall Metrics

| Metric | Average | Min | Max | Count |
|--------|---------|-----|-----|-------|
| faithfulness | 0 | 0 | 0 | 0 |
| answerRelevancy | 0 | 0 | 0 | 0 |
| contextPrecision | 0 | 0 | 0 | 0 |
| contextRecall | 0 | 0 | 0 | 0 |

## Per-Category Metrics

### direct_factual (5 samples)

| Metric | Average | Min | Max |
|--------|---------|-----|-----|

### paraphrase (3 samples)

| Metric | Average | Min | Max |
|--------|---------|-----|-----|

### multi_sentence (2 samples)

| Metric | Average | Min | Max |
|--------|---------|-----|-----|

### conceptual (3 samples)

| Metric | Average | Min | Max |
|--------|---------|-----|-----|

### out_of_knowledge (4 samples)

| Metric | Average | Min | Max |
|--------|---------|-----|-----|

### similar_but_unrelated (3 samples)

| Metric | Average | Min | Max |
|--------|---------|-----|-----|

### metadata_scoped (3 samples)

| Metric | Average | Min | Max |
|--------|---------|-----|-----|

## Retrieval Error Analysis

| Classification | Count |
|---------------|-------|
| correct | 17 |
| partial | 0 |
| wrong | 6 |
| noRetrieval | 0 |
| ambiguous | 0 |

## Relevance Gate Analysis (threshold=0.56)

| Metric | Count |
|--------|-------|
| Relevant samples survived gate | 14 |
| Irrelevant samples rejected by gate | 3 |
| Ambiguous remaining | 5 |

## Representative Examples

### correct retrieval: eval-001

- **Question**: Middleware trong ExpressJS là gì?
- **Category**: direct_factual
- **Retrieval**: correct
- **Chunks retrieved**: 4
- **Top score**: 0.888
- **Answer** (first 200 chars): (retrieval-only mode — generation skipped)...

### wrong retrieval: eval-014

- **Question**: Cách triển khai Kubernetes cluster trên AWS EKS
- **Category**: out_of_knowledge
- **Retrieval**: wrong
- **Chunks retrieved**: 5
- **Top score**: 0.608
- **Answer** (first 200 chars): (retrieval-only mode — generation skipped)...

## Cost

- Total Gemini calls: 0 (retrieval-only mode)
- Total time: 10s

## Verdict

```
✅ Retrieval Baseline Established (Baseline v1)
⏳ Full RAG / Generation Baseline Pending Gemini API Quota
❌ Advanced RAG — Not Implemented
```

### Retrieval Baseline (Established)

- 23/23 samples evaluated
- 17/23 correct retrieval (73.9%)
- 100% accuracy for in-domain queries (direct_factual, paraphrase, multi_sentence, conceptual)
- Relevance Gate (threshold=0.56) correctly passes all relevant queries

### Generation Baseline (Pending)

- Faithfulness: count=0 (not yet measured)
- Answer Relevancy: count=0 (not yet measured)
- Context Precision: count=0 (not yet measured)
- Context Recall: count=0 (not yet measured)
- Blocked by Gemini free-tier daily quota (20 req/day)
- Run `run-eval.bat --full` when quota resets

### Known Limitations

- 23 samples is sufficient for baseline comparison, NOT for production reliability claims
- LLM judge uses same model family as generator (potential self-bias)
- Knowledge base uses evaluation fixtures, not real video lesson transcripts
- Shared-terminology queries may produce borderline retrieval scores

### Candidate Improvements for Advanced RAG (Not Implemented)

- OOK false positives (scores 0.58–0.61 passing gate)
- Shared-vocabulary leakage ("branch" overlap)
- Metadata filter cross-topic leakage
- BM25 / Hybrid Search / RRF / Cross-Encoder / Reranker / HyDE not implemented