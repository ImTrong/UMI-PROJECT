/**
 * RAGAS Runner — RAG Evaluation Pipeline
 *
 * RAG evaluation based on RAGAS methodology.
 * Uses the real production RAG pipeline (embedding → Qdrant → relevance gate → context builder → Gemini).
 *
 * CLI:
 *   --validate          Validate dataset only (no Gemini calls)
 *   --limit N           Run only N samples
 *   --category CAT      Run only specified category
 *   --retrieval-only    Skip LLM metric evaluation
 *   --full              Run all samples with all metrics
 *   --mode dense|advanced  Override retrieval mode (default: from env RAG_RETRIEVAL_MODE)
 */

import dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { initializeGemini } from '../../../config/gemini.config';
import { RAGService } from '../rag.service';
import { RAGGenerationService } from '../generation/rag-generation.service';
import { loadRAGConfig } from '../rag.config';
import {
  EvalDataset,
  EvalSample,
  EvalCategory,
  LessonFixture,
  SampleRAGResult,
  SampleEvalResult,
  RetrievedContextInfo,
  AggregatedMetrics,
  CategoryMetrics,
  EvalConfig,
  EvalReport,
  RetrievalClassification,
  RetrievalCause,
} from './types';
import {
  computeFaithfulness,
  computeAnswerRelevancy,
  computeContextPrecision,
  computeContextRecall,
  getGeminiCallCount,
  resetGeminiCallCount,
} from './metrics/ragas-metrics';
import { JUDGE_PROMPT_VERSION } from './metrics/judge-prompts';
import logger from '../../../utils/logger';

const prisma = new PrismaClient();

// ==================== FIXTURES ====================

function loadFixtures(): LessonFixture[] {
  const fixtureDir = path.join(__dirname, 'dataset', 'fixtures');
  return [
    {
      sourceId: 'eval-expressjs-middleware',
      title: 'Middleware trong ExpressJS',
      content: fs.readFileSync(path.join(fixtureDir, 'expressjs-middleware.md'), 'utf-8'),
      metadata: {
        courseId: '6a8894d41878e03ad8299dfa',
        lessonId: 'eval-expressjs-middleware',
        skills: ['ExpressJS', 'Middleware', 'Node.js'],
        language: 'vi',
      },
    },
    {
      sourceId: 'eval-docker-basics',
      title: 'Docker Containers Cơ Bản',
      content: fs.readFileSync(path.join(fixtureDir, 'docker-basics.md'), 'utf-8'),
      metadata: {
        courseId: '6a7f448aa949aa290408270f',
        lessonId: 'eval-docker-basics',
        skills: ['Docker', 'Container', 'DevOps'],
        language: 'vi',
      },
    },
    {
      sourceId: 'eval-git-github',
      title: 'Git và GitHub Cơ Bản',
      content: fs.readFileSync(path.join(fixtureDir, 'git-github-basics.md'), 'utf-8'),
      metadata: {
        courseId: '6a7f456da949aa2904082712',
        lessonId: 'eval-git-github',
        skills: ['Git', 'GitHub', 'Version Control'],
        language: 'vi',
      },
    },
  ];
}

function loadDataset(): EvalDataset {
  const datasetPath = path.join(__dirname, 'dataset', 'umi-rag-eval-v1.json');
  return JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
}

// ==================== DATASET VALIDATION ====================

