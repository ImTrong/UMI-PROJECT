export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const ERROR_MESSAGES = {
  USER_NOT_FOUND: 'User not found',
  COURSE_NOT_FOUND: 'Course not found',
  LESSON_NOT_FOUND: 'Lesson not found',
  PROGRESS_NOT_FOUND: 'Progress not found',
  CERTIFICATE_NOT_FOUND: 'Certificate not found',
  CERTIFICATE_ALREADY_EXISTS: 'Certificate already exists for this course',
  COURSE_NOT_COMPLETED: 'Course not completed yet',
  COURSE_NOT_PASSED: 'Course exam not passed. You need to retake the course.',
  RETAKE_NOT_ALLOWED: 'Course retake is not allowed. You have already passed.',
  INVALID_ACTION: 'Invalid action',
  UNAUTHORIZED: 'Unauthorized access',
  FORBIDDEN: 'Access forbidden',
  BADGE_NOT_FOUND: 'Badge not found',
  FINAL_PROJECT_NOT_FOUND: 'Final project not found',
  FINAL_PROJECT_EXISTS: 'A final project already exists for this learning path',
  SUBMISSION_NOT_FOUND: 'Submission not found',
  PATH_NOT_COMPLETED: 'Learning path not completed yet',
  PATH_CERTIFICATE_EXISTS: 'Path certificate already exists',
  PROJECT_SCORE_NOT_ENOUGH: 'Final project score is below 80%. Certificate cannot be issued.',
} as const;

export const SUCCESS_MESSAGES = {
  LESSON_COMPLETED: 'Lesson marked as completed',
  COURSE_COMPLETED: 'Course completed successfully',
  CERTIFICATE_GENERATED: 'Chứng nhận đã được tạo thành công',
  CERTIFICATE_VERIFIED: 'Certificate verified successfully',
  ACTIVITY_LOGGED: 'Activity logged successfully',
  BADGE_EARNED: 'Badge earned successfully',
  COURSE_RETAKE_SUCCESS: 'Đã reset tiến độ khóa học. Bạn có thể học lại miễn phí.',
  FINAL_PROJECT_CREATED: 'Final project created successfully',
  FINAL_PROJECT_SUBMITTED: 'Bài nộp đã được gửi thành công',
  FINAL_PROJECT_GRADED: 'Bài nộp đã được chấm điểm',
  PATH_CERTIFICATE_GENERATED: 'Chứng chỉ lộ trình đã được tạo thành công',
} as const;

// ==================== Video Streaming Constants ====================

export const STREAM_ERROR_MESSAGES = {
  INVALID_TOKEN: 'Authentication required. Please login to access this content.',
  COURSE_NOT_PURCHASED: 'You must purchase this course to access the video content.',
  LESSON_NOT_FOUND: 'Lesson not found.',
  COURSE_NOT_FOUND: 'Course not found.',
  INSTRUCTOR_NOT_FOUND: 'Course instructor not found.',
  VIDEO_NOT_FOUND: 'Video file not found in storage.',
  INVALID_LESSON_ID: 'Invalid lesson ID format.',
  COURSE_SERVICE_ERROR: 'Failed to communicate with course service.',
  STORAGE_ERROR: 'Failed to access video storage.',
  PRESIGNED_URL_ERROR: 'Failed to generate video streaming URL.',
  PRESIGNED_URL_EXPIRED: 'Stream token has expired. Please refresh the video player.',
  INTERNAL_ERROR: 'An unexpected error occurred while processing your request.',
} as const;

export const STREAM_SUCCESS_MESSAGES = {
  STREAM_URL_GENERATED: 'Stream URL generated successfully.',
} as const;

// ==================== HLS Processing Constants ====================

export const HLS_ERROR_MESSAGES = {
  NO_VIDEO_FILE: 'No video file uploaded.',
  INVALID_VIDEO_FORMAT: 'Invalid video format. Supported: mp4, mov, avi, mkv, webm.',
  INVALID_COURSE_ID: 'Invalid course ID format.',
  INVALID_JOB_ID: 'Invalid job ID format.',
  JOB_NOT_FOUND: 'Video processing job not found.',
  HLS_NOT_READY: 'HLS video is not ready yet. The video may not have been processed.',
  PROCESSING_FAILED: 'Video processing failed. Please try re-uploading the video.',
  UPLOAD_SUCCESS: 'Video uploaded successfully. Processing started.',
  FFMPEG_NOT_FOUND: 'FFmpeg is not installed or not accessible.',
} as const;

// ==================== Project Analysis Constants ====================

export const PROJECT_ANALYSIS_ERRORS = {
  ZIP_TOO_LARGE: 'File ZIP vượt quá giới hạn kích thước cho phép',
  EXTRACTED_TOO_LARGE: 'Tổng dung lượng sau giải nén vượt quá giới hạn',
  TOO_MANY_FILES: 'Project chứa quá nhiều file',
  SINGLE_FILE_TOO_LARGE: 'Một file trong project vượt quá giới hạn kích thước',
  PATH_TRAVERSAL_DETECTED: 'Phát hiện path traversal trong file ZIP — từ chối xử lý',
  INVALID_ZIP: 'File ZIP không hợp lệ hoặc bị hỏng',
  ANALYSIS_FAILED: 'Phân tích project thất bại',
  SUBMISSION_NOT_ANALYZABLE: 'Submission không ở trạng thái có thể phân tích',
  INVALID_GITHUB_URL: 'URL GitHub không hợp lệ',
  GITHUB_FETCH_FAILED: 'Không thể truy xuất thông tin từ GitHub',
  NO_SOURCE_PROVIDED: 'Vui lòng cung cấp file ZIP hoặc GitHub URL',
  ANALYSIS_NOT_FOUND: 'Không tìm thấy kết quả phân tích project',
  NOT_READY_FOR_EVALUATION: 'Project chưa sẵn sàng để đánh giá. Vui lòng chờ phân tích hoàn tất.',
} as const;

