import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { learningService, CourseExamResult as ExamResultType } from '../services/learning.service';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { FiAward, FiRefreshCw, FiCheckCircle, FiXCircle, FiBarChart2, FiArrowLeft, FiTarget, FiClock } from 'react-icons/fi';

export default function CourseExamResult() {
  const { courseId } = useParams<{ courseId: string }>();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [result, setResult] = useState<ExamResultType | null>(null);
  const [loading, setLoading] = useState(true);
  const [retaking, setRetaking] = useState(false);
  const [generatingCert, setGeneratingCert] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !courseId) return;
    loadResult();
  }, [isAuthenticated, courseId]);

  const loadResult = async () => {
    setLoading(true);
    try {
      const data = await learningService.getCourseExamResult(courseId!);
      setResult(data);
    } catch (error) {
      console.error('Failed to load exam result:', error);
      toast.error('Không thể tải kết quả tổng kết');
    } finally {
      setLoading(false);
    }
  };

  const handleRetake = async () => {
    if (!courseId) return;
    setRetaking(true);
    try {
      await learningService.retakeCourse(courseId);
      toast.success('Đã reset tiến độ. Bạn có thể học lại miễn phí!');
      navigate(`/learning/${courseId}`);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Không thể học lại khóa học');
    } finally {
      setRetaking(false);
    }
  };

  const handleGenerateCertificate = async () => {
    if (!courseId) return;
    setGeneratingCert(true);
    try {
      await learningService.generateCertificate(courseId);
      toast.success('Chứng nhận đã được tạo thành công!');
      navigate('/certificates');
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Không thể tạo chứng nhận');
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

  if (!result) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 text-center">
        <p className="text-slate-600">Không tìm thấy kết quả tổng kết.</p>
        <Link to="/my-learning" className="btn-primary mt-4 inline-block">Quay lại</Link>
      </div>
    );
  }

  const scoreColor = result.passed ? 'text-green-600' : 'text-red-500';
  const scoreBg = result.passed ? 'from-green-50 to-emerald-50 border-green-200' : 'from-red-50 to-orange-50 border-red-200';
  const scoreRingColor = result.passed ? 'border-green-400' : 'border-red-400';

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Back button */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-500 hover:text-primary-600 mb-6 transition-colors">
        <FiArrowLeft /> Quay lại
      </button>

      {/* Header */}
      <div className={`rounded-2xl border bg-gradient-to-br ${scoreBg} p-8 mb-8`}>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Kết quả tổng kết khóa học</h1>
        <h2 className="text-lg text-slate-600 mb-6">{result.courseTitle}</h2>

        <div className="flex items-center gap-8">
          {/* Score circle */}
          <div className={`w-32 h-32 rounded-full border-4 ${scoreRingColor} flex flex-col items-center justify-center bg-white shadow-sm`}>
            <span className={`text-3xl font-bold ${scoreColor}`}>
              {result.averageQuizScore.toFixed(1)}%
            </span>
            <span className="text-xs text-slate-500 mt-1">Điểm TB</span>
          </div>

          <div className="flex-1">
            {/* Pass/Fail status */}
            <div className="flex items-center gap-2 mb-3">
              {result.passed ? (
                <>
                  <FiCheckCircle className="text-green-500" size={24} />
                  <span className="text-xl font-bold text-green-600">ĐẠT</span>
                </>
              ) : (
                <>
                  <FiXCircle className="text-red-500" size={24} />
                  <span className="text-xl font-bold text-red-500">CHƯA ĐẠT</span>
                </>
              )}
            </div>

            <div className="space-y-1 text-sm text-slate-600">
              <p><FiTarget className="inline mr-1" /> Ngưỡng đạt: <strong>{result.passingScore}%</strong></p>
              <p><FiBarChart2 className="inline mr-1" /> Quiz: {result.completedQuizzes}/{result.totalQuizzes} đã hoàn thành</p>
              {result.retakeCount > 0 && (
                <p><FiClock className="inline mr-1" /> Lần học: {result.retakeCount + 1}</p>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 mt-4">
              {result.passed ? (
                <button
                  onClick={handleGenerateCertificate}
                  disabled={generatingCert}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-primary-500 to-cyan-500 text-white rounded-xl font-semibold hover:from-primary-600 hover:to-cyan-600 transition-all shadow-sm disabled:opacity-50"
                >
                  <FiAward />
                  {generatingCert ? 'Đang tạo...' : 'Nhận chứng nhận'}
                </button>
              ) : result.allowRetake ? (
                <button
                  onClick={handleRetake}
                  disabled={retaking}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold hover:from-amber-600 hover:to-orange-600 transition-all shadow-sm disabled:opacity-50"
                >
                  <FiRefreshCw className={retaking ? 'animate-spin' : ''} />
                  {retaking ? 'Đang xử lý...' : 'Học lại miễn phí'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Quiz details */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-lg font-bold text-slate-900">Chi tiết kết quả từng bài kiểm tra</h3>
        </div>

        {result.quizResults.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            <FiBarChart2 className="mx-auto text-3xl mb-2" />
            <p>Khóa học này không có bài kiểm tra nào.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {result.quizResults.map((quiz, idx) => (
              <div key={quiz.quizId} className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50 transition-colors">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${
                  quiz.passed
                    ? 'bg-green-50 text-green-600 border border-green-200'
                    : quiz.attempts > 0
                    ? 'bg-red-50 text-red-500 border border-red-200'
                    : 'bg-slate-50 text-slate-400 border border-slate-200'
                }`}>
                  {idx + 1}
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-slate-900 truncate">{quiz.lessonTitle}</h4>
                  <p className="text-xs text-slate-500">{quiz.attempts} lần thử</p>
                </div>

                <div className="text-right">
                  <span className={`text-lg font-bold ${quiz.passed ? 'text-green-600' : quiz.attempts > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                    {quiz.attempts > 0 ? `${quiz.bestScore.toFixed(1)}%` : '—'}
                  </span>
                  {quiz.passed && (
                    <p className="text-xs text-green-500 flex items-center justify-end gap-1">
                      <FiCheckCircle size={10} /> Đạt
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info note */}
      {!result.passed && result.allowRetake && (
        <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-sm text-amber-800">
            <strong>💡 Lưu ý:</strong> Khi học lại, toàn bộ tiến độ bài học và kết quả quiz sẽ được reset.
            Bạn sẽ bắt đầu lại từ đầu nhưng không cần thanh toán lại.
          </p>
        </div>
      )}
    </div>
  );
}