function validateDataset(dataset: EvalDataset, fixtures: LessonFixture[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const fixtureIds = new Set(fixtures.map(f => f.sourceId));

  for (const sample of dataset.samples) {
    // Schema validation
    if (!sample.id || !sample.category || !sample.question) {
      errors.push(`${sample.id}: Missing required fields`);
    }

    // Ground truth validation
    if (sample.category === 'out_of_knowledge' || sample.category === 'similar_but_unrelated') {
      if (sample.groundTruth !== null) {
        errors.push(`${sample.id}: OOK/similar sample should have null groundTruth`);
      }
      if (sample.expectedSources.length > 0) {
        errors.push(`${sample.id}: OOK/similar sample should have empty expectedSources`);
      }
    } else if (sample.category === 'metadata_scoped' && sample.expectedSources.length === 0) {
      // metadata_scoped with empty expectedSources means wrong-filter test
      if (sample.groundTruth !== null) {
        errors.push(`${sample.id}: Wrong-filter metadata sample should have null groundTruth`);
      }
    } else {
      if (!sample.groundTruth) {
        errors.push(`${sample.id}: Non-OOK sample must have groundTruth`);
      }
      for (const src of sample.expectedSources) {
        if (!fixtureIds.has(src)) {
          errors.push(`${sample.id}: expectedSource '${src}' not in fixtures`);
        }
      }
    }

    // Category validation
    const validCategories: EvalCategory[] = [
      'direct_factual', 'paraphrase', 'multi_sentence', 'conceptual',
      'out_of_knowledge', 'similar_but_unrelated', 'metadata_scoped',
    ];
    if (!validCategories.includes(sample.category)) {
      errors.push(`${sample.id}: Invalid category '${sample.category}'`);
    }
  }

  // Category distribution
  const categoryCounts: Record<string, number> = {};
  for (const s of dataset.samples) {
    categoryCounts[s.category] = (categoryCounts[s.category] || 0) + 1;
  }
  console.log('\n=== Dataset Category Distribution ===');
  for (const [cat, count] of Object.entries(categoryCounts)) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(`  Total: ${dataset.samples.length}`);

  return { valid: errors.length === 0, errors };
}

// ==================== RAG EXECUTION ====================

async function runRAGPipeline(
  rag: RAGService,
  generation: RAGGenerationService,
  sample: EvalSample,
  retrievalOnly = false,
): Promise<SampleRAGResult> {
  const startRetrieval = Date.now();
  const context = await rag.retrieve(
    sample.question,
    sample.metadata.courseId ? { courseId: sample.metadata.courseId } : undefined,
  );
  const retrievalTimeMs = Date.now() - startRetrieval;

  // Build context info
  const retrievedContexts: RetrievedContextInfo[] = context.chunks.map(c => ({
    chunkId: c.chunkId,
    chunkIndex: c.chunkIndex,
    documentId: c.documentId,
    sourceId: (c.metadata.lessonId as string) || '',
    title: c.title,
    content: c.content,
    score: c.score,
  }));

  let generatedAnswer = '(retrieval-only mode — generation skipped)';
  let sources: any[] = [];
  let generationTimeMs = 0;

  if (!retrievalOnly) {
    // Generate answer (with retry for quota errors)
    const startGen = Date.now();
    let genResult;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        genResult = await generation.generate(sample.question, context);
        break;
      } catch (e: any) {
        const msg = e.message || '';
        if (msg.includes('429') || msg.includes('quota') || msg.includes('503') || msg.includes('overloaded') || msg.includes('high demand')) {
          const retryMatch = msg.match(/retryDelay.*?(\d+)s/);
          const waitSec = retryMatch ? parseInt(retryMatch[1], 10) : 15 * attempt;
          logger.warn(`[Eval] Generation error (${msg.includes('503') ? '503' : '429'}), waiting ${waitSec + 5}s (attempt ${attempt}/5)`);
          await new Promise(r => setTimeout(r, (waitSec + 5) * 1000));
        } else {
          throw e;
        }
      }
    }
    if (!genResult) throw new Error('Generation failed after 5 retries');
    generationTimeMs = Date.now() - startGen;
    generatedAnswer = genResult.answer;
    sources = genResult.sources.map(s => ({
      documentId: s.documentId,
      chunkId: s.chunkId,
      lessonId: s.lessonId,
      title: s.title,
      score: s.score,
    }));
  }

  return {
    sampleId: sample.id,
    question: sample.question,
    category: sample.category,
    groundTruth: sample.groundTruth,
    expectedSources: sample.expectedSources,
    generatedAnswer,
    retrievedContexts,
    sources,
    totalChunksRetrieved: context.totalChunks,
    topScore: retrievedContexts.length > 0 ? retrievedContexts[0].score : 0,
    retrievalTimeMs,
    generationTimeMs,
  };
}

