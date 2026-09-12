import logger from '../utils/logger';
import {
  ProjectContext,
  EvaluationStage,
  EvidencePackage,
  CodeChunk,
  SourceFileIndexEntry,
} from '../types';

/**
 * EvidenceRetrieverService — Tìm evidence (code, files) liên quan cho từng criterion
 * 
 * Cơ chế:
 * 1. Nếu criterion có hints (keywords, directories, filePatterns) → ưu tiên dùng
 * 2. Nếu không → auto-infer keywords từ criterion text (title, objective, criteria)
 * 3. Lọc sourceIndex + lấy codeChunks tương ứng
 * 4. Thu thập config files liên quan
 * 5. Build EvidencePackage với chunkId để AI reference
 */
export class EvidenceRetrieverService {

  /**
   * Retrieve evidence cho 1 criterion từ Project Context
   */
  static retrieveEvidence(
    criterion: EvaluationStage,
    projectContext: ProjectContext
  ): EvidencePackage {
    logger.info(`Retrieving evidence for criterion: ${criterion.title}`);

    // Step 1: Determine search strategy
    const hasHints = !!(criterion.keywords?.length || criterion.directories?.length || criterion.filePatterns?.length);
    
    let keywords: string[];
    let directories: string[];
    let filePatterns: string[];

    if (hasHints) {
      // Use provided hints
      keywords = criterion.keywords || [];
      directories = criterion.directories || [];
      filePatterns = criterion.filePatterns || [];
      logger.info(`Using provided hints: ${keywords.length} keywords, ${directories.length} dirs, ${filePatterns.length} patterns`);
    } else {
      // Auto-infer from criterion text
      const inferred = this.inferSearchParams(criterion);
      keywords = inferred.keywords;
      directories = inferred.directories;
      filePatterns = inferred.filePatterns;
      logger.info(`Auto-inferred: ${keywords.length} keywords, ${directories.length} dirs, ${filePatterns.length} patterns`);
    }

    // Step 2: Find relevant files from sourceIndex
    const relevantFiles = this.findRelevantFiles(
      projectContext.sourceIndex,
      keywords,
      directories,
      filePatterns
    );

    // Step 3: Get corresponding code chunks
    let relevantChunks = this.getRelevantChunks(
      projectContext.codeChunks,
      relevantFiles.map(f => f.path)
    );

    // Step 4: Get relevant config files
    const relevantConfigs = this.findRelevantConfigs(
      projectContext.artifacts.configFiles,
      keywords
    );

    // Step 5: Build project overview
    const overview = this.buildProjectOverview(projectContext);

    // Step 6: Get README if relevant
    const readme = this.isReadmeRelevant(criterion) ? projectContext.artifacts.readme : undefined;

    // Fallback: if no specific evidence found, include entry point files
    if (relevantChunks.length === 0) {
      logger.warn(`No specific evidence found for "${criterion.title}", using entry points as fallback`);
      const entryPointChunks = this.getEntryPointChunks(projectContext);
      relevantChunks.push(...entryPointChunks);
    }

    // Limit total chunks to avoid token overflow (max 20 chunks per criterion)
    const limitedChunks = relevantChunks.slice(0, 20);

    const evidencePackage: EvidencePackage = {
      overview,
      chunks: limitedChunks.map(chunk => ({
        chunkId: `${chunk.filePath}::${chunk.chunkIndex}`,
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        language: chunk.language,
        content: chunk.content,
      })),
      relevantConfigs: relevantConfigs.slice(0, 5),
      readme,
    };

    logger.info(`Evidence package: ${evidencePackage.chunks.length} chunks, ${evidencePackage.relevantConfigs.length} configs`);
    return evidencePackage;
  }

