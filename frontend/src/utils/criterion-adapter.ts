import { CriterionResult, StageResult, EvidenceChunkRef } from '../services/learning.service';

// ==================== Unified ViewModel ====================

/**
 * CriterionResultViewModel — unified format for frontend rendering.
 * Normalizes both legacy StageResult and Phase 2 CriterionResult
 * into a single format that the UI can render consistently.
 */
export interface CriterionResultViewModel {
  // Identity
  id: string;           // criterionId (Phase 2) or stageNumber as string (legacy)
  title: string;

  // Criterion config snapshot (from evaluation time, NOT current rubric)
  objective?: string;
  criteria?: string;
  passCriteria?: string;

  // Score breakdown
  score: number;
  maxScore: number;
  weight?: number;
  weightedScore: number;
  /** Percentage score for this criterion: (score / maxScore) * 100 */
  scorePercent: number;
  passed: boolean;

  // AI analysis — always arrays (empty if not available)
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  feedback: string;

  // Evidence references (Phase 2 only)
  evidenceUsed: EvidenceChunkRef[];

  // Legacy details (only present in old submissions)
  legacyDetails?: string[];

  // Source format for debugging
  _source: 'criterion' | 'legacy';
}

// ==================== Type Guards ====================

/**
 * Check if a result is a Phase 2 CriterionResult (has criterionId and strengths)
 */
function isCriterionResult(result: CriterionResult | StageResult): result is CriterionResult {
  return 'criterionId' in result && 'strengths' in result;
}

// ==================== Normalize Function ====================

/**
 * Normalize a single result (legacy or Phase 2) into CriterionResultViewModel.
 * 
 * Legacy StageResult format:
 *   { stageNumber, title, score, maxScore, weightedScore, passed, feedback, details }
 *   → details get split into strengths/weaknesses/suggestions by emoji prefix
 * 
 * Phase 2 CriterionResult format:
 *   { criterionId, title, score, maxScore, weight, weightedScore, passed,
 *     evidenceUsed, strengths, weaknesses, feedback, suggestions,
 *     objective, criteria, passCriteria }
 *   → used directly
 */
export function normalizeCriterionResult(result: CriterionResult | StageResult): CriterionResultViewModel {
  if (isCriterionResult(result)) {
    // Phase 2 CriterionResult — use directly
    return {
      id: result.criterionId,
      title: result.title,
      objective: result.objective,
      criteria: result.criteria,
      passCriteria: result.passCriteria,
      score: result.score,
      maxScore: result.maxScore,
      weight: result.weight,
      weightedScore: result.weightedScore,
      scorePercent: result.maxScore > 0 ? Math.round((result.score / result.maxScore) * 100) : 0,
      passed: result.passed,
      strengths: result.strengths || [],
      weaknesses: result.weaknesses || [],
      suggestions: result.suggestions || [],
      feedback: result.feedback || '',
      evidenceUsed: result.evidenceUsed || [],
      _source: 'criterion',
    };
  }

  // Legacy StageResult — parse details[] into strengths/weaknesses/suggestions
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const suggestions: string[] = [];
  const otherDetails: string[] = [];

  if (result.details && Array.isArray(result.details)) {
    for (const detail of result.details) {
      const trimmed = detail.trim();
      if (trimmed.startsWith('✅')) {
        strengths.push(trimmed.replace(/^✅\s*/, ''));
      } else if (trimmed.startsWith('❌')) {
        weaknesses.push(trimmed.replace(/^❌\s*/, ''));
      } else if (trimmed.startsWith('💡')) {
        suggestions.push(trimmed.replace(/^💡\s*/, ''));
      } else {
        otherDetails.push(trimmed);
      }
    }
  }

  return {
    id: String(result.stageNumber),
    title: result.title,
    score: result.score,
    maxScore: result.maxScore,
    weightedScore: result.weightedScore,
    scorePercent: result.maxScore > 0 ? Math.round((result.score / result.maxScore) * 100) : 0,
    passed: result.passed,
    strengths,
    weaknesses,
    suggestions,
    feedback: result.feedback || '',
    evidenceUsed: [],
    legacyDetails: otherDetails.length > 0 ? otherDetails : undefined,
    _source: 'legacy',
  };
}