export const PROJECT_ANALYSIS_SUCCESS = {
  ZIP_UPLOADED: 'File ZIP đã được upload thành công. Đang phân tích project...',
  GITHUB_SUBMITTED: 'GitHub URL đã được gửi thành công. Đang phân tích project...',
  ANALYSIS_COMPLETED: 'Phân tích project hoàn tất. Sẵn sàng để đánh giá.',
  RETRY_STARTED: 'Đang phân tích lại project...',
} as const;

/** Giới hạn bảo mật mặc định cho ZIP extraction */
export const ZIP_SECURITY_DEFAULTS = {
  MAX_ZIP_SIZE_MB: 100,
  MAX_EXTRACTED_SIZE_MB: 500,
  MAX_FILE_COUNT: 5000,
  MAX_SINGLE_FILE_SIZE_MB: 50,
} as const;

/** Thư mục và file cần loại bỏ khi phân tích project */
export const NOISE_DIRECTORIES: string[] = [
  'node_modules', '.git', 'dist', 'build', 'out', '__pycache__',
  '.next', '.nuxt', '.svelte-kit', 'vendor', '.vscode', '.idea',
  '.vs', 'coverage', '.nyc_output', '.cache', '.parcel-cache',
  'target', 'bin', 'obj', '.gradle', '.mvn', 'venv', '.venv',
  'env', '.env', '.tox', 'eggs', '*.egg-info',
];

export const NOISE_FILE_PATTERNS = [
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.lock$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.pyc$/,
  /\.class$/,
  /\.exe$/,
  /\.dll$/,
  /\.so$/,
  /\.dylib$/,
  /\.o$/,
  /\.a$/,
  /\.(jpg|jpeg|png|gif|svg|ico|bmp|webp)$/i,
  /\.(mp4|mp3|wav|avi|mov|mkv|flac)$/i,
  /\.(pdf|zip|tar\.gz|rar|7z)$/i,
  /\.(woff|woff2|ttf|eot|otf)$/i,
  /\.DS_Store$/,
  /Thumbs\.db$/,
] as const;

/** Extension → Language mapping */
export const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python',
  '.java': 'Java',
  '.cs': 'C#',
  '.cpp': 'C++', '.cc': 'C++', '.cxx': 'C++', '.hpp': 'C++',
  '.c': 'C', '.h': 'C',
  '.go': 'Go',
  '.rs': 'Rust',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.kt': 'Kotlin', '.kts': 'Kotlin',
  '.dart': 'Dart',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.html': 'HTML', '.htm': 'HTML',
  '.css': 'CSS', '.scss': 'SCSS', '.sass': 'SASS', '.less': 'LESS',
  '.sql': 'SQL',
  '.sh': 'Shell', '.bash': 'Shell',
  '.yaml': 'YAML', '.yml': 'YAML',
  '.json': 'JSON',
  '.xml': 'XML',
  '.md': 'Markdown',
  '.r': 'R', '.R': 'R',
  '.lua': 'Lua',
  '.ex': 'Elixir', '.exs': 'Elixir',
  '.scala': 'Scala',
  '.hs': 'Haskell',
} as const;

/** Config file patterns → types */
export const CONFIG_FILE_PATTERNS: Record<string, string> = {
  'package.json': 'package',
  'tsconfig.json': 'tsconfig',
  'tsconfig.*.json': 'tsconfig',
  '.eslintrc': 'eslint', '.eslintrc.js': 'eslint', '.eslintrc.json': 'eslint',
  '.prettierrc': 'prettier', '.prettierrc.js': 'prettier',
  'Dockerfile': 'docker', 'docker-compose.yml': 'docker', 'docker-compose.yaml': 'docker',
  '.env.example': 'env',
  'webpack.config.js': 'webpack', 'webpack.config.ts': 'webpack',
  'vite.config.ts': 'vite', 'vite.config.js': 'vite',
  'next.config.js': 'nextjs', 'next.config.mjs': 'nextjs', 'next.config.ts': 'nextjs',
  'nuxt.config.ts': 'nuxtjs', 'nuxt.config.js': 'nuxtjs',
  'tailwind.config.js': 'tailwind', 'tailwind.config.ts': 'tailwind',
  'jest.config.js': 'jest', 'jest.config.ts': 'jest',
  'vitest.config.ts': 'vitest',
  '.babelrc': 'babel', 'babel.config.js': 'babel',
  'requirements.txt': 'pip',
  'setup.py': 'setuptools',
  'pyproject.toml': 'pyproject',
  'Pipfile': 'pipenv',
  'pom.xml': 'maven',
  'build.gradle': 'gradle', 'build.gradle.kts': 'gradle',
  'Cargo.toml': 'cargo',
  'go.mod': 'gomod',
  'Gemfile': 'bundler',
  'Makefile': 'make',
  'CMakeLists.txt': 'cmake',
  '.gitignore': 'gitignore',
  'prisma/schema.prisma': 'prisma',
} as const;

/** Code chunk size configuration */
export const CODE_CHUNK_CONFIG = {
  MAX_LINES_PER_CHUNK: 100,      // Tối đa 100 dòng mỗi chunk
  MAX_CHUNKS_PER_FILE: 10,       // Tối đa 10 chunks mỗi file
  MAX_TOTAL_CHUNKS: 500,         // Tối đa 500 chunks toàn project
  MAX_FILE_LINES_TO_CHUNK: 2000, // Bỏ qua file > 2000 dòng (generated code)
} as const;
