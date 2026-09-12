import logger from '../utils/logger';
import {
  CriterionResult,
  EvaluationStage,
  SkillUpdate,
  SkillEvidence,
} from '../types';

/**
 * SkillMappingService — Map criterion results → skill evidences
 * 
 * Priority:
 * 1. Explicit skillMapping từ rubric (admin cấu hình)
 * 2. LearningPath.skills (skills khai báo cho lộ trình)
 * 3. Rule/keyword matching từ criterion text
 * 
 * KHÔNG tạo skill mới ngoài catalog. Nếu không map được → bỏ qua.
 * Criterion score = evidence, KHÔNG convert trực tiếp sang level.
 */
export class SkillMappingService {

  /**
   * Map tất cả criterion results → skill updates (evidences)
   */
  static mapEvaluationToSkills(
    criterionResults: CriterionResult[],
    pathSkills: string[],
    evaluationId: string,
    pipeline: EvaluationStage[]
  ): SkillUpdate[] {
    const updates: SkillUpdate[] = [];
    const now = new Date().toISOString();

    for (let i = 0; i < criterionResults.length; i++) {
      const result = criterionResults[i];
      const stage = pipeline[i]; // Corresponding pipeline stage

      // Determine skill mappings for this criterion
      const mappings = this.getSkillMappings(stage, pathSkills);

      if (mappings.length === 0) {
        logger.debug(`No skill mapping for criterion: ${result.title}`);
        continue;
      }

      const scorePercentage = result.maxScore > 0
        ? Math.round((result.score / result.maxScore) * 100)
        : 0;

      for (const mapping of mappings) {
        const evidence: SkillEvidence = {
          source: 'PROJECT_EVALUATION',
          sourceId: evaluationId,
          detail: `${result.passed ? 'Đạt' : 'Chưa đạt'} ${scorePercentage}% tiêu chí "${result.title}"`,
          scorePercentage,
          weight: (mapping.weight ?? 1.0) * 1.0, // PROJECT_EVALUATION base weight = 1.0
          date: now,
        };

        updates.push({
          canonicalName: this.canonicalize(mapping.skill),
          displayName: mapping.skill,
          category: mapping.category,
          evidence,
        });
      }
    }

    logger.info(`[SkillMapping] Mapped ${criterionResults.length} criteria → ${updates.length} skill updates`);
    return updates;
  }

  /**
   * Get skill mappings for a criterion
   * Priority: explicit skillMapping → pathSkills match → rule matching
   */
  static getSkillMappings(
    stage: EvaluationStage,
    pathSkills: string[]
  ): { skill: string; category: string; weight: number }[] {
    // Priority 1: Explicit skillMapping from rubric
    if (stage.skillMapping && stage.skillMapping.length > 0) {
      return stage.skillMapping.map(m => ({
        skill: m.skill,
        category: m.category,
        weight: m.weight ?? 1.0,
      }));
    }

    // Priority 2: Match against LearningPath.skills
    const matchedPathSkills = this.matchPathSkills(stage, pathSkills);
    if (matchedPathSkills.length > 0) {
      return matchedPathSkills;
    }

    // Priority 3: Rule/keyword matching from known skill catalog
    return this.matchFromCatalog(stage);
  }

  /**
   * Match criterion against LearningPath.skills
   */
  static matchPathSkills(
    stage: EvaluationStage,
    pathSkills: string[]
  ): { skill: string; category: string; weight: number }[] {
    if (!pathSkills || pathSkills.length === 0) return [];

    const text = `${stage.title} ${stage.objective} ${stage.criteria}`.toLowerCase();
    const matched: { skill: string; category: string; weight: number }[] = [];

    for (const skill of pathSkills) {
      const skillLower = skill.toLowerCase();
      // Check if skill name appears in criterion text
      if (text.includes(skillLower)) {
        const catalogEntry = SKILL_CATALOG.get(this.canonicalize(skill));
        matched.push({
          skill: catalogEntry?.displayName || skill,
          category: catalogEntry?.category || this.inferCategory(skill),
          weight: 0.8, // Slightly lower weight since it's inferred, not explicit
        });
      }
    }

    return matched;
  }

