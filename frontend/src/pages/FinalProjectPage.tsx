import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useParams, useNavigate } from 'react-router-dom';
import { learningService, FinalProject, FinalProjectSubmission, StageResult, SubmissionDataItem, SubmissionTypeConfig, SubmissionFieldType } from '../services/learning.service';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { 
  FiCheckCircle, FiXCircle, FiArrowLeft, FiAward, FiSend, 
  FiClock, FiTarget, FiStar, FiLink, FiBookOpen, 
  FiChevronDown, FiChevronUp, FiCpu, FiUpload, FiFile,
  FiGithub, FiImage, FiVideo, FiMusic, FiEdit3, FiExternalLink
} from 'react-icons/fi';

// Icon and label mappings for submission types
const SUBMISSION_TYPE_META: Record<SubmissionFieldType, { icon: React.ReactNode; color: string }> = {
  FILE: { icon: <FiFile />, color: 'text-blue-600' },
  IMAGE: { icon: <FiImage />, color: 'text-pink-600' },
  VIDEO: { icon: <FiVideo />, color: 'text-purple-600' },
  AUDIO: { icon: <FiMusic />, color: 'text-orange-600' },
  GITHUB_LINK: { icon: <FiGithub />, color: 'text-slate-800' },
  DEMO_LINK: { icon: <FiExternalLink />, color: 'text-teal-600' },
  FIGMA_LINK: { icon: <FiEdit3 />, color: 'text-violet-600' },
  TEXT: { icon: <FiEdit3 />, color: 'text-slate-600' },
  CUSTOM: { icon: <FiLink />, color: 'text-slate-500' },
};