/**
 * Normalize an entire array of results (mixed legacy + Phase 2).
 */
export function normalizeAllCriterionResults(
  results: (CriterionResult | StageResult)[] | undefined
): CriterionResultViewModel[] {
  if (!results || !Array.isArray(results)) return [];
  return results.map(normalizeCriterionResult);
}

// ==================== Processing Status Helpers ====================

export type ProcessingStatusType =
  | 'UPLOADED'
  | 'ANALYZING'
  | 'ANALYSIS_FAILED'
  | 'READY_FOR_EVALUATION'
  | 'EVALUATING'
  | 'COMPLETED'
  | 'FAILED';

export interface ProcessingPipelineStep {
  key: ProcessingStatusType | 'SUBMITTED';
  label: string;
  status: 'completed' | 'active' | 'pending' | 'error';
}

/**
 * Build the processing pipeline steps for UI display.
 * Returns an array of steps with their current status.
 */
export function getProcessingPipelineSteps(
  processingStatus?: string,
  submissionStatus?: string
): ProcessingPipelineStep[] {
  const isGraded = submissionStatus === 'GRADED';
  const status = processingStatus || '';

  // Define the pipeline order
  const steps: ProcessingPipelineStep[] = [
    { key: 'SUBMITTED', label: 'Đã nộp bài', status: 'pending' },
    { key: 'ANALYZING', label: 'Phân tích project', status: 'pending' },
    { key: 'READY_FOR_EVALUATION', label: 'Sẵn sàng đánh giá', status: 'pending' },
    { key: 'EVALUATING', label: 'AI đang chấm điểm', status: 'pending' },
    { key: 'COMPLETED', label: 'Hoàn thành', status: 'pending' },
  ];

  // Map processing status to step index
  const statusToStepIndex: Record<string, number> = {
    'UPLOADED': 1,      // After submit, before analyzing
    'ANALYZING': 1,
    'READY_FOR_EVALUATION': 2,
    'EVALUATING': 3,
    'COMPLETED': 4,
  };

  // Handle special cases
  if (isGraded) {
    // All steps completed
    steps.forEach(s => s.status = 'completed');
    return steps;
  }

  if (status === 'ANALYSIS_FAILED') {
    steps[0].status = 'completed';
    steps[1].status = 'error';
    return steps;
  }

  if (status === 'FAILED') {
    steps[0].status = 'completed';
    steps[1].status = 'completed';
    steps[2].status = 'completed';
    steps[3].status = 'error';
    return steps;
  }

  // Normal progression
  const currentStepIndex = statusToStepIndex[status] ?? 0;

  steps.forEach((step, index) => {
    if (index < currentStepIndex) {
      step.status = 'completed';
    } else if (index === currentStepIndex) {
      step.status = status === 'READY_FOR_EVALUATION' ? 'completed' : 'active';
    }
    // else remains 'pending'
  });

  // Step 0 (Submitted) is always completed if we have any status
  steps[0].status = 'completed';

  return steps;
}

/**
 * Get a human-readable label for a processing status
 */
export function getProcessingStatusLabel(status?: string): string {
  const labels: Record<string, string> = {
    'UPLOADED': 'Đã tải lên',
    'ANALYZING': 'Đang phân tích project...',
    'ANALYSIS_FAILED': 'Phân tích thất bại',
    'READY_FOR_EVALUATION': 'Sẵn sàng đánh giá',
    'EVALUATING': 'AI đang chấm điểm...',
    'COMPLETED': 'Đã hoàn thành',
    'FAILED': 'Đánh giá thất bại',
  };
  return labels[status || ''] || '';
}