  /**
   * Auto-infer search params from criterion text
   */
  static inferSearchParams(criterion: EvaluationStage): {
    keywords: string[];
    directories: string[];
    filePatterns: string[];
  } {
    const text = `${criterion.title} ${criterion.objective} ${criterion.criteria} ${criterion.expectedOutput || ''}`.toLowerCase();

    const keywords: Set<string> = new Set();
    const directories: Set<string> = new Set();
    const filePatterns: Set<string> = new Set();

    // Common pattern detection
    const patternMap: Record<string, { kw: string[]; dirs: string[]; patterns: string[] }> = {
      // Architecture patterns
      'mvc': { kw: ['controller', 'model', 'view', 'route'], dirs: ['controllers/', 'models/', 'views/', 'routes/'], patterns: ['*.controller.*', '*.model.*', '*.route.*'] },
      'service': { kw: ['service', 'business logic'], dirs: ['services/'], patterns: ['*.service.*'] },
      'middleware': { kw: ['middleware', 'interceptor', 'guard'], dirs: ['middleware/', 'middlewares/'], patterns: ['*.middleware.*'] },
      'repository': { kw: ['repository', 'dao', 'data access'], dirs: ['repositories/', 'dao/'], patterns: ['*.repository.*'] },
      
      // Specific features
      'authentication': { kw: ['auth', 'login', 'jwt', 'token', 'passport', 'session'], dirs: ['auth/', 'middleware/'], patterns: ['*auth*'] },
      'xác thực': { kw: ['auth', 'login', 'jwt', 'token', 'passport'], dirs: ['auth/', 'middleware/'], patterns: ['*auth*'] },
      'database': { kw: ['database', 'prisma', 'mongoose', 'sequelize', 'migration', 'schema'], dirs: ['prisma/', 'models/', 'migrations/'], patterns: ['schema.*', '*.model.*'] },
      'cơ sở dữ liệu': { kw: ['database', 'prisma', 'schema', 'model'], dirs: ['prisma/', 'models/'], patterns: ['schema.*', '*.model.*'] },
      'api': { kw: ['api', 'endpoint', 'route', 'rest', 'controller'], dirs: ['routes/', 'controllers/', 'api/'], patterns: ['*.route.*', '*.controller.*'] },
      'test': { kw: ['test', 'spec', 'jest', 'mocha', 'vitest', 'cypress'], dirs: ['test/', 'tests/', '__tests__/', 'spec/'], patterns: ['*.test.*', '*.spec.*'] },
      'kiểm thử': { kw: ['test', 'spec', 'jest'], dirs: ['test/', 'tests/', '__tests__/'], patterns: ['*.test.*', '*.spec.*'] },
      'docker': { kw: ['docker', 'container', 'dockerfile', 'compose'], dirs: [], patterns: ['Dockerfile', 'docker-compose.*'] },
      'error': { kw: ['error', 'exception', 'handling', 'try', 'catch'], dirs: ['middleware/', 'utils/'], patterns: ['*error*', '*exception*'] },
      'xử lý lỗi': { kw: ['error', 'exception', 'handling'], dirs: ['middleware/', 'utils/'], patterns: ['*error*'] },
      'validation': { kw: ['validation', 'validate', 'joi', 'zod', 'schema'], dirs: ['validators/', 'validation/'], patterns: ['*valid*'] },
      'config': { kw: ['config', 'configuration', 'env', 'environment'], dirs: ['config/', 'configs/'], patterns: ['*.config.*', '.env*'] },
      'cấu hình': { kw: ['config', 'environment', 'env'], dirs: ['config/'], patterns: ['*.config.*'] },
      'component': { kw: ['component', 'react', 'vue', 'svelte'], dirs: ['components/', 'src/components/'], patterns: ['*.tsx', '*.jsx', '*.vue'] },
      'state': { kw: ['state', 'redux', 'zustand', 'store', 'context'], dirs: ['store/', 'stores/', 'context/'], patterns: ['*store*', '*context*', '*slice*'] },
      'style': { kw: ['css', 'style', 'tailwind', 'scss', 'styled'], dirs: ['styles/'], patterns: ['*.css', '*.scss', '*.styled.*'] },
      'giao diện': { kw: ['component', 'ui', 'css', 'style', 'layout'], dirs: ['components/', 'styles/'], patterns: ['*.tsx', '*.jsx', '*.css'] },
      'responsive': { kw: ['responsive', 'mobile', 'media query', 'breakpoint'], dirs: ['styles/'], patterns: ['*.css', '*.scss'] },
      'readme': { kw: ['readme', 'documentation', 'tài liệu'], dirs: [], patterns: ['README*'] },
      'security': { kw: ['security', 'cors', 'helmet', 'csrf', 'xss', 'sanitize'], dirs: ['middleware/', 'security/'], patterns: ['*security*', '*cors*'] },
      'bảo mật': { kw: ['security', 'cors', 'helmet', 'auth'], dirs: ['middleware/'], patterns: ['*security*'] },
      'logging': { kw: ['log', 'logger', 'winston', 'morgan', 'debug'], dirs: ['utils/'], patterns: ['*log*'] },
      'upload': { kw: ['upload', 'file', 'multer', 'storage', 'minio', 's3'], dirs: ['uploads/', 'config/'], patterns: ['*upload*', '*storage*', '*multer*'] },
    };

    for (const [pattern, mapping] of Object.entries(patternMap)) {
      if (text.includes(pattern)) {
        mapping.kw.forEach(k => keywords.add(k));
        mapping.dirs.forEach(d => directories.add(d));
        mapping.patterns.forEach(p => filePatterns.add(p));
      }
    }

    // Extract additional keywords from the criterion text
    // Look for common code-related terms
    const codeTerms = text.match(/\b(controller|service|model|route|middleware|utils?|helper|config|component|page|layout|hook|provider|context|store|reducer|action|schema|migration|seed|test|spec|index|main|app|server)\b/g);
    if (codeTerms) {
      codeTerms.forEach(term => keywords.add(term));
    }

    // If still no keywords, use generic search based on criterion title words
    if (keywords.size === 0) {
      const titleWords = criterion.title.toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 3 && !['tiêu', 'chí', 'đánh', 'giá', 'kiểm', 'tra', 'đồ', 'án', 'project', 'bài', 'nộp', 'học', 'viên', 'final'].includes(w));
      titleWords.forEach(w => keywords.add(w));
    }