export default function FinalProjectPage() {
  const { pathId } = useParams<{ pathId: string }>();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  
  const [project, setProject] = useState<FinalProject | null>(null);
  const [submissions, setSubmissions] = useState<FinalProjectSubmission[]>([]);
  const [submission, setSubmission] = useState<FinalProjectSubmission | null>(null);
  const [unlockStatus, setUnlockStatus] = useState<{ unlocked: boolean; reasons: string[] } | null>(null);
  
  const [loading, setLoading] = useState(true);
  
  // Legacy fields (fallback when no submissionTypes configured)
  const [content, setContent] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [demoUrl, setDemoUrl] = useState('');
  
  // Dynamic submission data
  const [submissionDataMap, setSubmissionDataMap] = useState<Record<string, SubmissionDataItem>>({});
  
  const [submitting, setSubmitting] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [generatingCert, setGeneratingCert] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<Record<string, boolean>>({});
  
  const [showHistory, setShowHistory] = useState(false);
  const [showRubric, setShowRubric] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !pathId) return;
    loadData();
  }, [isAuthenticated, pathId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Check unlock status
      const status = await learningService.getFinalProjectUnlockStatus(pathId!);
      setUnlockStatus(status);

      // 2. Load project details
      const proj = await learningService.getFinalProject(pathId!);
      setProject(proj);

      if (proj) {
        // 3. Load all submissions
        const allSubs = await learningService.getMyAllFinalProjectSubmissions(proj.id);
        setSubmissions(allSubs);
        
        if (allSubs.length > 0) {
          const latest = allSubs[0];
          setSubmission(latest);
          if (latest.content) setContent(latest.content);
          if (latest.githubUrl) setGithubUrl(latest.githubUrl);
          if (latest.demoUrl) setDemoUrl(latest.demoUrl);

          // Populate dynamic submission data
          if (latest.submissionData && proj.submissionTypes) {
            const dataMap: Record<string, SubmissionDataItem> = {};
            proj.submissionTypes.forEach((st, index) => {
              const key = `${st.type}_${index}`;
              const found = latest.submissionData?.find(item => item.type === st.type && item.label === st.label);
              if (found) {
                dataMap[key] = found;
              }
            });
            setSubmissionDataMap(dataMap);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load final project:', error);
    } finally {
      setLoading(false);
    }
  };

  // Check if admin configured submission types
  const hasSubmissionTypes = project?.submissionTypes && project.submissionTypes.length > 0;

  const getDataKey = (st: SubmissionTypeConfig, index: number) => `${st.type}_${index}`;

  const handleUpdateSubmissionData = (key: string, st: SubmissionTypeConfig, value: string, extra?: Partial<SubmissionDataItem>) => {
    setSubmissionDataMap(prev => ({
      ...prev,
      [key]: {
        type: st.type,
        label: st.label,
        value,
        ...extra,
      },
    }));
  };

  const handleFileUpload = async (key: string, st: SubmissionTypeConfig, file: File) => {
    if (!project) return;
    
    // Check file size
    const maxSizeMB = st.maxSizeMB || project.maxFileSizeMB || 50;
    if (file.size > maxSizeMB * 1024 * 1024) {
      toast.error(`File quá lớn! Giới hạn: ${maxSizeMB}MB`);
      return;
    }
    
    setUploadingFiles(prev => ({ ...prev, [key]: true }));
    try {
      const result = await learningService.getFinalProjectUploadUrl(project.id, file.name, file.type);
      
      // Upload file to presigned URL
      await fetch(result.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      
      handleUpdateSubmissionData(key, st, result.fileUrl, {
        fileName: file.name,
        fileKey: result.fileKey,
        fileSize: file.size,
      });
      
      toast.success(`Tải lên "${file.name}" thành công!`);
    } catch (error) {
      toast.error('Không thể tải lên file. Vui lòng thử lại.');
    } finally {
      setUploadingFiles(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleSubmit = async () => {
    if (!project || !pathId) return;
    
    setSubmitting(true);
    try {
      let submitData: any = { learningPathId: pathId };
      
      if (hasSubmissionTypes) {
        // Build submissionData array from map
        const items: SubmissionDataItem[] = Object.values(submissionDataMap).filter(item => item.value);
        submitData.submissionData = items;
        
        // Also set legacy fields for backward compatibility
        const textItem = items.find(i => i.type === 'TEXT');
        const ghItem = items.find(i => i.type === 'GITHUB_LINK');
        const demoItem = items.find(i => i.type === 'DEMO_LINK');
        if (textItem) submitData.content = textItem.value;
        if (ghItem) submitData.githubUrl = ghItem.value;
        if (demoItem) submitData.demoUrl = demoItem.value;
      } else {
        // Legacy mode
        if (!content.trim() && !githubUrl.trim()) {
          toast.error('Vui lòng nhập nội dung hoặc đường dẫn bài làm');
          setSubmitting(false);
          return;
        }
        submitData.content = content;
        submitData.githubUrl = githubUrl;
        submitData.demoUrl = demoUrl;
      }
      
      const sub = await learningService.submitFinalProject(project.id, submitData);
      setSubmission(sub);
      setSubmissions([sub, ...submissions]);
      toast.success('Nộp bài thành công! Đang chuyển sang AI chấm điểm...');
      
      // Auto-trigger evaluation
      handleEvaluate(sub.id);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Không thể nộp bài');
      setSubmitting(false);
    }
  };

  const handleEvaluate = async (subId: string) => {
    setEvaluating(true);
    try {
      await learningService.evaluateSubmission(subId);
      // Reload data to get updated submission
      const allSubs = await learningService.getMyAllFinalProjectSubmissions(project!.id);
      setSubmissions(allSubs);
      setSubmission(allSubs[0]);
      toast.success('AI đã chấm điểm xong!');
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Không thể chấm điểm');
    } finally {
      setEvaluating(false);
      setSubmitting(false); // Clear submitting state just in case
    }
  };

  const handleGeneratePathCert = async () => {
    if (!pathId) return;
    setGeneratingCert(true);
    try {
      await learningService.generatePathCertificate(pathId);
      toast.success('Chứng chỉ lộ trình đã được tạo thành công!');
      navigate('/certificates');
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Không thể tạo chứng chỉ');
    } finally {
      setGeneratingCert(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center">
        <FiStar className="mx-auto text-4xl text-slate-400 mb-4" />
        <h2 className="text-xl font-semibold text-slate-900 mb-2">Chưa có project cuối kỳ</h2>
        <p className="text-slate-600 mb-6">Lộ trình này chưa thiết lập project cuối kỳ.</p>
        <button onClick={() => navigate(-1)} className="btn-primary">Quay lại</button>
      </div>
    );
  }

  const isGraded = submission?.status === 'GRADED';
  const isPassed = isGraded && submission?.totalScore !== undefined && submission.totalScore !== null
    && submission.totalScore >= project.passingScore;
  const attemptsUsed = submissions.length;
  const canResubmit = !isPassed && attemptsUsed < project.maxAttempts;

  // Render a single submission type field
  const renderSubmissionField = (st: SubmissionTypeConfig, index: number) => {
    const key = getDataKey(st, index);
    const meta = SUBMISSION_TYPE_META[st.type];
    const currentData = submissionDataMap[key];
    const isUploading = uploadingFiles[key];
    
    const isFileType = ['FILE', 'IMAGE', 'VIDEO', 'AUDIO'].includes(st.type);
    const isLinkType = ['GITHUB_LINK', 'DEMO_LINK', 'FIGMA_LINK', 'CUSTOM'].includes(st.type);
    const isTextType = st.type === 'TEXT';

    return (
      <div key={key} className="bg-white border border-slate-200 rounded-xl p-5 hover:border-primary-300 transition-colors">
        <div className="flex items-center gap-2 mb-3">
          <span className={`text-lg ${meta.color}`}>{meta.icon}</span>
          <span className="font-bold text-sm text-slate-800">{st.label}</span>
          {st.required && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold">Bắt buộc</span>}
        </div>
        {st.description && <p className="text-xs text-slate-500 mb-3">{st.description}</p>}

        {isFileType && (
          <div>
            {currentData?.fileName ? (
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <FiCheckCircle className="text-green-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{currentData.fileName}</p>
                  {currentData.fileSize && <p className="text-xs text-slate-500">{(currentData.fileSize / 1024 / 1024).toFixed(2)} MB</p>}
                </div>
                <label className="cursor-pointer text-xs text-primary-600 font-bold hover:underline">
                  Thay đổi
                  <input type="file" className="hidden" accept={st.accept || ''} onChange={e => e.target.files?.[0] && handleFileUpload(key, st, e.target.files[0])} />
                </label>
              </div>
            ) : (
              <label className={`flex flex-col items-center gap-2 border-2 border-dashed rounded-xl p-6 cursor-pointer transition-colors ${isUploading ? 'border-primary-300 bg-primary-50' : 'border-slate-300 hover:border-primary-400 hover:bg-primary-50/30'}`}>
                {isUploading ? (
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                ) : (
                  <FiUpload className="text-2xl text-slate-400" />
                )}
                <span className="text-sm text-slate-600">{isUploading ? 'Đang tải lên...' : 'Chọn file để tải lên'}</span>
                {st.accept && <span className="text-xs text-slate-400">Định dạng: {st.accept}</span>}
                {st.maxSizeMB && <span className="text-xs text-slate-400">Tối đa: {st.maxSizeMB}MB</span>}
                <input type="file" className="hidden" accept={st.accept || ''} disabled={isUploading} onChange={e => e.target.files?.[0] && handleFileUpload(key, st, e.target.files[0])} />
              </label>
            )}
          </div>
        )}

        {isLinkType && (
          <input
            type="url"
            value={currentData?.value || ''}
            onChange={e => handleUpdateSubmissionData(key, st, e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all text-sm"
            placeholder={st.placeholder || 'Nhập đường dẫn...'}
          />
        )}

        {isTextType && (
          <textarea
            value={currentData?.value || ''}
            onChange={e => handleUpdateSubmissionData(key, st, e.target.value)}
            rows={4}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all resize-y"
            placeholder={st.placeholder || 'Nhập nội dung...'}
          />
        )}
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Back button */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-500 hover:text-primary-600 mb-6 transition-colors">
        <FiArrowLeft /> Quay lại lộ trình
      </button>

      {/* Project Header */}
      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-2xl p-6 mb-8">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white shadow-sm flex-shrink-0">
            <FiStar size={28} />
          </div>
          <div className="flex-1">
            <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">Dự án cuối kỳ</span>
            <h1 className="text-3xl font-bold text-slate-900 mt-1">{project.title}</h1>
            <p className="text-slate-600 mt-2 text-lg">{project.description}</p>
            
            <div className="flex flex-wrap gap-4 mt-4 text-sm font-medium">
              <span className="flex items-center gap-1 bg-white/60 px-3 py-1 rounded-lg border border-indigo-100 text-indigo-700">
                <FiTarget /> Ngưỡng đạt: {project.passingScore}%
              </span>
              <span className="flex items-center gap-1 bg-white/60 px-3 py-1 rounded-lg border border-indigo-100 text-indigo-700">
                <FiStar /> Điểm tối đa: {project.maxScore}
              </span>
              <span className="flex items-center gap-1 bg-white/60 px-3 py-1 rounded-lg border border-indigo-100 text-indigo-700">
                <FiClock /> Số lần nộp: {project.maxAttempts}
              </span>
            </div>
          </div>
        </div>

        {unlockStatus?.unlocked && (project.objectives || project.instructions) && (
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {project.objectives && (
              <div className="p-4 bg-white/70 rounded-xl border border-indigo-100">
                <h3 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-2">
                  <FiTarget className="text-indigo-500" /> Mục tiêu đầu ra
                </h3>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{project.objectives}</p>
              </div>
            )}
            {project.instructions && (
              <div className="p-4 bg-white/70 rounded-xl border border-indigo-100">
                <h3 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-2">
                  <FiBookOpen className="text-indigo-500" /> Hướng dẫn làm bài
                </h3>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{project.instructions}</p>
              </div>
            )}
          </div>
        )}

        {/* Submission Types Info */}
        {unlockStatus?.unlocked && hasSubmissionTypes && (
          <div className="mt-4 p-4 bg-white/70 rounded-xl border border-indigo-100">
            <h3 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-2">
              <FiFile className="text-indigo-500" /> Loại bài nộp yêu cầu
            </h3>
            <div className="flex flex-wrap gap-2">
              {project.submissionTypes!.map((st, i) => {
                const meta = SUBMISSION_TYPE_META[st.type];
                return (
                  <span key={i} className="inline-flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700">
                    <span className={meta.color}>{meta.icon}</span> {st.label}
                    {st.required && <span className="text-red-400">*</span>}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Rubric Preview (Evaluation Criteria) */}
      {unlockStatus?.unlocked && project.evaluationPipeline && project.evaluationPipeline.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm mb-8 overflow-hidden">
          <button
            onClick={() => setShowRubric(!showRubric)}
            className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition-colors"
          >
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <FiTarget className="text-indigo-500" /> Bộ tiêu chí đánh giá ({project.evaluationPipeline.length} tiêu chí)
            </h3>
            {showRubric ? <FiChevronUp /> : <FiChevronDown />}
          </button>
          
          {showRubric && (
            <div className="px-5 pb-5 space-y-3">
              <p className="text-xs text-slate-500 mb-2">AI sẽ đánh giá bài nộp của bạn dựa trên các tiêu chí sau. Hãy đảm bảo bài làm đáp ứng đầy đủ.</p>
              {project.evaluationPipeline.map((stage) => (
                <div key={stage.stageNumber} className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold">{stage.stageNumber}</span>
                      <h4 className="font-bold text-slate-800 text-sm">{stage.title}</h4>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-bold">{stage.maxScore} đ</span>
                      <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded font-bold">×{stage.weight}</span>
                    </div>
                  </div>
                  {stage.objective && <p className="text-xs text-slate-600 mb-1"><strong>Mục tiêu:</strong> {stage.objective}</p>}
                  <p className="text-xs text-slate-600 mb-1"><strong>Tiêu chí:</strong> {stage.criteria}</p>
                  {stage.expectedOutput && <p className="text-xs text-blue-600"><strong>Kết quả mong muốn:</strong> {stage.expectedOutput}</p>}
                  {stage.passCriteria && <p className="text-xs text-amber-600"><strong>Điều kiện đạt:</strong> {stage.passCriteria}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lock Status */}
      {!unlockStatus?.unlocked && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 mb-8 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-500 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Bài kiểm tra đang bị khóa</h2>
          <p className="text-slate-600 mb-4">Bạn cần hoàn thành các yêu cầu sau để mở khóa:</p>
          <ul className="text-left max-w-md mx-auto space-y-2 mb-6">
            {unlockStatus?.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-amber-700">
                <FiXCircle className="mt-0.5 shrink-0" /> {r}
              </li>
            ))}
          </ul>
          <button onClick={() => navigate(-1)} className="btn-primary">Quay lại tiếp tục học</button>
        </div>
      )}

      {/* Evaluation Results (If Graded) */}
      {unlockStatus?.unlocked && isGraded && submission && (
        <div className={`rounded-2xl border p-6 mb-8 shadow-sm ${isPassed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex flex-col md:flex-row items-center gap-6">
            <div className={`w-32 h-32 shrink-0 rounded-full border-8 flex flex-col items-center justify-center bg-white ${isPassed ? 'border-green-400' : 'border-red-400'}`}>
              <span className={`text-4xl font-bold ${isPassed ? 'text-green-600' : 'text-red-500'}`}>
                {typeof submission.totalScore === 'number' ? Math.round(submission.totalScore) : submission.totalScore}
              </span>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-1">/ {project.maxScore}</span>
            </div>
            <div className="flex-1 text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
                {isPassed ? (
                  <>
                    <FiCheckCircle className="text-green-500" size={24} />
                    <span className="text-2xl font-bold text-green-700">ĐẠT YÊU CẦU</span>
                  </>
                ) : (
                  <>
                    <FiXCircle className="text-red-500" size={24} />
                    <span className="text-2xl font-bold text-red-600">CHƯA ĐẠT</span>
                  </>
                )}
              </div>
              <p className="text-slate-600 mb-4">
                {isPassed 
                  ? 'Tuyệt vời! Bạn đã vượt qua bài kiểm tra cuối kỳ và đủ điều kiện nhận chứng chỉ lộ trình.'
                  : `Bài làm của bạn đạt ${typeof submission.totalScore === 'number' ? Math.round(submission.totalScore) : submission.totalScore}%. Điểm yêu cầu: ${project.passingScore}%. Xem phản hồi bên dưới để cải thiện.`}
              </p>
              
              {isPassed && (
                <button
                  onClick={handleGeneratePathCert}
                  disabled={generatingCert}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-amber-500 to-yellow-500 text-white rounded-xl font-bold hover:from-amber-600 hover:to-yellow-600 transition-all shadow-md hover:shadow-lg disabled:opacity-50"
                >
                  <FiAward size={20} />
                  {generatingCert ? 'Đang tạo chứng chỉ...' : 'Nhận Chứng Chỉ Lộ Trình'}
                </button>
              )}
            </div>
          </div>

          {/* Detailed Stage Results with Progress Bars */}
          {submission.stageResults && submission.stageResults.length > 0 && (
            <div className="mt-8">
              <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                <FiTarget className="text-indigo-500" /> Chi tiết từng tiêu chí đánh giá
              </h3>
              <div className="space-y-3">
                {submission.stageResults.map((stage: StageResult) => (
                  <div key={stage.stageNumber} className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${stage.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {stage.stageNumber}
                        </span>
                        <h4 className="font-semibold text-slate-800">{stage.title}</h4>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${stage.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {stage.passed ? '✅ ĐẠT' : '❌ CHƯA ĐẠT'}
                      </span>
                    </div>
                    
                    {/* Progress bar */}
                    <div className="mb-3">
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Điểm: {stage.score}/{stage.maxScore}</span>
                        <span>Trọng số: {stage.weightedScore}%</span>
                      </div>
                      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${stage.passed ? 'bg-green-500' : 'bg-red-400'}`}
                          style={{ width: `${Math.min(100, (stage.score / stage.maxScore) * 100)}%` }}
                        />
                      </div>
                    </div>
                    
                    <p className="text-sm text-slate-600 mb-3">{stage.feedback}</p>
                    {stage.details && stage.details.length > 0 && (
                      <ul className="text-sm space-y-1 bg-slate-50 p-3 rounded-lg">
                        {stage.details.map((detail, idx) => (
                          <li key={idx} className={detail.startsWith('✅') ? 'text-green-700' : detail.startsWith('❌') ? 'text-red-700' : detail.startsWith('💡') ? 'text-blue-700' : 'text-slate-600'}>
                            {detail}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Feedback Report */}
          {submission.aiFeedback && (
            <div className="mt-6 bg-white/80 rounded-xl p-5 border border-slate-200">
              <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                <FiCpu className="text-indigo-500" /> Phản hồi chi tiết từ AI
              </h3>
              <div className="prose prose-sm max-w-none text-slate-700">
                <ReactMarkdown>{submission.aiFeedback}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Evaluating State */}
      {evaluating && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-8 mb-8 text-center shadow-sm">
          <div className="inline-block p-4 bg-white rounded-full shadow-sm mb-4">
            <FiCpu className="w-10 h-10 text-indigo-500 animate-pulse" />
          </div>
          <h3 className="text-xl font-bold text-indigo-900 mb-2">AI đang chấm bài...</h3>
          <p className="text-indigo-600">Hệ thống đang đánh giá bài nộp dựa trên bộ tiêu chí đã được cấu hình. Quá trình này có thể mất 1-2 phút.</p>
          <div className="mt-6 max-w-xs mx-auto h-2 bg-indigo-200 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full animate-[progress_2s_ease-in-out_infinite] w-1/2"></div>
          </div>
        </div>
      )}

      {/* Submission Form (If unlocked and can submit) */}
      {unlockStatus?.unlocked && canResubmit && !evaluating && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-8">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold text-slate-900">
              {attemptsUsed > 0 ? '✏️ Nộp lại bài' : '📝 Nộp bài dự án'}
            </h3>
            <span className="text-sm font-medium px-3 py-1 bg-slate-100 rounded-full text-slate-600">
              Lượt nộp: {attemptsUsed + 1}/{project.maxAttempts}
            </span>
          </div>

          {hasSubmissionTypes ? (
            /* Dynamic submission form based on admin config */
            <div className="space-y-4">
              {project.submissionTypes!.map((st, index) => renderSubmissionField(st, index))}
            </div>
          ) : (
            /* Legacy submission form */
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                  <FiLink /> Link Bài làm (Google Drive, GitHub, Notion...)
                </label>
                <input
                  type="url"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                  placeholder="https://docs.google.com/..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                  <FiLink /> Link Video Demo / Thuyết trình (Nếu có)
                </label>
                <input
                  type="url"
                  value={demoUrl}
                  onChange={(e) => setDemoUrl(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                  placeholder="https://youtube.com/..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Mô tả & Báo cáo <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={6}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all resize-y"
                  placeholder="Mô tả bài làm, cách thực hiện, hoặc ghi chú thêm..."
                />
              </div>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-primary-600 to-indigo-600 text-white rounded-xl font-bold hover:from-primary-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 text-lg mt-6"
          >
            <FiSend />
            {submitting ? 'Đang gửi...' : 'Nộp bài & Chấm điểm bằng AI'}
          </button>
        </div>
      )}

      {/* Max Attempts Reached */}
      {unlockStatus?.unlocked && !canResubmit && !isPassed && attemptsUsed > 0 && !evaluating && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 mb-8 text-center">
          <FiXCircle className="mx-auto text-4xl text-red-400 mb-3" />
          <h3 className="text-lg font-bold text-red-700 mb-2">Hết lượt nộp bài</h3>
          <p className="text-red-600">Bạn đã sử dụng hết {project.maxAttempts} lượt nộp bài nhưng chưa đạt yêu cầu.</p>
        </div>
      )}

      {/* Submission History Toggle */}
      {submissions.length > 1 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors"
          >
            <h3 className="font-bold text-slate-700 flex items-center gap-2">
              <FiClock /> Lịch sử nộp bài ({submissions.length})
            </h3>
            {showHistory ? <FiChevronUp /> : <FiChevronDown />}
          </button>
          
          {showHistory && (
            <div className="divide-y divide-slate-100">
              {submissions.map((sub, idx) => (
                <div key={sub.id} className="p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-slate-800">Lần {sub.attemptNumber}</span>
                      <span className="text-sm text-slate-500">{new Date(sub.submittedAt).toLocaleString('vi-VN')}</span>
                      {idx === 0 && <span className="text-xs text-primary-600 font-semibold bg-primary-50 px-2 py-0.5 rounded-full">(Mới nhất)</span>}
                    </div>
                    {/* Render brief submission data summary */}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {sub.submissionData ? (
                        sub.submissionData.slice(0, 3).map((item, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-xs text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded">
                            <span className="font-medium text-slate-700">{item.label}:</span> 
                            <span className="truncate max-w-[150px]">{item.fileName || item.value}</span>
                          </span>
                        ))
                      ) : (
                        sub.content && <span className="text-xs text-slate-500 truncate max-w-sm block">📝 {sub.content}</span>
                      )}
                      {sub.submissionData && sub.submissionData.length > 3 && (
                        <span className="text-xs text-slate-500">+{sub.submissionData.length - 3} nữa</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center shrink-0">
                    {sub.status === 'GRADED' ? (
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${sub.totalScore! >= project.passingScore ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {typeof sub.totalScore === 'number' ? Math.round(sub.totalScore) : sub.totalScore}%
                      </span>
                    ) : (
                      <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">
                        Đang chấm
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