// ==================== RETRIEVAL CLASSIFICATION ====================

function classifyRetrieval(
  result: SampleRAGResult,
): { classification: RetrievalClassification; cause: RetrievalCause } {
  const { expectedSources, retrievedContexts, category } = result;

  // Out-of-knowledge / similar-but-unrelated
  if (category === 'out_of_knowledge' || category === 'similar_but_unrelated') {
    if (retrievedContexts.length === 0) {
      return { classification: 'correct', cause: null };
    }
    return { classification: 'wrong', cause: 'false_positive' };
  }

  // Metadata-scoped with no expected sources (wrong-filter test)
  if (category === 'metadata_scoped' && expectedSources.length === 0) {
    if (retrievedContexts.length === 0) {
      return { classification: 'correct', cause: null };
    }
    return { classification: 'wrong', cause: 'bad_metadata_filter' };
  }

  // Normal retrieval — check if expected sources are in results
  if (retrievedContexts.length === 0) {
    return { classification: 'no_retrieval', cause: 'missing_knowledge' };
  }

  const retrievedSourceIds = new Set(retrievedContexts.map(c => c.sourceId));
  const expectedSet = new Set(expectedSources);
  const found = [...expectedSet].filter(s => retrievedSourceIds.has(s));

  if (found.length === expectedSet.size) {
    return { classification: 'correct', cause: null };
  }
  if (found.length > 0) {
    return { classification: 'partial', cause: 'insufficient_context' };
  }

  // Check if different sources were retrieved
  if (retrievedContexts.length > 0) {
    return { classification: 'wrong', cause: 'shared_terminology' };
  }
  return { classification: 'no_retrieval', cause: 'missing_knowledge' };
}

// ==================== METRIC AGGREGATION ====================

function aggregateMetrics(results: SampleEvalResult[]): AggregatedMetrics {
  const metrics = ['faithfulness', 'answerRelevancy', 'contextPrecision', 'contextRecall'] as const;
  const agg: any = {};

  for (const m of metrics) {
    const scores = results
      .map(r => r.metrics[m]?.score)
      .filter((s): s is number => s !== null && s !== undefined);

    if (scores.length === 0) {
      agg[m] = { average: 0, min: 0, max: 0, count: 0 };
    } else {
      agg[m] = {
        average: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 1000,
        min: Math.round(Math.min(...scores) * 1000) / 1000,
        max: Math.round(Math.max(...scores) * 1000) / 1000,
        count: scores.length,
      };
    }
  }

  return agg as AggregatedMetrics;
}

// ==================== REPORT GENERATION ====================

