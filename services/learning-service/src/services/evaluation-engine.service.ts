import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import logger from '../utils/logger';
import {
  ProjectContext,
  EvaluationStage,
  CriterionResult,
  ProjectEvaluationResult,
  AggregatedScore,
  AICriterionResponse,
  EvidenceChunkRef,
  EvidencePackage,
  ProcessingStatus,
} from '../types';
import { EvidenceRetrieverService } from './evidence-retriever.service';
import { SkillMappingService } from './skill-mapping.service';
import { SkillProfileService } from './skill-profile.service';

const prisma = new PrismaClient();

/**
 * EvaluationEngineService — Orchestrator cho toàn bộ quá trình đánh giá
 * 
 * Flow:
 * 1. Load submission + projectContext + rubric (evaluationPipeline)
 * 2. Cho mỗi criterion:
 *    a. Evidence Retriever → tìm evidence từ Project Context
 *    b. Format evidence → gửi AI Service (POST /api/ai/evaluate-criterion)
 *    c. Nhận kết quả AI → Backend tính passed từ passCriteria
 * 3. Score Aggregator → tính điểm tổng weighted
 * 4. Generate comprehensive feedback report
 * 5. Lưu ProjectEvaluation + cập nhật submission status
 */
export class EvaluationEngineService {

  /**
   * Main pipeline — Đánh giá toàn bộ project
   */
  static async evaluateProject(submissionId: string, token?: string): Promise<ProjectEvaluationResult> {
    logger.info(`[EvaluationEngine] Starting evaluation for submission: ${submissionId}`);

    // 1. Load submission with project data
    const submission = await prisma.finalProjectSubmission.findUnique({
      where: { id: submissionId },
      include: { finalProject: true },
    });

    if (!submission) throw new Error('Submission không tồn tại');
    if (!submission.projectContext) throw new Error('Project chưa được phân tích. Vui lòng phân tích trước khi đánh giá.');

    const project = submission.finalProject;
    const pipeline = (project.evaluationPipeline as any[]) || [];

    if (pipeline.length === 0) {
      throw new Error('Bài kiểm tra chưa được cấu hình Evaluation Pipeline (Rubric)');
    }

    const projectContext = submission.projectContext as unknown as ProjectContext;
    const passingScore = project.passingScore || 80;

    const projectInfo = {
      title: project.title,
      description: project.description,
      instructions: (project as any).instructions || '',
      objectives: (project as any).objectives || '',
    };

    try {
      // 3. Evaluate each criterion
      const criterionResults = await this.evaluateAllCriteria(
        pipeline as EvaluationStage[],
        projectContext,
        projectInfo,
        token
      );

      // 4. Score aggregation — Backend tính passed, KHÔNG phải AI
      const aggregated = this.aggregateScores(criterionResults, passingScore);

      // 5. Generate comprehensive feedback
      const feedbackReport = await this.generateFeedbackReport(
        criterionResults,
        projectInfo,
        aggregated.totalScore,
        passingScore,
        aggregated.passed,
        token
      );

      // 6. Build final result
      const passedCriteria = criterionResults.filter(r => r.passed).map(r => r.title);
      const failedCriteria = criterionResults.filter(r => !r.passed).map(r => r.title);
      const overallStrengths = this.collectOverallItems(criterionResults, 'strengths');
      const overallWeaknesses = this.collectOverallItems(criterionResults, 'weaknesses');

      const evaluationResult: ProjectEvaluationResult = {
        totalScore: aggregated.totalScore,
        passingScore,
        passed: aggregated.passed,
        criterionResults,
        passedCriteria,
        failedCriteria,
        overallStrengths,
        overallWeaknesses,
        feedbackReport,
      };

      // 7. Save ProjectEvaluation
      const evaluationId = await this.saveEvaluation(submissionId, submission.learningPathId, submission.userId, evaluationResult);

      // 8. Phase 3: Update Skill Profile
      try {
        const learningPath = await prisma.learningPath.findUnique({
          where: { id: submission.learningPathId },
          select: { skills: true }
        });
        const pathSkills = learningPath?.skills || [];
        
        const skillUpdates = SkillMappingService.mapEvaluationToSkills(
          criterionResults, pathSkills, evaluationId, pipeline as EvaluationStage[]
        );
        await SkillProfileService.updateFromEvaluation(
          submission.userId, skillUpdates, overallStrengths, overallWeaknesses
        );
        logger.info(`[EvaluationEngine] Skill profile updated for user: ${submission.userId}`);
      } catch (skillErr: any) {
        // Non-blocking: skill profile update failure should not fail the evaluation
        logger.warn(`[EvaluationEngine] Skill profile update failed (non-blocking): ${skillErr.message}`);
      }

      // 9. Update submission status
      await prisma.finalProjectSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'GRADED',
          processingStatus: ProcessingStatus.COMPLETED,
          totalScore: aggregated.totalScore,
          score: aggregated.totalScore,
          aiFeedback: feedbackReport,
          stageResults: JSON.parse(JSON.stringify(criterionResults)),
          gradedAt: new Date(),
        },
      });

      logger.info(`[EvaluationEngine] Evaluation complete: score=${aggregated.totalScore}%, passed=${aggregated.passed}`);
      return evaluationResult;

    } catch (error: any) {
      logger.error('[EvaluationEngine] Evaluation failed:', error);
      throw error;
    }
  }

  /**
   * Evaluate all criteria sequentially
   * Mỗi criterion: Evidence Retriever → AI → Backend tính passed
   */
  static async evaluateAllCriteria(
    pipeline: EvaluationStage[],
    projectContext: ProjectContext,
    projectInfo: { title: string; description: string; instructions: string; objectives: string },
    token?: string
  ): Promise<CriterionResult[]> {
    const results: CriterionResult[] = [];
    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:3007';

    for (const criterion of pipeline) {
      logger.info(`[EvaluationEngine] Processing criterion ${criterion.stageNumber}: ${criterion.title}`);

      // a. Evidence Retrieval
      const evidencePackage = EvidenceRetrieverService.retrieveEvidence(criterion, projectContext);
      const evidenceText = EvidenceRetrieverService.formatEvidenceForPrompt(evidencePackage);
      const overviewText = evidencePackage.overview;

      // b. Generate criterionId (use stageNumber as string if no real ID)
      const criterionId = String(criterion.stageNumber);

      // c. Call AI Service to evaluate this criterion
      let aiResponse: AICriterionResponse;
      try {
        const response = await axios.post(`${aiServiceUrl}/api/ai/evaluate-criterion`, {
          criterionConfig: {
            criterionId,
            title: criterion.title,
            objective: criterion.objective,
            criteria: criterion.criteria,
            maxScore: criterion.maxScore,
            passCriteria: criterion.passCriteria,
            expectedOutput: criterion.expectedOutput,
          },
          evidence: evidenceText,
          projectOverview: overviewText,
          projectInfo,
        }, {
          headers: token ? { Authorization: token } : undefined,
          timeout: 120000, // 2 minutes per criterion
        });

        aiResponse = response.data?.data || response.data;
      } catch (aiError: any) {
        logger.error(`[EvaluationEngine] AI evaluation failed for criterion "${criterion.title}":`, aiError.message);
        aiResponse = {
          score: 0,
          evidenceUsed: [],
          strengths: [],
          weaknesses: ['❌ Lỗi khi gọi AI đánh giá tiêu chí này.'],
          feedback: 'Không thể đánh giá tiêu chí này do lỗi hệ thống.',
          suggestions: ['Vui lòng thử lại.'],
        };
      }

      // d. Backend tính passed từ passCriteria — KHÔNG dùng AI passed
      const passed = this.evaluatePassCriteria(aiResponse.score, criterion.maxScore, criterion.passCriteria);

      // e. Tính weighted score
      const weightedScore = Math.round(((aiResponse.score / criterion.maxScore) * criterion.weight * 100) * 100) / 100;

      // f. Resolve evidence references (map AI's chunkId refs to full EvidenceChunkRef)
      const evidenceUsed = this.resolveEvidenceRefs(aiResponse.evidenceUsed, evidencePackage);

      // g. Build CriterionResult (with criterion snapshot)
      const result: CriterionResult = {
        // Snapshot cấu hình criterion
        criterionId,
        title: criterion.title,
        maxScore: criterion.maxScore,
        weight: criterion.weight,
        passCriteria: criterion.passCriteria,
        objective: criterion.objective,
        criteria: criterion.criteria,

        // Kết quả đánh giá
        score: aiResponse.score,
        weightedScore,
        passed,

        // Evidence
        evidenceUsed,

        // AI analysis
        strengths: aiResponse.strengths,
        weaknesses: aiResponse.weaknesses,
        feedback: aiResponse.feedback,
        suggestions: aiResponse.suggestions,
      };

      results.push(result);
      logger.info(`[EvaluationEngine] Criterion "${criterion.title}": score=${aiResponse.score}/${criterion.maxScore}, passed=${passed}`);
    }

    return results;
  }

  /**
   * Backend tính passed từ passCriteria string
   * Supports: ">= 70", ">= 70%", "> 50", "pass", etc.
   */
  static evaluatePassCriteria(score: number, maxScore: number, passCriteria: string): boolean {
    const criteria = passCriteria.trim().toLowerCase();

    // Parse ">= X" or ">= X%"
    const percentMatch = criteria.match(/>=?\s*(\d+(?:\.\d+)?)\s*%/);
    if (percentMatch) {
      const threshold = parseFloat(percentMatch[1]);
      const percentage = (score / maxScore) * 100;
      return criteria.includes('>=') ? percentage >= threshold : percentage > threshold;
    }

    // Parse ">= X" (absolute score)
    const absMatch = criteria.match(/>=?\s*(\d+(?:\.\d+)?)/);
    if (absMatch) {
      const threshold = parseFloat(absMatch[1]);
      return criteria.includes('>=') ? score >= threshold : score > threshold;
    }

    // Fallback: >= 60% of maxScore
    return score >= (maxScore * 0.6);
  }

  /**
   * Score Aggregator — Tính điểm tổng weighted
   */
  static aggregateScores(criterionResults: CriterionResult[], passingScore: number): AggregatedScore {
    const totalScore = Math.round(
      criterionResults.reduce((sum, r) => sum + r.weightedScore, 0) * 100
    ) / 100;

    const passed = totalScore >= passingScore;

    const criterionScores = criterionResults.map(r => ({
      criterionId: r.criterionId,
      title: r.title,
      score: r.score,
      maxScore: r.maxScore,
      weightedScore: r.weightedScore,
      passed: r.passed,
    }));

    return { totalScore, passed, criterionScores };
  }

  /**
   * Resolve evidence references from AI response to full EvidenceChunkRef
   */
  static resolveEvidenceRefs(
    aiRefs: { chunkId: string; filePath: string }[],
    evidencePackage: EvidencePackage
  ): EvidenceChunkRef[] {
    const chunkMap = new Map(
      evidencePackage.chunks.map(c => [c.chunkId, c])
    );

    return aiRefs
      .map(ref => {
        const chunk = chunkMap.get(ref.chunkId);
        if (chunk) {
          return {
            chunkId: chunk.chunkId,
            filePath: chunk.filePath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
          };
        }
        // If chunkId not found, return with filePath only
        return {
          chunkId: ref.chunkId,
          filePath: ref.filePath,
          startLine: 0,
          endLine: 0,
        };
      })
      .filter(Boolean) as EvidenceChunkRef[];
  }

  /**
   * Generate comprehensive feedback report
   */
  static async generateFeedbackReport(
    criterionResults: CriterionResult[],
    projectInfo: { title: string; description: string; instructions: string; objectives: string },
    totalScore: number,
    passingScore: number,
    passed: boolean,
    token?: string
  ): Promise<string> {
    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:3007';

    try {
      const response = await axios.post(`${aiServiceUrl}/api/ai/generate-evaluation-feedback`, {
        criterionResults: criterionResults.map(r => ({
          title: r.title,
          score: r.score,
          maxScore: r.maxScore,
          passed: r.passed,
          feedback: r.feedback,
          strengths: r.strengths,
          weaknesses: r.weaknesses,
        })),
        projectInfo,
        totalScore,
        passingScore,
        passed,
      }, {
        headers: token ? { Authorization: token } : undefined,
        timeout: 60000,
      });

      return response.data?.data?.feedbackReport || response.data?.feedbackReport || '';
    } catch (error) {
      logger.error('[EvaluationEngine] Failed to generate feedback report:', error);
      return `Tổng điểm: ${Math.round(totalScore)}%. ${passed ? 'Chúc mừng bạn đã đạt!' : 'Bạn cần cải thiện để đạt yêu cầu.'}`;
    }
  }

  /**
   * Collect and deduplicate overall strengths/weaknesses from all criterion results
   */
  static collectOverallItems(results: CriterionResult[], field: 'strengths' | 'weaknesses'): string[] {
    const allItems = results.flatMap(r => r[field]);
    // Deduplicate by similarity (take first 10 unique items)
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const item of allItems) {
      const normalized = item.toLowerCase().trim();
      if (!seen.has(normalized) && unique.length < 10) {
        seen.add(normalized);
        unique.push(item);
      }
    }
    return unique;
  }

  /**
   * Save ProjectEvaluation to database
   */
  static async saveEvaluation(
    submissionId: string,
    learningPathId: string,
    userId: string,
    evaluation: ProjectEvaluationResult
  ): Promise<string> {
    const record = await prisma.projectEvaluation.create({
      data: {
        submissionId,
        learningPathId,
        userId,
        totalScore: evaluation.totalScore,
        passingScore: evaluation.passingScore,
        passed: evaluation.passed,
        criterionResults: JSON.parse(JSON.stringify(evaluation.criterionResults)),
        passedCriteria: evaluation.passedCriteria,
        failedCriteria: evaluation.failedCriteria,
        overallStrengths: evaluation.overallStrengths,
        overallWeaknesses: evaluation.overallWeaknesses,
        feedbackReport: evaluation.feedbackReport,
      },
    });

    logger.info(`[EvaluationEngine] Saved ProjectEvaluation ${record.id} for submission: ${submissionId}`);
    return record.id;
  }
}
