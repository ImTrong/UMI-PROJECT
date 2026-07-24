import { useState, useEffect, useRef } from 'react';
import { learningService, Quiz, QuizAttempt } from '../../services/learning.service';
import { FiClock, FiCheckCircle, FiXCircle, FiAlertCircle, FiAward, FiRefreshCw } from 'react-icons/fi';
import toast from 'react-hot-toast';

interface PastAttempt {
  id: string;
  score: number;
  passed: boolean;
  correctAnswers: number;
  totalQuestions: number;
  status: string;
  startedAt: string;
  submittedAt?: string;
  timeTakenSeconds?: number;
}

export const QuizPlayer = ({
  lessonId,
  onComplete,
}: {
  lessonId: string;
  onComplete: () => void;
}) => {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [result, setResult] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [pastAttempts, setPastAttempts] = useState<PastAttempt[]>([]);
  const [showRetake, setShowRetake] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    loadQuiz();
    return () => clearInterval(timerRef.current);
  }, [lessonId]);

  useEffect(() => {
    if (attempt && attempt.status === 'IN_PROGRESS' && timeLeft !== null) {
      if (timeLeft <= 0) {
        handleSubmit(); // Auto-submit when time's up
        return;
      }
      timerRef.current = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
    }
  }, [timeLeft, attempt]);

  const loadQuiz = async () => {
    setLoading(true);
    try {
      const q = await learningService.getQuizByLesson(lessonId);
      setQuiz(q);

      // Load past attempts to check if already completed
      try {
        const attempts = await learningService.getQuizAttempts(q.id);
        const submitted = attempts.filter((a: any) => a.status === 'SUBMITTED' || a.status === 'TIMED_OUT');
        setPastAttempts(submitted);
      } catch {
        // no previous attempts
      }
    } catch (err: any) {
      if (err.response?.status !== 404) {
        setError('Tải bài trắc nghiệm thất bại');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    if (!quiz) return;
    setLoading(true);
    setError('');
    setShowRetake(false);
    try {
      const newAttempt = await learningService.startQuiz(quiz.id);
      setAttempt(newAttempt);
      setResult(null);
      setAnswers({});
      if (quiz.timeLimitMinutes) {
        setTimeLeft(quiz.timeLimitMinutes * 60);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Không thể bắt đầu làm bài trắc nghiệm');
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerChange = (question: any, value: string) => {
    const isMulti = question.type === 'MULTI_SELECT' || (!question.type && question.questionType === 'MULTIPLE_CHOICE');
    
    if (isMulti) {
      const current = (answers[question.id] as string[]) || [];
      if (current.includes(value)) {
        setAnswers({ ...answers, [question.id]: current.filter((v) => v !== value) });
      } else {
        setAnswers({ ...answers, [question.id]: [...current, value] });
      }
    } else {
      setAnswers({ ...answers, [question.id]: value });
    }
  };

  const handleSubmit = async () => {
    if (!attempt || !quiz) return;
    clearInterval(timerRef.current);
    setLoading(true);
    try {
      const formattedAnswers = Object.keys(answers).map((qId) => {
        const val = answers[qId];
        return {
          questionId: qId,
          selectedOptionIds: Array.isArray(val) ? val : [val],
        };
      });
      const res = await learningService.submitQuiz(attempt.id, formattedAnswers);
      setAttempt(res.attempt);
      setResult(res.results);
      // Refresh attempts list
      setPastAttempts((prev) => [{
        id: res.attempt.id,
        score: res.results.score,
        passed: res.results.passed,
        correctAnswers: res.results.correctAnswers,
        totalQuestions: res.results.totalQuestions,
        status: 'SUBMITTED',
        startedAt: res.attempt.startedAt || new Date().toISOString(),
        submittedAt: new Date().toISOString(),
        timeTakenSeconds: res.results.timeTakenSeconds,
      }, ...prev]);
      if (res.courseCompleted) {
        toast.success('🎉 Chúc mừng! Bạn đã hoàn thành khóa học. Xem kết quả tổng kết!');
        setTimeout(() => {
          window.location.href = `/course-exam/${quiz.courseId}`;
        }, 2000);
      } else if (res.attempt.passed) {
        onComplete();
      }
    } catch (err: any) {
      setError('Không thể nộp bài trắc nghiệm');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const getOptionText = (questionId: string, optionId: string) => {
    const question = quiz?.questions.find((q) => q.id === questionId);
    const option = question?.options?.find((opt: any) => opt.id === optionId);
    return option?.text || optionId;
  };

  if (loading && !quiz) return <div className="p-8 text-center"><div className="animate-spin h-8 w-8 mx-auto border-b-2 border-primary-600 rounded-full"></div></div>;
  if (!quiz) return <div className="p-8 text-center text-slate-500">Không tìm thấy bài trắc nghiệm nào cho bài học này.</div>;

  // ─── Results View ───
  if (result) {
    return (
      <div className="max-w-3xl mx-auto p-4 md:p-8">
        <div className={`card text-center mb-8 border-t-4 ${result.passed ? 'border-green-500' : 'border-red-500'}`}>
          {result.passed ? (
            <div className="text-green-500 mb-4 flex justify-center"><FiCheckCircle size={64} /></div>
          ) : (
            <div className="text-red-500 mb-4 flex justify-center"><FiXCircle size={64} /></div>
          )}
          <h2 className="text-3xl font-bold mb-2">{result.passed ? 'Chúc mừng bạn!' : 'Hãy thử lại!'}</h2>
          <p className="text-xl">
            Điểm của bạn: <span className="font-bold">{Math.round(result.score * 100) / 100}%</span>
          </p>
          <p className="text-slate-500 mt-2">Điểm đạt yêu cầu: {quiz.passingScore}%</p>
          
          <button onClick={() => { setAttempt(null); setResult(null); setAnswers({}); }} className="btn-primary mt-6">
            {result.passed ? 'Làm lại bài' : 'Thử lại'}
          </button>
        </div>

        <h3 className="text-xl font-bold mb-4">Kết quả chi tiết</h3>
        <div className="space-y-6">
          {(result.questionResults || []).map((exp: any, index: number) => (
            <div key={exp.questionId} className={`card ${exp.correct ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex gap-3">
                <div className="mt-1">
                  {exp.correct ? <FiCheckCircle className="text-green-600" /> : <FiXCircle className="text-red-600" />}
                </div>
                <div>
                  <p className="font-medium text-slate-900 mb-2">
                    Câu {index + 1}: {
                      quiz.questions.find(q => q.id === exp.questionId)?.text ||
                      quiz.questions.find(q => q.id === exp.questionId)?.questionText
                    }
                  </p>
                  <div className="text-sm">
                    <p>
                      <span className="font-semibold text-slate-700">Câu trả lời của bạn:</span>{' '}
                      {(exp.selectedOptionIds || []).length > 0
                        ? (exp.selectedOptionIds || []).map((id: string) => getOptionText(exp.questionId, id)).join(', ')
                        : 'Chưa trả lời'}
                    </p>
                    {!exp.correct && (
                      <p>
                        <span className="font-semibold text-green-700">Đáp án chuẩn:</span>{' '}
                        {(exp.correctAnswerIds || []).map((id: string) => getOptionText(exp.questionId, id)).join(', ')}
                      </p>
                    )}
                  </div>
                  {exp.explanation && (
                    <div className="mt-3 p-3 bg-white bg-opacity-60 rounded text-sm text-slate-700">
                      <span className="font-semibold">Giải thích:</span> {exp.explanation}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── Past Attempts Summary (show when has completed attempts and not in active quiz) ───
  const hasPassed = pastAttempts.some(a => a.passed);
  const bestAttempt = pastAttempts.length > 0
    ? pastAttempts.reduce((best, a) => a.score > best.score ? a : best, pastAttempts[0])
    : null;

  if (pastAttempts.length > 0 && (!attempt || attempt.status !== 'IN_PROGRESS') && !showRetake) {
    return (
      <div className="max-w-3xl mx-auto p-4 md:p-8">
        {/* Best Score Card */}
        <div className={`card text-center mb-8 border-t-4 ${hasPassed ? 'border-green-500' : 'border-amber-500'}`}>
          {hasPassed ? (
            <div className="text-green-500 mb-4 flex justify-center"><FiCheckCircle size={64} /></div>
          ) : (
            <div className="text-amber-500 mb-4 flex justify-center"><FiAward size={64} /></div>
          )}
          <h2 className="text-3xl font-bold mb-2">
            {hasPassed ? 'Đã hoàn thành!' : 'Chưa đạt yêu cầu'}
          </h2>
          <p className="text-xl">
            Điểm cao nhất: <span className="font-bold text-2xl">{Math.round((bestAttempt?.score || 0) * 100) / 100}%</span>
          </p>
          <p className="text-slate-500 mt-1">Điểm đạt yêu cầu: {quiz.passingScore}%</p>
          <p className="text-slate-400 text-sm mt-2">
            Đã làm {pastAttempts.length} / {quiz.maxAttempts} lượt
          </p>

          {pastAttempts.length < quiz.maxAttempts && (
            <button
              onClick={() => setShowRetake(true)}
              className="btn-primary mt-6 inline-flex items-center gap-2"
            >
              <FiRefreshCw size={16} /> Làm lại bài
            </button>
          )}
        </div>

        {/* Attempts History */}
        <h3 className="text-xl font-bold mb-4">Lịch sử các lần làm bài</h3>
        <div className="space-y-3">
          {pastAttempts.map((att, idx) => (
            <div
              key={att.id}
              className={`card flex items-center justify-between py-4 ${att.passed ? 'border-l-4 border-l-green-500' : 'border-l-4 border-l-red-400'}`}
            >
              <div className="flex items-center gap-3">
                {att.passed ? (
                  <FiCheckCircle className="text-green-500 flex-shrink-0" size={20} />
                ) : (
                  <FiXCircle className="text-red-400 flex-shrink-0" size={20} />
                )}
                <div>
                  <p className="font-semibold text-slate-900">
                    Lần {pastAttempts.length - idx}: <span className={att.passed ? 'text-green-600' : 'text-red-600'}>{Math.round(att.score * 100) / 100}%</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {att.correctAnswers}/{att.totalQuestions} câu đúng
                    {att.timeTakenSeconds && ` • ${Math.floor(att.timeTakenSeconds / 60)}m ${att.timeTakenSeconds % 60}s`}
                    {att.submittedAt && ` • ${new Date(att.submittedAt).toLocaleDateString('vi-VN')}`}
                  </p>
                </div>
              </div>
              <span className={`text-xs font-bold px-3 py-1 rounded-full ${att.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {att.passed ? 'Đạt' : 'Chưa đạt'}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── Start Screen (no past attempts or user clicked "retake") ───
  if (!attempt || attempt.status !== 'IN_PROGRESS') {
    return (
      <div className="max-w-2xl mx-auto p-4 md:p-8 text-center">
        <div className="card">
          <h2 className="text-2xl font-bold mb-4">{quiz.title}</h2>
          <p className="text-slate-600 mb-8">{quiz.description}</p>
          
          <div className="grid grid-cols-2 gap-4 mb-8 text-sm">
            <div className="bg-slate-50 p-4 rounded-xl">
              <p className="text-slate-500 flex items-center justify-center gap-2 mb-1"><FiClock /> Thời gian làm bài</p>
              <p className="font-bold">{quiz.timeLimitMinutes ? `${quiz.timeLimitMinutes} Phút` : 'Không giới hạn'}</p>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl">
              <p className="text-slate-500 mb-1">Điểm đạt yêu cầu</p>
              <p className="font-bold">{quiz.passingScore}%</p>
            </div>
          </div>

          {showRetake && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
              Lượt làm thứ {pastAttempts.length + 1} / {quiz.maxAttempts}
            </div>
          )}
          
          {error && <div className="mb-4 text-red-600 text-sm flex items-center justify-center gap-2"><FiAlertCircle /> {error}</div>}
          
          <button onClick={handleStart} disabled={loading} className="btn-primary w-full max-w-xs text-lg py-3">
            {loading ? 'Đang tải...' : showRetake ? 'Bắt đầu làm lại' : 'Bắt đầu làm bài'}
          </button>

          {showRetake && (
            <button
              onClick={() => setShowRetake(false)}
              className="block mx-auto mt-3 text-sm text-slate-500 hover:text-slate-700"
            >
              ← Quay lại xem kết quả
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Active Quiz Form ───
  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8">
      <div className="flex justify-between items-center bg-white p-4 sticky top-0 z-10 border-b shadow-sm mb-6 rounded-xl">
        <h2 className="font-bold text-lg">{quiz.title}</h2>
        {timeLeft !== null && (
          <div className={`font-mono text-xl flex items-center gap-2 ${timeLeft < 60 ? 'text-red-600 animate-pulse' : 'text-slate-700'}`}>
            <FiClock /> {formatTime(timeLeft)}
          </div>
        )}
      </div>

      <div className="space-y-8 mb-8">
        {quiz.questions.map((q, index) => {
          const isMulti = q.type === 'MULTI_SELECT' || (!q.type && q.questionType === 'MULTIPLE_CHOICE');
          const selectedValues = isMulti
            ? ((answers[q.id] as string[]) || [])
            : [answers[q.id] as string].filter(Boolean);

          return (
            <div key={q.id} className="card">
              <h3 className="font-medium text-lg mb-4">
                <span className="text-slate-500 mr-2">{index + 1}.</span>
                {q.text || q.questionText}
                <span className="text-sm text-primary-600 float-right">{q.points} điểm</span>
              </h3>
              
              <div className="space-y-3">
                {q.options.map((opt) => {
                  const isSelected = selectedValues.includes(opt.id);
                  return (
                    <label
                      key={opt.id}
                      className={`relative flex items-center gap-3 p-3 border-2 rounded-xl cursor-pointer transition-all ${
                        isSelected
                          ? 'border-primary-500 bg-primary-50 shadow-sm'
                          : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {/* Custom visual indicator */}
                      <div className={`flex-shrink-0 w-5 h-5 ${isMulti ? 'rounded-md' : 'rounded-full'} border-2 flex items-center justify-center transition-all ${
                        isSelected
                          ? 'border-primary-600 bg-primary-600'
                          : 'border-slate-200 bg-white'
                      }`}>
                        {isSelected && (
                          isMulti ? (
                            <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-white"></div>
                          )
                        )}
                      </div>
                      {/* Hidden native input for form semantics */}
                      <input
                        type={isMulti ? 'checkbox' : 'radio'}
                        name={q.id}
                        className="sr-only"
                        checked={isSelected}
                        onChange={() => handleAnswerChange(q, opt.id)}
                      />
                      <span className={`text-slate-700 ${isSelected ? 'font-medium text-slate-900' : ''}`}>{opt.text}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button onClick={handleSubmit} disabled={loading} className="btn-primary px-8 py-3 text-lg shadow-sm">
          {loading ? 'Đang nộp...' : 'Nộp bài'}
        </button>
      </div>
    </div>
  );
};