function generateMarkdownReport(report: EvalReport): string {
  const lines: string[] = [];
  const { config, overallMetrics, perCategory, retrievalAnalysis, gateAnalysis, sampleResults } = report;

  const modeLabel = config.retrievalMode === 'advanced' ? 'Advanced RAG' : 'Baseline';
  lines.push(`# RAG Evaluation Report — ${modeLabel}`);
  lines.push('');
  lines.push('> RAG evaluation based on RAGAS methodology.');
  lines.push('> This is NOT an official RAGAS implementation.');
  lines.push('');

  // Config
  lines.push('## Configuration');
  lines.push('');
  lines.push('| Parameter | Value |');
  lines.push('|-----------|-------|');
  lines.push(`| Evaluation ID | ${config.evaluationId} |`);
  lines.push(`| Dataset Version | ${config.datasetVersion} |`);
  lines.push(`| **Retrieval Mode** | **${config.retrievalMode}** |`);
  lines.push(`| LLM Model | ${config.config.llmModel} |`);
  lines.push(`| Embedding Model | ${config.config.embeddingModel} |`);
  lines.push(`| Embedding Dimension | ${config.config.embeddingDimension} |`);
  lines.push(`| Retrieval TopK | ${config.config.retrievalTopK} |`);
  lines.push(`| Relevance Threshold | ${config.config.relevanceThreshold} |`);
  lines.push(`| Chunk Size | ${config.config.chunkSize} |`);
  lines.push(`| Judge Prompt Version | ${config.config.judgePromptVersion} |`);
  if (config.retrievalMode === 'advanced') {
    lines.push(`| Dense TopN | ${config.config.advancedDenseTopN} |`);
    lines.push(`| Lexical TopN | ${config.config.advancedLexicalTopN} |`);
    lines.push(`| RRF K | ${config.config.rrfK} |`);
    lines.push(`| Fused TopM | ${config.config.rrfFusedTopM} |`);
    lines.push(`| Final TopK | ${config.config.advancedFinalTopK} |`);
    lines.push(`| Rerank Weights | ${config.config.rerankWeights} |`);
    lines.push(`| Rerank Threshold | ${config.config.advancedRerankThreshold} |`);
  }
  lines.push(`| Total Samples | ${config.totalSamples} |`);
  lines.push(`| Timestamp | ${config.timestamp} |`);
  lines.push('');

  // Overall metrics
  lines.push('## Overall Metrics');
  lines.push('');
  lines.push('| Metric | Average | Min | Max | Count |');
  lines.push('|--------|---------|-----|-----|-------|');
  for (const [name, data] of Object.entries(overallMetrics)) {
    lines.push(`| ${name} | ${data.average} | ${data.min} | ${data.max} | ${data.count} |`);
  }
  lines.push('');

  // Per-category
  lines.push('## Per-Category Metrics');
  lines.push('');
  for (const cat of perCategory) {
    lines.push(`### ${cat.category} (${cat.sampleCount} samples)`);
    lines.push('');
    lines.push('| Metric | Average | Min | Max |');
    lines.push('|--------|---------|-----|-----|');
    for (const [name, data] of Object.entries(cat.metrics)) {
      if (data.count > 0) {
        lines.push(`| ${name} | ${data.average} | ${data.min} | ${data.max} |`);
      }
    }
    lines.push('');
  }

  // Retrieval analysis
  lines.push('## Retrieval Error Analysis');
  lines.push('');
  lines.push('| Classification | Count |');
  lines.push('|---------------|-------|');
  for (const [cls, count] of Object.entries(retrievalAnalysis)) {
    lines.push(`| ${cls} | ${count} |`);
  }
  lines.push('');

  // Gate analysis
  lines.push('## Relevance Gate Analysis (threshold=0.56)');
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Relevant samples survived gate | ${gateAnalysis.relevantSurvivedGate} |`);
  lines.push(`| Irrelevant samples rejected by gate | ${gateAnalysis.irrelevantRejectedByGate} |`);
  lines.push(`| Ambiguous remaining | ${gateAnalysis.ambiguousRemaining} |`);
  lines.push('');

  // Representative examples
  lines.push('## Representative Examples');
  lines.push('');

  const categories = ['correct', 'no_retrieval', 'wrong'] as const;
  for (const cls of categories) {
    const example = sampleResults.find(r => r.retrievalClassification === cls);
    if (example) {
      lines.push(`### ${cls} retrieval: ${example.sampleId}`);
      lines.push('');
      lines.push(`- **Question**: ${example.question}`);
      lines.push(`- **Category**: ${example.category}`);
      lines.push(`- **Retrieval**: ${example.retrievalClassification}`);
      lines.push(`- **Chunks retrieved**: ${example.ragResult.totalChunksRetrieved}`);
      lines.push(`- **Top score**: ${example.ragResult.topScore}`);
      if (example.metrics.faithfulness) {
        lines.push(`- **Faithfulness**: ${example.metrics.faithfulness.score}`);
      }
      if (example.metrics.answerRelevancy) {
        lines.push(`- **Answer Relevancy**: ${example.metrics.answerRelevancy.score}`);
      }
      lines.push(`- **Answer** (first 200 chars): ${example.ragResult.generatedAnswer.substring(0, 200)}...`);
      lines.push('');
    }
  }

  // Cost
  lines.push('## Cost');
  lines.push('');
  lines.push(`- Total Gemini calls: ${report.totalGeminiCalls}`);
  lines.push(`- Total time: ${Math.round(report.totalTimeMs / 1000)}s`);
  lines.push('');

  // Verdict
  lines.push('## Verdict');
  lines.push('');
  const hasRetrievalResults = sampleResults.length > 0;
  const hasGenerationMetrics = overallMetrics.faithfulness.count > 0
    && overallMetrics.answerRelevancy.count > 0
    && overallMetrics.contextPrecision.count > 0
    && overallMetrics.contextRecall.count > 0;

  lines.push('```');
  if (hasRetrievalResults) {
    lines.push('✅ Retrieval Baseline Established (Baseline v1)');
  } else {
    lines.push('❌ Retrieval Baseline Not Established');
  }
  if (hasGenerationMetrics) {
    lines.push('✅ Full RAG / Generation Baseline Established');
  } else {
    lines.push('⏳ Full RAG / Generation Baseline Pending Gemini API Quota');
  }
  lines.push('❌ Advanced RAG — Not Implemented');
  lines.push('```');

  if (hasRetrievalResults && !hasGenerationMetrics) {
    lines.push('');
    lines.push('### Generation Baseline Status');
    lines.push('');
    lines.push('- Faithfulness: count=0 (not yet measured)');
    lines.push('- Answer Relevancy: count=0 (not yet measured)');
    lines.push('- Context Precision: count=0 (not yet measured)');
    lines.push('- Context Recall: count=0 (not yet measured)');
    lines.push('- Run `run-eval.bat --full` when Gemini API quota resets');
  }

  lines.push('');
  lines.push('### Known Limitations');
  lines.push('');
  lines.push('- 23 samples is sufficient for baseline comparison, NOT for production reliability claims');
  lines.push('- LLM judge uses same model family as generator (potential self-bias)');
  lines.push('- Knowledge base uses evaluation fixtures, not real video lesson transcripts');
  lines.push('- Shared-terminology queries may produce borderline retrieval scores');

  lines.push('');
  lines.push('### Candidate Improvements for Advanced RAG (Not Implemented)');
  lines.push('');
  lines.push('- OOK false positives (scores 0.58–0.61 passing gate)');
  lines.push('- Shared-vocabulary leakage ("branch" overlap)');
  lines.push('- Metadata filter cross-topic leakage');
  lines.push('- BM25 / Hybrid Search / RRF / Cross-Encoder / Reranker / HyDE not implemented');

  return lines.join('\n');
}