  /**
   * Match criterion against known skill catalog using keyword rules
   */
  static matchFromCatalog(
    stage: EvaluationStage
  ): { skill: string; category: string; weight: number }[] {
    const text = `${stage.title} ${stage.objective} ${stage.criteria}`.toLowerCase();
    const matched: { skill: string; category: string; weight: number }[] = [];
    const seen = new Set<string>();

    for (const [canonical, entry] of SKILL_CATALOG) {
      if (seen.has(canonical)) continue;

      const hasMatch = entry.keywords.some(kw => text.includes(kw));
      if (hasMatch) {
        seen.add(canonical);
        matched.push({
          skill: entry.displayName,
          category: entry.category,
          weight: 0.6, // Lower weight for rule-based matching
        });
      }
    }

    return matched;
  }

  /**
   * Canonicalize skill name → lowercase, trimmed, normalized
   * "React.js" → "react.js", "Express.js" → "express.js", "Node JS" → "node js"
   */
  static canonicalize(name: string): string {
    return name.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Infer category from skill name (fallback)
   */
  static inferCategory(skill: string): string {
    const lower = skill.toLowerCase();

    for (const [, entry] of SKILL_CATALOG) {
      if (entry.keywords.includes(lower) || this.canonicalize(skill) === this.canonicalize(entry.displayName)) {
        return entry.category;
      }
    }

    // Generic inference
    if (['react', 'vue', 'angular', 'svelte', 'html', 'css', 'tailwind', 'bootstrap'].some(k => lower.includes(k))) return 'Frontend';
    if (['node', 'express', 'nest', 'django', 'flask', 'spring', 'laravel'].some(k => lower.includes(k))) return 'Backend';
    if (['docker', 'kubernetes', 'ci/cd', 'jenkins', 'github actions'].some(k => lower.includes(k))) return 'DevOps';
    if (['mongodb', 'mysql', 'postgres', 'prisma', 'sequelize', 'mongoose'].some(k => lower.includes(k))) return 'Database';
    if (['git', 'github'].some(k => lower.includes(k))) return 'Version Control';
    if (['jest', 'testing', 'cypress', 'vitest', 'mocha'].some(k => lower.includes(k))) return 'Testing';

    return 'General';
  }
}

// ==================== Skill Catalog ====================
// Canonical skill definitions — prevents duplicates like "React" / "ReactJS" / "React.js"

interface SkillCatalogEntry {
  displayName: string;
  category: string;
  keywords: string[];  // All lowercase terms that map to this skill
}

const SKILL_CATALOG = new Map<string, SkillCatalogEntry>([
  // Frontend
  ['react', { displayName: 'React', category: 'Frontend', keywords: ['react', 'reactjs', 'react.js', 'jsx', 'tsx'] }],
  ['vue', { displayName: 'Vue.js', category: 'Frontend', keywords: ['vue', 'vuejs', 'vue.js', 'vuex', 'pinia'] }],
  ['angular', { displayName: 'Angular', category: 'Frontend', keywords: ['angular', 'angularjs'] }],
  ['html', { displayName: 'HTML', category: 'Frontend', keywords: ['html', 'html5'] }],
  ['css', { displayName: 'CSS', category: 'Frontend', keywords: ['css', 'css3', 'scss', 'sass', 'less'] }],
  ['tailwindcss', { displayName: 'Tailwind CSS', category: 'Frontend', keywords: ['tailwind', 'tailwindcss'] }],
  ['typescript', { displayName: 'TypeScript', category: 'Programming Language', keywords: ['typescript', 'ts'] }],
  ['javascript', { displayName: 'JavaScript', category: 'Programming Language', keywords: ['javascript', 'js', 'es6', 'ecmascript'] }],
  ['responsive design', { displayName: 'Responsive Design', category: 'Frontend', keywords: ['responsive', 'mobile-first', 'media query', 'breakpoint'] }],

  // Backend
  ['node.js', { displayName: 'Node.js', category: 'Backend', keywords: ['node', 'nodejs', 'node.js'] }],
  ['express.js', { displayName: 'Express.js', category: 'Backend', keywords: ['express', 'expressjs', 'express.js'] }],
  ['nestjs', { displayName: 'NestJS', category: 'Backend', keywords: ['nest', 'nestjs'] }],
  ['python', { displayName: 'Python', category: 'Programming Language', keywords: ['python', 'py'] }],
  ['django', { displayName: 'Django', category: 'Backend', keywords: ['django'] }],
  ['java', { displayName: 'Java', category: 'Programming Language', keywords: ['java', 'spring', 'spring boot'] }],
  ['rest api', { displayName: 'REST API', category: 'Backend', keywords: ['rest', 'restful', 'api', 'endpoint'] }],
  ['graphql', { displayName: 'GraphQL', category: 'Backend', keywords: ['graphql', 'apollo'] }],

  // Database
  ['mongodb', { displayName: 'MongoDB', category: 'Database', keywords: ['mongodb', 'mongo', 'mongoose'] }],
  ['mysql', { displayName: 'MySQL', category: 'Database', keywords: ['mysql', 'mariadb'] }],
  ['postgresql', { displayName: 'PostgreSQL', category: 'Database', keywords: ['postgresql', 'postgres', 'pg'] }],
  ['prisma', { displayName: 'Prisma', category: 'Database', keywords: ['prisma'] }],
  ['database design', { displayName: 'Database Design', category: 'Database', keywords: ['database', 'schema', 'migration', 'erd', 'normalization'] }],

  // DevOps
  ['docker', { displayName: 'Docker', category: 'DevOps', keywords: ['docker', 'dockerfile', 'docker-compose', 'container'] }],
  ['ci/cd', { displayName: 'CI/CD', category: 'DevOps', keywords: ['ci/cd', 'pipeline', 'github actions', 'jenkins', 'gitlab ci'] }],
  ['deployment', { displayName: 'Deployment', category: 'DevOps', keywords: ['deploy', 'deployment', 'hosting', 'vercel', 'netlify', 'heroku'] }],

  // Version Control
  ['git', { displayName: 'Git', category: 'Version Control', keywords: ['git', 'github', 'gitlab', 'bitbucket', 'version control', 'branching'] }],

  // Testing
  ['testing', { displayName: 'Testing', category: 'Testing', keywords: ['test', 'testing', 'jest', 'mocha', 'vitest', 'cypress', 'unit test', 'integration test'] }],

  // Architecture
  ['architecture pattern', { displayName: 'Architecture Pattern', category: 'Software Design', keywords: ['mvc', 'mvvm', 'clean architecture', 'microservice', 'monolith', 'pattern'] }],
  ['authentication', { displayName: 'Authentication', category: 'Security', keywords: ['auth', 'authentication', 'jwt', 'oauth', 'passport', 'session'] }],
  ['security', { displayName: 'Security', category: 'Security', keywords: ['security', 'cors', 'helmet', 'csrf', 'xss', 'sanitize', 'encryption'] }],
  ['error handling', { displayName: 'Error Handling', category: 'Software Design', keywords: ['error handling', 'exception', 'try catch', 'error boundary'] }],
  ['validation', { displayName: 'Validation', category: 'Software Design', keywords: ['validation', 'validate', 'joi', 'zod', 'yup'] }],
  ['state management', { displayName: 'State Management', category: 'Frontend', keywords: ['state management', 'redux', 'zustand', 'context api', 'recoil'] }],
  ['documentation', { displayName: 'Documentation', category: 'General', keywords: ['documentation', 'readme', 'api doc', 'swagger', 'jsdoc'] }],
]);

export { SKILL_CATALOG };
