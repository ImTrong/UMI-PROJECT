import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import logger from '../utils/logger';
import {
  NOISE_DIRECTORIES,
  NOISE_FILE_PATTERNS,
  LANGUAGE_MAP,
  CONFIG_FILE_PATTERNS,
  CODE_CHUNK_CONFIG,
  ZIP_SECURITY_DEFAULTS,
  PROJECT_ANALYSIS_ERRORS,
} from '../utils/constants';
import {
  DirectoryNode,
  SourceFileIndexEntry,
  CodeChunk,
  ProjectContext,
  ProjectAnalysisResult,
  GitHubInfo,
  ZipSecurityConfig,
  ProcessingStatus,
} from '../types';

const prisma = new PrismaClient();

/**
 * ProjectAnalyzerService — Phân tích project từ ZIP hoặc GitHub
 * 
 * Giai đoạn 1: Phân tích trực tiếp (KHÔNG dùng AI)
 * - Giải nén ZIP với bảo mật đầy đủ
 * - Quét cấu trúc thư mục, loại bỏ noise
 * - Phát hiện ngôn ngữ, framework, thư viện
 * - Index source files (path, language, lineCount, imports, exports)
 * - Tạo code chunks có thể truy xuất theo rubric (GĐ2)
 * - Thu thập README, package info, config files
 * - Xây dựng Project Context
 */
export class ProjectAnalyzerService {

  // ==================== ZIP Extraction ====================

  /**
   * Giải nén ZIP file với đầy đủ bảo mật
   * - Path traversal protection
   * - Max file count
   * - Max single file size
   * - Max total extracted size
   */
  static async extractZip(
    zipFilePath: string,
    extractDir: string,
    securityConfig?: Partial<ZipSecurityConfig>
  ): Promise<void> {
    const config: ZipSecurityConfig = {
      maxZipSizeMB: securityConfig?.maxZipSizeMB ?? ZIP_SECURITY_DEFAULTS.MAX_ZIP_SIZE_MB,
      maxExtractedSizeMB: securityConfig?.maxExtractedSizeMB ?? ZIP_SECURITY_DEFAULTS.MAX_EXTRACTED_SIZE_MB,
      maxFileCount: securityConfig?.maxFileCount ?? ZIP_SECURITY_DEFAULTS.MAX_FILE_COUNT,
      maxSingleFileSizeMB: securityConfig?.maxSingleFileSizeMB ?? ZIP_SECURITY_DEFAULTS.MAX_SINGLE_FILE_SIZE_MB,
    };

    // Check ZIP file size
    const zipStats = fs.statSync(zipFilePath);
    if (zipStats.size > config.maxZipSizeMB * 1024 * 1024) {
      throw new Error(PROJECT_ANALYSIS_ERRORS.ZIP_TOO_LARGE);
    }

    // Create extraction directory
    fs.mkdirSync(extractDir, { recursive: true });

    // Use unzip command for extraction (available in Docker containers)
    // We use -o to overwrite, -d to specify destination
    try {
      childProcess.execSync(`unzip -o -q "${zipFilePath}" -d "${extractDir}"`, {
        timeout: 60000, // 60 seconds timeout
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for output
      });
    } catch (err: any) {
      // Try with PowerShell on Windows
      try {
        childProcess.execSync(
          `powershell -Command "Expand-Archive -Path '${zipFilePath}' -DestinationPath '${extractDir}' -Force"`,
          { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }
        );
      } catch (winErr: any) {
        logger.error('ZIP extraction failed:', winErr);
        throw new Error(PROJECT_ANALYSIS_ERRORS.INVALID_ZIP);
      }
    }

    // Security checks after extraction
    await this.validateExtractedContent(extractDir, config);
  }