// ==================== MAIN ====================

async function main() {
  const args = process.argv.slice(2);
  const validateOnly = args.includes('--validate');
  const retrievalOnly = args.includes('--retrieval-only');
  const fullRun = args.includes('--full');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;
  const categoryIdx = args.indexOf('--category');
  const filterCategory = categoryIdx >= 0 ? args[categoryIdx + 1] as EvalCategory : undefined;
  const modeIdx = args.indexOf('--mode');
  const retrievalMode = modeIdx >= 0 ? args[modeIdx + 1] as 'dense' | 'advanced' : undefined;

  // Override env if --mode specified
  if (retrievalMode) {
    process.env.RAG_RETRIEVAL_MODE = retrievalMode;
  }
  const activeMode = process.env.RAG_RETRIEVAL_MODE || 'dense';

  console.log('========================================================');
  console.log('   RAG EVALUATION');
  console.log(`   Mode: ${activeMode.toUpperCase()}`);
  console.log('   Based on RAGAS methodology');
  console.log('========================================================\n');

  // Load dataset and fixtures
  const fixtures = loadFixtures();
  const dataset = loadDataset();
  console.log(`Loaded ${dataset.samples.length} samples, ${fixtures.length} fixtures\n`);

  // ---- PHASE 0: Validate ----
  console.log('--- PHASE 0: Dataset Validation ---');
  const validation = validateDataset(dataset, fixtures);
  if (!validation.valid) {
    console.error('\n❌ Dataset validation FAILED:');
    for (const err of validation.errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  console.log('\n✅ Dataset validation PASSED\n');

  if (validateOnly) {
    console.log('--validate mode: stopping after validation.');
    await prisma.$disconnect();
    return;
  }

  // Filter samples
  let samples = [...dataset.samples];
  if (filterCategory) {
    samples = samples.filter(s => s.category === filterCategory);
    console.log(`Filtered to category '${filterCategory}': ${samples.length} samples`);
  }
  if (limit) {
    samples = samples.slice(0, limit);
    console.log(`Limited to ${samples.length} samples`);
  }
  if (!fullRun && !limit && !filterCategory) {
    console.log('⚠️  No mode specified. Use --full, --limit N, or --category CAT');
    console.log('    Running smoke test with --limit 3');
    samples = samples.slice(0, 3);
  }

  // Init RAG
  initializeGemini();
  const config = loadRAGConfig();
  const rag = RAGService.getInstance();
  await rag.initialize();
  const generation = new RAGGenerationService();

  // ---- PHASE 1: Ingest Fixtures ----
  console.log('\n--- PHASE 1: Knowledge Fixture Ingestion ---');
  const ingestedDocs: { id: string; sourceId: string }[] = [];

  for (const fixture of fixtures) {
    try {
      const doc = await rag.ingest(
        'LESSON',
        fixture.sourceId,
        fixture.content,
        fixture.title,
        fixture.metadata,
      );
      ingestedDocs.push({ id: doc.id, sourceId: fixture.sourceId });
      console.log(`  ✅ Ingested: ${fixture.title} (${doc.chunkCount} chunks)`);
    } catch (e: any) {
      // May already exist
      console.log(`  ⚠️ ${fixture.title}: ${e.message}`);
    }
  }
  console.log('');

  // ---- PHASE 2 & 3: RAG Evaluation + Metrics ----
  console.log('--- PHASE 2-3: RAG Evaluation + Metrics ---');
  resetGeminiCallCount();
  const startTime = Date.now();
  const sampleResults: SampleEvalResult[] = [];

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    console.log(`\n[${i + 1}/${samples.length}] ${sample.id} (${sample.category})`);
    console.log(`  Q: "${sample.question.substring(0, 80)}..."`);

    // Run RAG pipeline
    const ragResult = await runRAGPipeline(rag, generation, sample, retrievalOnly);
    console.log(`  Retrieved: ${ragResult.totalChunksRetrieved} chunks, top=${ragResult.topScore}`);
    console.log(`  Answer: ${ragResult.generatedAnswer.substring(0, 100)}...`);

    // Classify retrieval
    const { classification, cause } = classifyRetrieval(ragResult);
    console.log(`  Retrieval: ${classification}${cause ? ` (${cause})` : ''}`);

    // Compute metrics (unless retrieval-only)
    let faithfulness = null;
    let answerRelevancy = null;
    let contextPrecision = null;
    let contextRecall = null;

    if (!retrievalOnly) {
      const contexts = ragResult.retrievedContexts.map(c => c.content);

      // Faithfulness
      if (contexts.length > 0) {
        faithfulness = await computeFaithfulness(ragResult.generatedAnswer, contexts);
        console.log(`  Faithfulness: ${faithfulness.score}`);
      }

      // Answer Relevancy
      answerRelevancy = await computeAnswerRelevancy(sample.question, ragResult.generatedAnswer);
      console.log(`  Answer Relevancy: ${answerRelevancy.score}`);

      // Context Precision
      if (contexts.length > 0) {
        contextPrecision = await computeContextPrecision(sample.question, contexts);
        console.log(`  Context Precision: ${contextPrecision.score}`);
      }

      // Context Recall (requires ground truth)
      if (sample.groundTruth && contexts.length > 0) {
        contextRecall = await computeContextRecall(sample.groundTruth, contexts);
        console.log(`  Context Recall: ${contextRecall.score}`);
      }
    }

    sampleResults.push({
      sampleId: sample.id,
      category: sample.category,
      question: sample.question,
      ragResult,
      metrics: { faithfulness, answerRelevancy, contextPrecision, contextRecall },
      retrievalClassification: classification,
      retrievalCause: cause,
    });
  }

  const totalTimeMs = Date.now() - startTime;
  const totalGeminiCalls = getGeminiCallCount();

  // ---- PHASE 4: Generate Report ----
  console.log('\n--- PHASE 4: Report Generation ---');

  const overallMetrics = aggregateMetrics(sampleResults);

  // Per-category metrics
  const categorySet = new Set(sampleResults.map(r => r.category));
  const perCategory: CategoryMetrics[] = [...categorySet].map(cat => {
    const catResults = sampleResults.filter(r => r.category === cat);
    return {
      category: cat,
      sampleCount: catResults.length,
      metrics: aggregateMetrics(catResults),
    };
  });

  // Retrieval analysis
  const retrievalAnalysis = {
    correct: sampleResults.filter(r => r.retrievalClassification === 'correct').length,
    partial: sampleResults.filter(r => r.retrievalClassification === 'partial').length,
    wrong: sampleResults.filter(r => r.retrievalClassification === 'wrong').length,
    noRetrieval: sampleResults.filter(r => r.retrievalClassification === 'no_retrieval').length,
    ambiguous: sampleResults.filter(r => r.retrievalClassification === 'ambiguous').length,
  };

  // Gate analysis
  const relevantSamples = sampleResults.filter(s =>
    !['out_of_knowledge', 'similar_but_unrelated'].includes(s.category)
    && s.ragResult.expectedSources.length > 0,
  );
  const irrelevantSamples = sampleResults.filter(s =>
    ['out_of_knowledge', 'similar_but_unrelated'].includes(s.category),
  );
  const metadataWrongFilter = sampleResults.filter(s =>
    s.category === 'metadata_scoped' && s.ragResult.expectedSources.length === 0,
  );

  const gateAnalysis = {
    relevantSurvivedGate: relevantSamples.filter(r => r.ragResult.totalChunksRetrieved > 0).length,
    irrelevantRejectedByGate: irrelevantSamples.filter(r => r.ragResult.totalChunksRetrieved === 0).length
      + metadataWrongFilter.filter(r => r.ragResult.totalChunksRetrieved === 0).length,
    ambiguousRemaining: irrelevantSamples.filter(r => r.ragResult.totalChunksRetrieved > 0).length,
  };

  const evalConfig: EvalConfig = {
    evaluationId: `eval-${new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)}`,
    datasetVersion: dataset.version,
    retrievalMode: activeMode as 'dense' | 'advanced',
    config: {
      llmModel: process.env.GEMINI_MODEL || 'unknown',
      embeddingModel: config.embeddingModel,
      embeddingDimension: config.embeddingDimension,
      retrievalTopK: config.retrievalTopK,
      relevanceThreshold: config.retrievalScoreThreshold,
      maxContextTokens: config.maxContextTokens,
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
      judgeTemperature: 0,
      judgePromptVersion: JUDGE_PROMPT_VERSION,
      ...(activeMode === 'advanced' ? {
        advancedDenseTopN: config.advancedDenseTopN,
        advancedLexicalTopN: config.advancedLexicalTopN,
        rrfK: config.rrfK,
        rrfFusedTopM: config.rrfFusedTopM,
        advancedFinalTopK: config.advancedFinalTopK,
        rerankWeights: `d=${config.rerankWeightDense} l=${config.rerankWeightLexical} r=${config.rerankWeightRRF}`,
        advancedRerankThreshold: config.advancedRerankThreshold,
      } : {}),
    },
    timestamp: new Date().toISOString(),
    totalSamples: sampleResults.length,
  };

  const report: EvalReport = {
    config: evalConfig,
    overallMetrics,
    perCategory,
    retrievalAnalysis,
    gateAnalysis,
    sampleResults,
    totalGeminiCalls,
    totalTimeMs,
  };

  // Save reports to mode-specific directory
  const reportsDir = path.join(__dirname, 'reports', activeMode === 'advanced' ? 'advanced-v1' : 'baseline-v1');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const jsonPath = path.join(reportsDir, 'evaluation-results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`  Saved JSON: ${jsonPath}`);

  const mdPath = path.join(reportsDir, 'evaluation-report.md');
  fs.writeFileSync(mdPath, generateMarkdownReport(report));
  console.log(`  Saved MD: ${mdPath}`);

  // ---- PHASE 5: Cleanup ----
  console.log('\n--- PHASE 5: Cleanup ---');
  for (const doc of ingestedDocs) {
    try {
      await rag.deleteDocument(doc.id);
      console.log(`  Deleted: ${doc.sourceId} (${doc.id})`);
    } catch (e: any) {
      console.log(`  ⚠️ Failed to delete ${doc.sourceId}: ${e.message}`);
    }
  }

  // ---- FINAL SUMMARY ----
  console.log('\n========================================================');
  console.log('   EVALUATION SUMMARY');
  console.log('========================================================\n');

  console.log(`  Samples: ${sampleResults.length}`);
  console.log(`  Gemini calls: ${totalGeminiCalls}`);
  console.log(`  Time: ${Math.round(totalTimeMs / 1000)}s\n`);

  console.log('  RAGAS-style Metrics:');
  console.log(`    Faithfulness:       ${overallMetrics.faithfulness.average}`);
  console.log(`    Answer Relevancy:   ${overallMetrics.answerRelevancy.average}`);
  console.log(`    Context Precision:  ${overallMetrics.contextPrecision.average}`);
  console.log(`    Context Recall:     ${overallMetrics.contextRecall.average}`);

  console.log('\n  Retrieval Analysis:');
  console.log(`    Correct:      ${retrievalAnalysis.correct}`);
  console.log(`    Partial:      ${retrievalAnalysis.partial}`);
  console.log(`    Wrong:        ${retrievalAnalysis.wrong}`);
  console.log(`    No Retrieval: ${retrievalAnalysis.noRetrieval}`);

  console.log('\n  Gate Analysis:');
  console.log(`    Relevant survived:   ${gateAnalysis.relevantSurvivedGate}`);
  console.log(`    Irrelevant rejected: ${gateAnalysis.irrelevantRejectedByGate}`);
  console.log(`    Ambiguous:           ${gateAnalysis.ambiguousRemaining}`);

  const hasRetrievalResults = sampleResults.length > 0;
  const hasGenerationMetrics = overallMetrics.faithfulness.count > 0
    && overallMetrics.answerRelevancy.count > 0
    && overallMetrics.contextPrecision.count > 0
    && overallMetrics.contextRecall.count > 0;

  console.log('\n========================================================');
  console.log('   VERDICT');
  console.log('========================================================');
  if (activeMode === 'advanced') {
    if (hasRetrievalResults) {
      console.log(`   ✅ Advanced RAG Retrieval Evaluated (${retrievalAnalysis.correct}/${sampleResults.length} correct)`);
    } else {
      console.log('   ❌ Advanced RAG Retrieval Not Evaluated');
    }
  } else {
    if (hasRetrievalResults) {
      console.log('   ✅ Retrieval Baseline Established (Baseline v1)');
    } else {
      console.log('   ❌ Retrieval Baseline Not Established');
    }
  }
  if (hasGenerationMetrics) {
    console.log('   ✅ Full RAG / Generation Baseline Established');
  } else {
    console.log('   ⏳ Full RAG / Generation Baseline Pending (metrics count=0)');
  }
  console.log('========================================================\n');

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