    return {
      keywords: Array.from(keywords),
      directories: Array.from(directories),
      filePatterns: Array.from(filePatterns),
    };
  }

  /**
   * Find relevant files from sourceIndex
   */
  static findRelevantFiles(
    sourceIndex: SourceFileIndexEntry[],
    keywords: string[],
    directories: string[],
    filePatterns: string[]
  ): SourceFileIndexEntry[] {
    if (keywords.length === 0 && directories.length === 0 && filePatterns.length === 0) {
      return sourceIndex; // Return all if no filters
    }

    const scored = sourceIndex.map(file => {
      let score = 0;
      const fileLower = file.path.toLowerCase();
      const dirLower = file.directory.toLowerCase();

      // Directory match (highest weight)
      for (const dir of directories) {
        const dirClean = dir.replace(/\/$/, '').toLowerCase();
        if (dirLower.includes(dirClean) || fileLower.includes(dirClean + '/')) {
          score += 10;
        }
      }

      // File pattern match
      for (const pattern of filePatterns) {
        const regex = new RegExp(
          '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
          'i'
        );
        if (regex.test(file.path.split('/').pop() || '')) {
          score += 8;
        }
      }

      // Keyword match in path
      for (const kw of keywords) {
        if (fileLower.includes(kw.toLowerCase())) {
          score += 5;
        }
      }

      // Keyword match in imports/exports
      for (const kw of keywords) {
        const kwLower = kw.toLowerCase();
        if (file.imports.some(i => i.toLowerCase().includes(kwLower))) score += 2;
        if (file.exports.some(e => e.toLowerCase().includes(kwLower))) score += 2;
      }

      // Entry point bonus
      if (file.isEntryPoint) score += 1;

      return { file, score };
    });

    // Return files with score > 0, sorted by score descending
    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.file);
  }

  /**
   * Get code chunks for the relevant files
   */
  static getRelevantChunks(
    allChunks: CodeChunk[],
    relevantFilePaths: string[]
  ): CodeChunk[] {
    const pathSet = new Set(relevantFilePaths);
    return allChunks.filter(chunk => pathSet.has(chunk.filePath));
  }

  /**
   * Find config files relevant to the criterion
   */
  static findRelevantConfigs(
    configFiles: { path: string; type: string; content: string }[],
    keywords: string[]
  ): { path: string; type: string; content: string }[] {
    if (keywords.length === 0) return [];

    return configFiles.filter(config => {
      const configStr = `${config.path} ${config.type}`.toLowerCase();
      return keywords.some(kw => configStr.includes(kw.toLowerCase()));
    });
  }

  /**
   * Build project overview text for AI context
   */
  static buildProjectOverview(ctx: ProjectContext): string {
    const parts: string[] = [
      `Loại project: ${ctx.metadata.projectType}`,
      `Ngôn ngữ chính: ${ctx.metadata.primaryLanguage}`,
      `Frameworks: ${ctx.metadata.techStack.frameworks.join(', ') || 'N/A'}`,
      `Tổng files: ${ctx.structure.totalFiles}`,
      `Tổng dòng code: ${ctx.structure.totalLines}`,
      `Entry points: ${ctx.structure.entryPoints.join(', ') || 'N/A'}`,
    ];

    // Add a simplified directory structure
    if (ctx.structure.directoryTree) {
      parts.push(`\nCấu trúc thư mục chính:`);
      parts.push(this.renderDirectoryTree(ctx.structure.directoryTree, '', 2));
    }

    return parts.join('\n');
  }

  /**
   * Render directory tree as text (limited depth)
   */
  static renderDirectoryTree(node: any, prefix: string = '', maxDepth: number = 2, depth: number = 0): string {
    if (depth >= maxDepth) return '';
    const lines: string[] = [];

    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        const icon = child.type === 'directory' ? '📁' : '📄';
        lines.push(`${prefix}${icon} ${child.name}`);
        if (child.type === 'directory' && child.children) {
          lines.push(this.renderDirectoryTree(child, prefix + '  ', maxDepth, depth + 1));
        }
      }
    }

    return lines.filter(Boolean).join('\n');
  }

  /**
   * Check if README is relevant to the criterion
   */
  static isReadmeRelevant(criterion: EvaluationStage): boolean {
    const text = `${criterion.title} ${criterion.objective} ${criterion.criteria}`.toLowerCase();
    return ['readme', 'documentation', 'tài liệu', 'hướng dẫn', 'mô tả', 'description'].some(
      kw => text.includes(kw)
    );
  }

  /**
   * Get chunks for entry point files as fallback
   */
  static getEntryPointChunks(ctx: ProjectContext): CodeChunk[] {
    const entryPaths = new Set(ctx.structure.entryPoints);
    return ctx.codeChunks
      .filter(chunk => entryPaths.has(chunk.filePath))
      .slice(0, 5); // Max 5 entry point chunks
  }

  /**
   * Format evidence package as text for the AI prompt
   */
  static formatEvidenceForPrompt(evidence: EvidencePackage): string {
    const parts: string[] = [];

    for (const chunk of evidence.chunks) {
      parts.push(`--- [chunkId: ${chunk.chunkId}] ${chunk.filePath} (L${chunk.startLine}-L${chunk.endLine}) [${chunk.language}] ---`);
      parts.push(chunk.content);
      parts.push('');
    }

    if (evidence.relevantConfigs.length > 0) {
      parts.push('--- Config Files ---');
      for (const config of evidence.relevantConfigs) {
        parts.push(`[${config.type}] ${config.path}:`);
        parts.push(config.content);
        parts.push('');
      }
    }

    if (evidence.readme) {
      parts.push('--- README ---');
      parts.push(evidence.readme);
    }

    if (parts.length === 0) {
      parts.push('(Không tìm thấy evidence cụ thể cho tiêu chí này)');
    }

    return parts.join('\n');
  }
}