  /**
   * Validate extracted content against security limits
   */
  static async validateExtractedContent(
    extractDir: string,
    config: ZipSecurityConfig
  ): Promise<void> {
    let totalSize = 0;
    let fileCount = 0;
    const maxTotalBytes = config.maxExtractedSizeMB * 1024 * 1024;
    const maxSingleFileBytes = config.maxSingleFileSizeMB * 1024 * 1024;

    const walkAndValidate = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(extractDir, fullPath);

        // Path traversal protection — check that resolved path stays within extractDir
        const resolvedPath = path.resolve(fullPath);
        if (!resolvedPath.startsWith(path.resolve(extractDir))) {
          // Clean up and throw
          fs.rmSync(extractDir, { recursive: true, force: true });
          throw new Error(PROJECT_ANALYSIS_ERRORS.PATH_TRAVERSAL_DETECTED);
        }

        // Also check for suspicious path patterns
        if (relativePath.includes('..') || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
          fs.rmSync(extractDir, { recursive: true, force: true });
          throw new Error(PROJECT_ANALYSIS_ERRORS.PATH_TRAVERSAL_DETECTED);
        }

        if (entry.isDirectory()) {
          walkAndValidate(fullPath);
        } else if (entry.isFile()) {
          fileCount++;
          if (fileCount > config.maxFileCount) {
            throw new Error(PROJECT_ANALYSIS_ERRORS.TOO_MANY_FILES);
          }

          const stats = fs.statSync(fullPath);
          if (stats.size > maxSingleFileBytes) {
            throw new Error(PROJECT_ANALYSIS_ERRORS.SINGLE_FILE_TOO_LARGE);
          }

          totalSize += stats.size;
          if (totalSize > maxTotalBytes) {
            throw new Error(PROJECT_ANALYSIS_ERRORS.EXTRACTED_TOO_LARGE);
          }
        }
      }
    };

    walkAndValidate(extractDir);
    logger.info(`ZIP validation passed: ${fileCount} files, ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  }

  // ==================== Directory Structure ====================

  /**
   * Tìm root directory thực sự của project
   * (Nhiều ZIP có 1 thư mục cha duy nhất bên trong)
   */
  static findProjectRoot(extractDir: string): string {
    const entries = fs.readdirSync(extractDir, { withFileTypes: true });
    const nonHidden = entries.filter(e => !e.name.startsWith('.') && e.name !== '__MACOSX');
    
    if (nonHidden.length === 1 && nonHidden[0].isDirectory()) {
      return path.join(extractDir, nonHidden[0].name);
    }
    return extractDir;
  }

  /**
   * Build directory tree, loại bỏ noise directories/files
   */
  static buildDirectoryTree(rootDir: string, relativeTo?: string): DirectoryNode {
    const rootName = path.basename(rootDir);
    const base = relativeTo || rootDir;

    const buildNode = (dir: string, name: string): DirectoryNode => {
      const node: DirectoryNode = { name, type: 'directory', children: [] };

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return node;
      }

      // Sort: directories first, then files, alphabetically
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const entry of entries) {
        // Skip noise directories
        if (entry.isDirectory() && NOISE_DIRECTORIES.includes(entry.name)) {
          continue;
        }

        // Skip hidden directories/files (except some config files)
        if (entry.name.startsWith('.') && entry.isDirectory()) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          const childNode = buildNode(fullPath, entry.name);
          if (childNode.children && childNode.children.length > 0) {
            node.children!.push(childNode);
          }
        } else if (entry.isFile()) {
          // Skip noise files
          const isNoise = NOISE_FILE_PATTERNS.some(pattern => pattern.test(entry.name));
          if (isNoise) continue;

          const ext = path.extname(entry.name).toLowerCase();
          const language = LANGUAGE_MAP[ext];
          let size: number | undefined;
          try {
            size = fs.statSync(fullPath).size;
          } catch { /* ignore */ }

          node.children!.push({
            name: entry.name,
            type: 'file',
            language,
            size,
          });
        }
      }

      return node;
    };

    return buildNode(rootDir, rootName);
  }

  // ==================== Language & Framework Detection ====================

  /**
   * Phát hiện ngôn ngữ lập trình dựa trên file extensions
   */
  static detectLanguages(rootDir: string): { languages: string[]; primaryLanguage: string; fileCounts: Record<string, number> } {
    const fileCounts: Record<string, number> = {};

    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (NOISE_DIRECTORIES.includes(entry.name) || entry.name.startsWith('.')) continue;
          walk(path.join(dir, entry.name));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          const lang = LANGUAGE_MAP[ext];
          if (lang && !['JSON', 'Markdown', 'YAML', 'XML'].includes(lang)) {
            fileCounts[lang] = (fileCounts[lang] || 0) + 1;
          }
        }
      }
    };

    walk(rootDir);

    const sorted = Object.entries(fileCounts).sort((a, b) => b[1] - a[1]);
    const languages = sorted.map(([lang]) => lang);
    const primaryLanguage = languages[0] || 'Unknown';

    return { languages, primaryLanguage, fileCounts };
  }

  /**
   * Phát hiện frameworks và libraries từ package.json, requirements.txt, etc.
   */
  static detectFrameworksAndLibraries(rootDir: string, packageInfo?: any): { frameworks: string[]; libraries: string[] } {
    const frameworks: Set<string> = new Set();
    const libraries: Set<string> = new Set();

    // Framework detection patterns
    const frameworkPatterns: Record<string, string> = {
      'react': 'React', 'react-dom': 'React',
      'next': 'Next.js',
      'vue': 'Vue.js',
      'nuxt': 'Nuxt.js',
      '@angular/core': 'Angular',
      'svelte': 'Svelte',
      'express': 'Express.js',
      'fastify': 'Fastify',
      'nestjs': 'NestJS', '@nestjs/core': 'NestJS',
      'koa': 'Koa',
      'hapi': 'Hapi',
      'django': 'Django',
      'flask': 'Flask',
      'fastapi': 'FastAPI',
      'spring-boot': 'Spring Boot',
      'laravel': 'Laravel',
      'rails': 'Ruby on Rails',
      'gin': 'Gin',
      'fiber': 'Fiber',
      'flutter': 'Flutter',
      'react-native': 'React Native',
      'electron': 'Electron',
      'prisma': 'Prisma', '@prisma/client': 'Prisma',
      'mongoose': 'Mongoose',
      'sequelize': 'Sequelize',
      'typeorm': 'TypeORM',
      'tailwindcss': 'Tailwind CSS',
      'bootstrap': 'Bootstrap',
      'redux': 'Redux', '@reduxjs/toolkit': 'Redux Toolkit',
      'zustand': 'Zustand',
      'socket.io': 'Socket.IO',
      'graphql': 'GraphQL', 'apollo-server': 'Apollo GraphQL',
    };

    if (packageInfo) {
      const allDeps = {
        ...(packageInfo.dependencies || {}),
        ...(packageInfo.devDependencies || {}),
      };

      for (const [dep, _version] of Object.entries(allDeps)) {
        const depLower = dep.toLowerCase();
        if (frameworkPatterns[depLower]) {
          frameworks.add(frameworkPatterns[depLower]);
        } else {
          // Add notable libraries (skip types and internal packages)
          if (!dep.startsWith('@types/') && !dep.startsWith('.')) {
            libraries.add(dep);
          }
        }
      }
    }

    // Check for Python projects
    const requirementsPath = path.join(rootDir, 'requirements.txt');
    if (fs.existsSync(requirementsPath)) {
      try {
        const content = fs.readFileSync(requirementsPath, 'utf-8');
        const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        for (const line of lines) {
          const pkg = line.split('==')[0].split('>=')[0].split('<=')[0].split('~=')[0].trim().toLowerCase();
          if (frameworkPatterns[pkg]) {
            frameworks.add(frameworkPatterns[pkg]);
          } else if (pkg) {
            libraries.add(pkg);
          }
        }
      } catch { /* ignore */ }
    }

    // Check for Go projects
    const goModPath = path.join(rootDir, 'go.mod');
    if (fs.existsSync(goModPath)) {
      try {
        const content = fs.readFileSync(goModPath, 'utf-8');
        if (content.includes('github.com/gin-gonic/gin')) frameworks.add('Gin');
        if (content.includes('github.com/gofiber/fiber')) frameworks.add('Fiber');
        if (content.includes('github.com/labstack/echo')) frameworks.add('Echo');
      } catch { /* ignore */ }
    }

    // Detect project type from directory structure
    if (fs.existsSync(path.join(rootDir, 'docker-compose.yml')) || fs.existsSync(path.join(rootDir, 'docker-compose.yaml'))) {
      frameworks.add('Docker Compose');
    }
    if (fs.existsSync(path.join(rootDir, 'Dockerfile'))) {
      frameworks.add('Docker');
    }

    return {
      frameworks: Array.from(frameworks),
      libraries: Array.from(libraries).slice(0, 50), // Cap at 50 notable libs
    };
  }

  /**
   * Detect project type based on structure and tech stack
   */
  static detectProjectType(rootDir: string, frameworks: string[], languages: string[]): string {
    const hasDir = (name: string) => fs.existsSync(path.join(rootDir, name));
    const hasFile = (name: string) => fs.existsSync(path.join(rootDir, name));

    // Fullstack indicators
    if ((hasDir('frontend') || hasDir('client')) && (hasDir('backend') || hasDir('server') || hasDir('api') || hasDir('services'))) {
      return 'fullstack';
    }

    // Mobile
    if (frameworks.includes('React Native') || frameworks.includes('Flutter') || hasFile('android/build.gradle') || hasDir('ios')) {
      return 'mobile';
    }

    // Web app (frontend)
    if (frameworks.some(f => ['React', 'Vue.js', 'Angular', 'Svelte', 'Next.js', 'Nuxt.js'].includes(f))) {
      // If also has backend framework, it's fullstack
      if (frameworks.some(f => ['Express.js', 'NestJS', 'Fastify', 'Django', 'Flask', 'FastAPI', 'Spring Boot'].includes(f))) {
        return 'fullstack';
      }
      return 'web-app';
    }

    // API / Backend
    if (frameworks.some(f => ['Express.js', 'NestJS', 'Fastify', 'Django', 'Flask', 'FastAPI', 'Gin', 'Fiber', 'Spring Boot', 'Koa'].includes(f))) {
      return 'api';
    }

    // CLI
    if (hasFile('bin') || (hasFile('package.json') && !hasDir('src') && !hasDir('pages') && !hasDir('app'))) {
      // Check package.json for bin field
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
        if (pkg.bin) return 'cli';
      } catch { /* ignore */ }
    }

    // Library
    if (hasFile('setup.py') || hasFile('pyproject.toml') || hasFile('Cargo.toml')) {
      return 'library';
    }

    return 'web-app'; // Default
  }

  // ==================== Source File Indexing ====================

  /**
   * Index source files — phân tích trực tiếp imports/exports, KHÔNG dùng AI
   */
  static indexSourceFiles(rootDir: string): { index: SourceFileIndexEntry[]; totalLines: number; totalFiles: number; analyzedFiles: number } {
    const index: SourceFileIndexEntry[] = [];
    let totalLines = 0;
    let totalFiles = 0;
    let analyzedFiles = 0;

    // Common entry point patterns
    const entryPointPatterns = [
      'index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js',
      'server.ts', 'server.js', 'main.py', 'app.py', 'manage.py',
      'main.go', 'main.rs', 'Main.java', 'Program.cs',
    ];

    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (NOISE_DIRECTORIES.includes(entry.name) || entry.name.startsWith('.')) continue;
          walk(path.join(dir, entry.name));
        } else if (entry.isFile()) {
          const isNoise = NOISE_FILE_PATTERNS.some(pattern => pattern.test(entry.name));
          if (isNoise) continue;

          const ext = path.extname(entry.name).toLowerCase();
          const language = LANGUAGE_MAP[ext];
          if (!language) continue; // Skip non-code files

          // Skip JSON, Markdown, YAML, XML for source index
          if (['JSON', 'Markdown', 'YAML', 'XML'].includes(language)) continue;

          totalFiles++;
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
          const directory = path.dirname(relativePath);

          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            const lineCount = lines.length;
            totalLines += lineCount;
            analyzedFiles++;

            // Extract imports
            const imports = this.extractImports(content, language);

            // Extract exports
            const exports = this.extractExports(content, language);

            // Check if entry point
            const isEntryPoint = entryPointPatterns.includes(entry.name) ||
              (directory === '.' && entryPointPatterns.some(ep => entry.name === ep));

            index.push({
              path: relativePath,
              language,
              lineCount,
              imports,
              exports,
              isEntryPoint,
              directory: directory === '.' ? '/' : `/${directory}`,
            });
          } catch {
            // Binary or unreadable file, skip
          }
        }
      }
    };

    walk(rootDir);
    return { index, totalLines, totalFiles, analyzedFiles };
  }

  /**
   * Extract import statements from source code
   */
  static extractImports(content: string, language: string): string[] {
    const imports: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      switch (language) {
        case 'TypeScript':
        case 'JavaScript': {
          // import X from 'Y'
          const esImport = trimmed.match(/^import\s+.+\s+from\s+['"](.+?)['"]/);
          if (esImport) { imports.push(esImport[1]); continue; }
          // import 'Y'
          const sideEffect = trimmed.match(/^import\s+['"](.+?)['"]/);
          if (sideEffect) { imports.push(sideEffect[1]); continue; }
          // const X = require('Y')
          const cjsRequire = trimmed.match(/require\(['"](.+?)['"]\)/);
          if (cjsRequire) { imports.push(cjsRequire[1]); continue; }
          break;
        }
        case 'Python': {
          const pyImport = trimmed.match(/^(?:from\s+(\S+)\s+import|import\s+(\S+))/);
          if (pyImport) { imports.push(pyImport[1] || pyImport[2]); continue; }
          break;
        }
        case 'Java':
        case 'Kotlin': {
          const javaImport = trimmed.match(/^import\s+([\w.]+)/);
          if (javaImport) { imports.push(javaImport[1]); continue; }
          break;
        }
        case 'Go': {
          const goImport = trimmed.match(/^\s*"(.+?)"/);
          if (goImport) { imports.push(goImport[1]); continue; }
          break;
        }
        case 'C#': {
          const csUsing = trimmed.match(/^using\s+([\w.]+)/);
          if (csUsing) { imports.push(csUsing[1]); continue; }
          break;
        }
        case 'Rust': {
          const rsUse = trimmed.match(/^use\s+([\w:]+)/);
          if (rsUse) { imports.push(rsUse[1]); continue; }
          break;
        }
        case 'PHP': {
          const phpUse = trimmed.match(/^use\s+([\w\\]+)/);
          if (phpUse) { imports.push(phpUse[1]); continue; }
          break;
        }
      }
    }

    return [...new Set(imports)]; // Deduplicate
  }

  /**
   * Extract export statements from source code
   */
  static extractExports(content: string, language: string): string[] {
    const exports: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      switch (language) {
        case 'TypeScript':
        case 'JavaScript': {
          // export default X
          const defaultExport = trimmed.match(/^export\s+default\s+(?:class|function|const|let|var)?\s*(\w+)?/);
          if (defaultExport) { exports.push(defaultExport[1] || 'default'); continue; }
          // export { X, Y }
          const namedExport = trimmed.match(/^export\s+\{(.+?)\}/);
          if (namedExport) {
            namedExport[1].split(',').forEach(e => exports.push(e.trim().split(/\s+as\s+/)[0].trim()));
            continue;
          }
          // export class/function/const/interface/type/enum
          const declExport = trimmed.match(/^export\s+(?:async\s+)?(?:class|function|const|let|var|interface|type|enum)\s+(\w+)/);
          if (declExport) { exports.push(declExport[1]); continue; }
          // module.exports
          if (trimmed.startsWith('module.exports')) { exports.push('module.exports'); continue; }
          break;
        }
        case 'Python': {
          // def X or class X (top-level)
          const pyDef = trimmed.match(/^(?:def|class)\s+(\w+)/);
          if (pyDef && !trimmed.startsWith(' ') && !trimmed.startsWith('\t')) {
            exports.push(pyDef[1]);
            continue;
          }
          break;
        }
        case 'Java':
        case 'Kotlin': {
          const javaClass = trimmed.match(/^public\s+(?:class|interface|enum|abstract\s+class)\s+(\w+)/);
          if (javaClass) { exports.push(javaClass[1]); continue; }
          break;
        }
        case 'Go': {
          // Capitalized functions/types are exported in Go
          const goExport = trimmed.match(/^(?:func|type|var|const)\s+([A-Z]\w*)/);
          if (goExport) { exports.push(goExport[1]); continue; }
          break;
        }
      }
    }

    return [...new Set(exports)];
  }

  // ==================== Code Chunks ====================

  /**
   * Tạo code chunks — đoạn code có thể truy xuất theo rubric
   * Mỗi file được chia thành các chunk tối đa MAX_LINES_PER_CHUNK dòng
   */
  static createCodeChunks(rootDir: string, sourceIndex: SourceFileIndexEntry[]): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    let totalChunks = 0;

    for (const fileEntry of sourceIndex) {
      if (totalChunks >= CODE_CHUNK_CONFIG.MAX_TOTAL_CHUNKS) break;

      // Skip very large files (likely generated)
      if (fileEntry.lineCount > CODE_CHUNK_CONFIG.MAX_FILE_LINES_TO_CHUNK) continue;

      const fullPath = path.join(rootDir, fileEntry.path);
      let content: string;
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }

      const lines = content.split('\n');
      const maxChunksForFile = Math.min(
        Math.ceil(lines.length / CODE_CHUNK_CONFIG.MAX_LINES_PER_CHUNK),
        CODE_CHUNK_CONFIG.MAX_CHUNKS_PER_FILE
      );

      for (let i = 0; i < maxChunksForFile && totalChunks < CODE_CHUNK_CONFIG.MAX_TOTAL_CHUNKS; i++) {
        const startLine = i * CODE_CHUNK_CONFIG.MAX_LINES_PER_CHUNK + 1;
        const endLine = Math.min((i + 1) * CODE_CHUNK_CONFIG.MAX_LINES_PER_CHUNK, lines.length);
        const chunkContent = lines.slice(startLine - 1, endLine).join('\n');

        // Skip empty chunks
        if (chunkContent.trim().length === 0) continue;

        chunks.push({
          filePath: fileEntry.path,
          chunkIndex: i,
          startLine,
          endLine,
          content: chunkContent,
          language: fileEntry.language,
        });
        totalChunks++;
      }
    }

    return chunks;
  }

  // ==================== Artifact Collection ====================

  /**
   * Thu thập README content
   */
  static collectReadme(rootDir: string): string | undefined {
    const readmeNames = ['README.md', 'readme.md', 'README.MD', 'README.txt', 'README', 'Readme.md'];
    for (const name of readmeNames) {
      const readmePath = path.join(rootDir, name);
      if (fs.existsSync(readmePath)) {
        try {
          const content = fs.readFileSync(readmePath, 'utf-8');
          // Truncate to max 5000 chars
          return content.length > 5000 ? content.substring(0, 5000) + '\n\n... (truncated)' : content;
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }

  /**
   * Collect package info from package.json, requirements.txt, etc.
   */
  static collectPackageInfo(rootDir: string): any | undefined {
    // Try package.json first
    const pkgPath = path.join(rootDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return {
          name: pkg.name,
          version: pkg.version,
          description: pkg.description,
          main: pkg.main,
          scripts: pkg.scripts,
          dependencies: pkg.dependencies,
          devDependencies: pkg.devDependencies,
        };
      } catch { /* ignore */ }
    }

    // Try requirements.txt
    const reqPath = path.join(rootDir, 'requirements.txt');
    if (fs.existsSync(reqPath)) {
      try {
        const content = fs.readFileSync(reqPath, 'utf-8');
        const deps = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        return { type: 'python-requirements', dependencies: deps };
      } catch { /* ignore */ }
    }

    // Try pyproject.toml
    const pyprojectPath = path.join(rootDir, 'pyproject.toml');
    if (fs.existsSync(pyprojectPath)) {
      try {
        const content = fs.readFileSync(pyprojectPath, 'utf-8');
        return { type: 'pyproject', content: content.substring(0, 3000) };
      } catch { /* ignore */ }
    }

    // Try go.mod
    const goModPath = path.join(rootDir, 'go.mod');
    if (fs.existsSync(goModPath)) {
      try {
        const content = fs.readFileSync(goModPath, 'utf-8');
        return { type: 'go-module', content: content.substring(0, 3000) };
      } catch { /* ignore */ }
    }

    return undefined;
  }

  /**
   * Collect config files (Dockerfile, tsconfig, eslint, etc.)
   */
  static collectConfigFiles(rootDir: string): { path: string; type: string; content: string }[] {
    const configs: { path: string; type: string; content: string }[] = [];

    const walk = (dir: string, depth: number = 0) => {
      if (depth > 3) return; // Don't go too deep for config files
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (NOISE_DIRECTORIES.includes(entry.name) || entry.name.startsWith('.')) continue;
          walk(path.join(dir, entry.name), depth + 1);
        } else if (entry.isFile()) {
          const relativePath = path.relative(rootDir, path.join(dir, entry.name)).replace(/\\/g, '/');
          const fileName = entry.name;

          // Check against config patterns
          let configType: string | undefined;
          for (const [pattern, type] of Object.entries(CONFIG_FILE_PATTERNS)) {
            if (fileName === pattern || relativePath === pattern) {
              configType = type;
              break;
            }
            // Glob-like matching for tsconfig.*.json etc.
            if (pattern.includes('*')) {
              const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
              if (regex.test(fileName)) {
                configType = type;
                break;
              }
            }
          }

          if (configType) {
            try {
              const content = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
              configs.push({
                path: relativePath,
                type: configType,
                content: content.length > 3000 ? content.substring(0, 3000) + '\n... (truncated)' : content,
              });
            } catch { /* ignore */ }
          }
        }
      }
    };

    walk(rootDir);
    return configs;
  }

  // ==================== GitHub Integration ====================

  /**
   * Fetch GitHub repository info via API (public repos only)
   */
  static async fetchGithubInfo(githubUrl: string): Promise<GitHubInfo | undefined> {
    // Parse GitHub URL
    const match = githubUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) return undefined;

    const owner = match[1];
    const repoName = match[2].replace(/\.git$/, '');

    try {
      const axios = require('axios');

      const repoResponse = await axios.get(`https://api.github.com/repos/${owner}/${repoName}`, {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
        timeout: 10000,
      });

      const repo = repoResponse.data;

      // Get commit count
      let commitCount = 0;
      try {
        const commitsResp = await axios.get(`https://api.github.com/repos/${owner}/${repoName}/commits?per_page=1`, {
          headers: { 'Accept': 'application/vnd.github.v3+json' },
          timeout: 5000,
        });
        // Parse Link header for total count
        const linkHeader = commitsResp.headers.link;
        if (linkHeader) {
          const lastMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
          if (lastMatch) commitCount = parseInt(lastMatch[1]);
        } else {
          commitCount = commitsResp.data.length;
        }
      } catch { /* ignore */ }

      // Get branches
      let branches: string[] = [];
      try {
        const branchResp = await axios.get(`https://api.github.com/repos/${owner}/${repoName}/branches?per_page=10`, {
          headers: { 'Accept': 'application/vnd.github.v3+json' },
          timeout: 5000,
        });
        branches = branchResp.data.map((b: any) => b.name);
      } catch { /* ignore */ }

      return {
        repoUrl: githubUrl,
        owner,
        repoName,
        stars: repo.stargazers_count,
        commitCount,
        branches,
        lastCommitDate: repo.pushed_at,
        contributors: repo.subscribers_count,
        defaultBranch: repo.default_branch,
      };
    } catch (err: any) {
      logger.warn(`Failed to fetch GitHub info for ${githubUrl}: ${err.message}`);
      return undefined;
    }
  }

  // ==================== Build Project Context ====================

  /**
   * Xây dựng Project Context từ kết quả phân tích
   */
  static buildProjectContext(analysis: ProjectAnalysisResult): ProjectContext {
    return {
      metadata: {
        projectType: analysis.projectType,
        primaryLanguage: analysis.primaryLanguage,
        techStack: {
          languages: analysis.languages,
          frameworks: analysis.frameworks,
          libraries: analysis.libraries,
        },
      },
      structure: {
        totalFiles: analysis.totalFiles,
        totalLines: analysis.totalLines,
        analyzedFiles: analysis.analyzedFiles,
        directoryTree: analysis.directoryStructure,
        entryPoints: analysis.entryPoints,
      },
      artifacts: {
        readme: analysis.readmeContent,
        packageInfo: analysis.packageInfo,
        configFiles: analysis.configFiles,
      },
      sourceIndex: analysis.sourceFileIndex,
      codeChunks: analysis.codeChunks,
      github: analysis.githubInfo,
    };
  }

  // ==================== Main Analysis Pipeline ====================

  /**
   * Phân tích project từ thư mục đã giải nén
   */
  static analyzeProjectDirectory(projectRoot: string, githubInfo?: GitHubInfo): ProjectAnalysisResult {
    logger.info(`Starting project analysis on: ${projectRoot}`);

    // 1. Build directory tree
    const directoryStructure = this.buildDirectoryTree(projectRoot);

    // 2. Detect languages
    const { languages, primaryLanguage } = this.detectLanguages(projectRoot);

    // 3. Collect package info
    const packageInfo = this.collectPackageInfo(projectRoot);

    // 4. Detect frameworks & libraries
    const { frameworks, libraries } = this.detectFrameworksAndLibraries(projectRoot, packageInfo);

    // 5. Detect project type
    const projectType = this.detectProjectType(projectRoot, frameworks, languages);

    // 6. Index source files (imports, exports — NO AI)
    const { index: sourceFileIndex, totalLines, totalFiles, analyzedFiles } = this.indexSourceFiles(projectRoot);

    // 7. Create code chunks
    const codeChunks = this.createCodeChunks(projectRoot, sourceFileIndex);

    // 8. Collect README
    const readmeContent = this.collectReadme(projectRoot);

    // 9. Collect config files
    const configFiles = this.collectConfigFiles(projectRoot);

    // 10. Find entry points
    const entryPoints = sourceFileIndex
      .filter(f => f.isEntryPoint)
      .map(f => f.path);

    logger.info(`Analysis complete: ${totalFiles} files, ${totalLines} lines, ${codeChunks.length} chunks, ${frameworks.length} frameworks`);

    return {
      projectType,
      primaryLanguage,
      languages,
      frameworks,
      libraries,
      directoryStructure,
      totalFiles,
      totalLines,
      analyzedFiles,
      readmeContent,
      packageInfo,
      configFiles,
      sourceFileIndex,
      codeChunks,
      entryPoints,
      githubInfo,
    };
  }

  /**
   * Full pipeline: Phân tích submission từ ZIP
   * 1. Extract ZIP → temp dir
   * 2. Analyze project
   * 3. Build Project Context
   * 4. Save to DB
   * 5. Cleanup temp dir
   */
  static async analyzeZipSubmission(submissionId: string, zipFilePath: string): Promise<void> {
    const tempDir = path.join(process.env.ZIP_EXTRACT_DIR || '/tmp/project-analysis', `sub-${submissionId}-${Date.now()}`);

    try {
      // Update status to ANALYZING
      await prisma.finalProjectSubmission.update({
        where: { id: submissionId },
        data: { processingStatus: ProcessingStatus.ANALYZING, processingError: null },
      });

      // 1. Extract ZIP
      logger.info(`Extracting ZIP for submission ${submissionId}...`);
      await this.extractZip(zipFilePath, tempDir);

      // 2. Find actual project root
      const projectRoot = this.findProjectRoot(tempDir);

      // 3. Analyze
      const analysisResult = this.analyzeProjectDirectory(projectRoot);

      // 4. Build Project Context
      const projectContext = this.buildProjectContext(analysisResult);

      // 5. Save ProjectAnalysis to DB
      const submission = await prisma.finalProjectSubmission.findUnique({
        where: { id: submissionId },
      });

      if (!submission) throw new Error('Submission not found');

      await prisma.projectAnalysis.upsert({
        where: { submissionId },
        create: {
          submissionId,
          learningPathId: submission.learningPathId,
          userId: submission.userId,
          projectType: analysisResult.projectType,
          primaryLanguage: analysisResult.primaryLanguage,
          languages: analysisResult.languages,
          frameworks: analysisResult.frameworks,
          libraries: analysisResult.libraries,
          directoryStructure: analysisResult.directoryStructure as any,
          totalFiles: analysisResult.totalFiles,
          totalLines: analysisResult.totalLines,
          analyzedFiles: analysisResult.analyzedFiles,
          readmeContent: analysisResult.readmeContent,
          packageInfo: analysisResult.packageInfo as any,
          configFiles: analysisResult.configFiles as any,
          sourceFileIndex: analysisResult.sourceFileIndex as any,
          codeChunks: analysisResult.codeChunks as any,
          entryPoints: analysisResult.entryPoints,
          processingStatus: 'COMPLETED',
          analyzedAt: new Date(),
        },
        update: {
          projectType: analysisResult.projectType,
          primaryLanguage: analysisResult.primaryLanguage,
          languages: analysisResult.languages,
          frameworks: analysisResult.frameworks,
          libraries: analysisResult.libraries,
          directoryStructure: analysisResult.directoryStructure as any,
          totalFiles: analysisResult.totalFiles,
          totalLines: analysisResult.totalLines,
          analyzedFiles: analysisResult.analyzedFiles,
          readmeContent: analysisResult.readmeContent,
          packageInfo: analysisResult.packageInfo as any,
          configFiles: analysisResult.configFiles as any,
          sourceFileIndex: analysisResult.sourceFileIndex as any,
          codeChunks: analysisResult.codeChunks as any,
          entryPoints: analysisResult.entryPoints,
          processingStatus: 'COMPLETED',
          analyzedAt: new Date(),
        },
      });

      // 6. Update submission with Project Context and status
      await prisma.finalProjectSubmission.update({
        where: { id: submissionId },
        data: {
          processingStatus: ProcessingStatus.READY_FOR_EVALUATION,
          projectContext: projectContext as any,
          processingError: null,
        },
      });

      logger.info(`Submission ${submissionId} analyzed successfully: ${analysisResult.totalFiles} files, ready for evaluation`);
    } catch (error: any) {
      logger.error(`Analysis failed for submission ${submissionId}:`, error);

      // Update status to FAILED
      await prisma.finalProjectSubmission.update({
        where: { id: submissionId },
        data: {
          processingStatus: ProcessingStatus.ANALYSIS_FAILED,
          processingError: error.message || 'Unknown analysis error',
        },
      });

      // Also update ProjectAnalysis if it exists
      try {
        await prisma.projectAnalysis.updateMany({
          where: { submissionId },
          data: { processingStatus: 'FAILED', errorMessage: error.message },
        });
      } catch { /* ignore — may not exist yet */ }
    } finally {
      // Cleanup temp extraction directory
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (cleanErr) {
        logger.warn(`Failed to cleanup temp dir ${tempDir}:`, cleanErr);
      }
    }
  }

  /**
   * Full pipeline: Phân tích submission từ GitHub URL
   */
  static async analyzeGithubSubmission(submissionId: string, githubUrl: string): Promise<void> {
    const tempDir = path.join(process.env.ZIP_EXTRACT_DIR || '/tmp/project-analysis', `gh-${submissionId}-${Date.now()}`);

    try {
      // Update status to ANALYZING
      await prisma.finalProjectSubmission.update({
        where: { id: submissionId },
        data: { processingStatus: ProcessingStatus.ANALYZING, processingError: null },
      });

      // 1. Fetch GitHub info
      const githubInfo = await this.fetchGithubInfo(githubUrl);

      // 2. Clone repository (shallow clone for analysis)
      logger.info(`Cloning GitHub repo for submission ${submissionId}: ${githubUrl}`);
      fs.mkdirSync(tempDir, { recursive: true });

      try {
        childProcess.execSync(
          `git clone --depth 1 "${githubUrl}" "${tempDir}"`,
          { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
        );
      } catch (cloneErr: any) {
        throw new Error(`${PROJECT_ANALYSIS_ERRORS.GITHUB_FETCH_FAILED}: ${cloneErr.message}`);
      }

      // 3. Security validation
      await this.validateExtractedContent(tempDir, {
        maxZipSizeMB: ZIP_SECURITY_DEFAULTS.MAX_ZIP_SIZE_MB,
        maxExtractedSizeMB: ZIP_SECURITY_DEFAULTS.MAX_EXTRACTED_SIZE_MB,
        maxFileCount: ZIP_SECURITY_DEFAULTS.MAX_FILE_COUNT,
        maxSingleFileSizeMB: ZIP_SECURITY_DEFAULTS.MAX_SINGLE_FILE_SIZE_MB,
      });

      // 4. Analyze
      const analysisResult = this.analyzeProjectDirectory(tempDir, githubInfo);

      // 5. Build Project Context
      const projectContext = this.buildProjectContext(analysisResult);

      // 6. Save to DB
      const submission = await prisma.finalProjectSubmission.findUnique({
        where: { id: submissionId },
      });

      if (!submission) throw new Error('Submission not found');

      await prisma.projectAnalysis.upsert({
        where: { submissionId },
        create: {
          submissionId,
          learningPathId: submission.learningPathId,
          userId: submission.userId,
          projectType: analysisResult.projectType,
          primaryLanguage: analysisResult.primaryLanguage,
          languages: analysisResult.languages,
          frameworks: analysisResult.frameworks,
          libraries: analysisResult.libraries,
          directoryStructure: analysisResult.directoryStructure as any,
          totalFiles: analysisResult.totalFiles,
          totalLines: analysisResult.totalLines,
          analyzedFiles: analysisResult.analyzedFiles,
          readmeContent: analysisResult.readmeContent,
          packageInfo: analysisResult.packageInfo as any,
          configFiles: analysisResult.configFiles as any,
          sourceFileIndex: analysisResult.sourceFileIndex as any,
          codeChunks: analysisResult.codeChunks as any,
          entryPoints: analysisResult.entryPoints,
          githubInfo: analysisResult.githubInfo as any,
          processingStatus: 'COMPLETED',
          analyzedAt: new Date(),
        },
        update: {
          projectType: analysisResult.projectType,
          primaryLanguage: analysisResult.primaryLanguage,
          languages: analysisResult.languages,
          frameworks: analysisResult.frameworks,
          libraries: analysisResult.libraries,
          directoryStructure: analysisResult.directoryStructure as any,
          totalFiles: analysisResult.totalFiles,
          totalLines: analysisResult.totalLines,
          analyzedFiles: analysisResult.analyzedFiles,
          readmeContent: analysisResult.readmeContent,
          packageInfo: analysisResult.packageInfo as any,
          configFiles: analysisResult.configFiles as any,
          sourceFileIndex: analysisResult.sourceFileIndex as any,
          codeChunks: analysisResult.codeChunks as any,
          entryPoints: analysisResult.entryPoints,
          githubInfo: analysisResult.githubInfo as any,
          processingStatus: 'COMPLETED',
          analyzedAt: new Date(),
        },
      });

      // 7. Update submission
      await prisma.finalProjectSubmission.update({
        where: { id: submissionId },
        data: {
          processingStatus: ProcessingStatus.READY_FOR_EVALUATION,
          projectContext: projectContext as any,
          processingError: null,
        },
      });

      logger.info(`GitHub submission ${submissionId} analyzed successfully`);
    } catch (error: any) {
      logger.error(`GitHub analysis failed for submission ${submissionId}:`, error);

      await prisma.finalProjectSubmission.update({
        where: { id: submissionId },
        data: {
          processingStatus: ProcessingStatus.ANALYSIS_FAILED,
          processingError: error.message || 'Unknown analysis error',
        },
      });

      try {
        await prisma.projectAnalysis.updateMany({
          where: { submissionId },
          data: { processingStatus: 'FAILED', errorMessage: error.message },
        });
      } catch { /* ignore */ }
    } finally {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (cleanErr) {
        logger.warn(`Failed to cleanup temp dir ${tempDir}:`, cleanErr);
      }
    }
  }
}
