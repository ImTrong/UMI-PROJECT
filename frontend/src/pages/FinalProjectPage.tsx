import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { learningService, FinalProject, FinalProjectSubmission, StageResult } from '../services/learning.service';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { 
  FiCheckCircle, FiXCircle, FiArrowLeft, FiAward, FiSend, 
  FiClock, FiTarget, FiStar, FiLink, FiBookOpen, 
  FiChevronDown, FiChevronUp, FiCpu
} from 'react-icons/fi';

export default function FinalProjectPage() {
  const { pathId } = useParams<{ pathId: string }>();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  
  const [project, setProject] = useState<FinalProject | null>(null);
  const [submissions, setSubmissions] = useState<FinalProjectSubmission[]>([]);
  const [submission, setSubmission] = useState<FinalProjectSubmission | null>(null);
  const [unlockStatus, setUnlockStatus] = useState<{ unlocked: boolean; reasons: string[] } | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [demoUrl, setDemoUrl] = useState('');
  
  const [submitting, setSubmitting] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [generatingCert, setGeneratingCert] = useState(false);
  
  const [showHistory, setShowHistory] = useState(false);

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
        }
      }
    } catch (error) {
      console.error('Failed to load final project:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!project || !pathId) return;
    if (!content.trim() && !githubUrl.trim()) {
      toast.error('Vui lòng nhập nội dung hoặc đường dẫn bài làm');
      return;
    }
    
    setSubmitting(true);
    try {
      const sub = await learningService.submitFinalProject(project.id, {
        learningPathId: pathId,
        content,
        githubUrl,
        demoUrl
      });
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
            <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">Project cuối kỳ</span>
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
      </div>

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
                {submission.totalScore}
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
                  : `Bài làm của bạn đạt ${submission.totalScore} điểm. Điểm yêu cầu để qua môn là ${project.passingScore} điểm.`}
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

          {/* AI Feedback Report */}
          {submission.aiFeedback && (
            <div className="mt-8 bg-white/80 rounded-xl p-5 border border-slate-200">
              <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                <FiCpu className="text-indigo-500" /> Phản hồi từ AI
              </h3>
              <div className="prose prose-sm max-w-none text-slate-700 whitespace-pre-wrap">
                {submission.aiFeedback}
              </div>
            </div>
          )}

          {/* Detailed Stage Results */}
          {submission.stageResults && submission.stageResults.length > 0 && (
            <div className="mt-6">
              <h3 className="font-bold text-slate-900 mb-4">Chi tiết từng chặng (Stages)</h3>
              <div className="space-y-3">
                {submission.stageResults.map((stage: StageResult) => (
                  <div key={stage.stageNumber} className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-semibold text-slate-800">
                        Chặng {stage.stageNumber}: {stage.title}
                      </h4>
                      <span className={`px-2 py-1 rounded text-xs font-bold ${stage.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {stage.score} / {stage.maxScore} đ
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 mb-3">{stage.feedback}</p>
                    {stage.details && stage.details.length > 0 && (
                      <ul className="text-sm space-y-1 bg-slate-50 p-3 rounded-lg">
                        {stage.details.map((detail, idx) => (
                          <li key={idx} className={detail.startsWith('✅') ? 'text-green-700' : detail.startsWith('❌') ? 'text-red-700' : 'text-slate-600'}>
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
        </div>
      )}

      {/* Evaluating State */}
      {evaluating && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-8 mb-8 text-center shadow-sm">
          <div className="inline-block p-4 bg-white rounded-full shadow-sm mb-4">
            <FiCpu className="w-10 h-10 text-indigo-500 animate-pulse" />
          </div>
          <h3 className="text-xl font-bold text-indigo-900 mb-2">AI đang chấm bài...</h3>
          <p className="text-indigo-600">Hệ thống đang chạy Evaluation Pipeline để đánh giá bài nộp của bạn. Quá trình này có thể mất 1-2 phút.</p>
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
              {attemptsUsed > 0 ? '✏️ Nộp lại bài' : '📝 Nộp bài Project'}
            </h3>
            <span className="text-sm font-medium px-3 py-1 bg-slate-100 rounded-full text-slate-600">
              Lượt nộp: {attemptsUsed + 1}/{project.maxAttempts}
            </span>
          </div>

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

            <button
              onClick={handleSubmit}
              disabled={submitting || (!content.trim() && !githubUrl.trim())}
              className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-primary-600 to-indigo-600 text-white rounded-xl font-bold hover:from-primary-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 text-lg mt-2"
            >
              <FiSend />
              {submitting ? 'Đang gửi...' : 'Nộp bài & Chấm điểm bằng AI'}
            </button>
          </div>
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
                  <div>
                    <span className="font-semibold text-slate-800">Lần {sub.attemptNumber}</span>
                    <span className="text-sm text-slate-500 ml-3">{new Date(sub.submittedAt).toLocaleString('vi-VN')}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {sub.status === 'GRADED' ? (
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${sub.totalScore! >= project.passingScore ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {sub.totalScore} điểm
                      </span>
                    ) : (
                      <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">
                        Đang chấm
                      </span>
                    )}
                    {idx === 0 && <span className="text-xs text-primary-600 font-semibold">(Mới nhất)</span>}
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
