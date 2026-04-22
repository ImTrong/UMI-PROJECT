import { useState, useEffect, useRef } from 'react';
import { learningService, Quiz, QuizAttempt } from '../../services/learning.service';
import { FiClock, FiCheckCircle, FiXCircle, FiAlertCircle } from 'react-icons/fi';

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
    } catch (err: any) {
      if (err.response?.status !== 404) {
        setError('Failed to load quiz');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    if (!quiz) return;
    setLoading(true);
    setError('');
    try {
      const newAttempt = await learningService.startQuiz(quiz.id);
      setAttempt(newAttempt);
      if (quiz.timeLimitMinutes) {
        setTimeLeft(quiz.timeLimitMinutes * 60);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Không thể bắt đầu làm bài trắc nghiệm');
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerChange = (questionId: string, value: string, type: string) => {
    if (type === 'MULTI_SELECT' || type === 'MULTIPLE_CHOICE') {
      const current = (answers[questionId] as string[]) || [];
      if (current.includes(value)) {
        setAnswers({ ...answers, [questionId]: current.filter((v) => v !== value) });
      } else {
        setAnswers({ ...answers, [questionId]: [...current, value] });
      }
    } else {
      setAnswers({ ...answers, [questionId]: value });
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
      if (res.attempt.passed) {
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
  if (!quiz) return <div className="p-8 text-center text-gray-500">Không tìm thấy bài trắc nghiệm nào cho bài học này.</div>;

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
            Điểm của bạn: <span className="font-bold">{result.score}%</span>
          </p>
          <p className="text-gray-500 mt-2">Điểm đạt yêu cầu: {quiz.passingScore}%</p>
          
          {!result.passed && (
            <button onClick={() => { setAttempt(null); setResult(null); setAnswers({}); }} className="btn-primary mt-6">
              Làm lại bài
            </button>
          )}
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
                  <p className="font-medium text-gray-900 mb-2">
                    Câu {index + 1}: {
                      quiz.questions.find(q => q.id === exp.questionId)?.text ||
                      quiz.questions.find(q => q.id === exp.questionId)?.questionText
                    }
                  </p>
                  <div className="text-sm">
                    <p>
                      <span className="font-semibold text-gray-700">Câu trả lời của bạn:</span>{' '}
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
                    <div className="mt-3 p-3 bg-white bg-opacity-60 rounded text-sm text-gray-700">
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

  if (!attempt || attempt.status !== 'IN_PROGRESS') {
    return (
      <div className="max-w-2xl mx-auto p-4 md:p-8 text-center">
        <div className="card">
          <h2 className="text-2xl font-bold mb-4">{quiz.title}</h2>
          <p className="text-gray-600 mb-8">{quiz.description}</p>
          
          <div className="grid grid-cols-2 gap-4 mb-8 text-sm">
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-gray-500 flex items-center justify-center gap-2 mb-1"><FiClock /> Thời gian làm bài</p>
              <p className="font-bold">{quiz.timeLimitMinutes ? `${quiz.timeLimitMinutes} Phút` : 'Không giới hạn'}</p>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-gray-500 mb-1">Điểm đạt yêu cầu</p>
              <p className="font-bold">{quiz.passingScore}%</p>
            </div>
          </div>
          
          {error && <div className="mb-4 text-red-600 text-sm flex items-center justify-center gap-2"><FiAlertCircle /> {error}</div>}
          
          <button onClick={handleStart} disabled={loading} className="btn-primary w-full max-w-xs text-lg py-3">
            {loading ? 'Đang tải...' : 'Bắt đầu làm bài'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8">
      <div className="flex justify-between items-center bg-white p-4 sticky top-0 z-10 border-b shadow-sm mb-6 rounded-lg">
        <h2 className="font-bold text-lg">{quiz.title}</h2>
        {timeLeft !== null && (
          <div className={`font-mono text-xl flex items-center gap-2 ${timeLeft < 60 ? 'text-red-600 animate-pulse' : 'text-gray-700'}`}>
            <FiClock /> {formatTime(timeLeft)}
          </div>
        )}
      </div>

      <div className="space-y-8 mb-8">
        {quiz.questions.map((q, index) => (
          <div key={q.id} className="card">
            <h3 className="font-medium text-lg mb-4">
              <span className="text-gray-500 mr-2">{index + 1}.</span>
              {q.text || q.questionText}
              <span className="text-sm text-primary-600 float-right">{q.points} điểm</span>
            </h3>
            
            <div className="space-y-3">
              {q.options.map((opt) => (
                <label key={opt.id} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                  <input
                    type={(q.type === 'MULTI_SELECT' || q.questionType === 'MULTIPLE_CHOICE') ? 'checkbox' : 'radio'}
                    name={q.id}
                    className="mt-1 w-4 h-4 text-primary-600 focus:ring-primary-500"
                    checked={(q.type === 'MULTI_SELECT' || q.questionType === 'MULTIPLE_CHOICE')
                      ? ((answers[q.id] as string[]) || []).includes(opt.id)
                      : answers[q.id] === opt.id}
                    onChange={() => handleAnswerChange(q.id, opt.id, q.type || q.questionType || 'MULTIPLE_CHOICE')}
                  />
                  <span className="text-gray-700">{opt.text}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button onClick={handleSubmit} disabled={loading} className="btn-primary px-8 py-3 text-lg shadow-lg">
          {loading ? 'Đang nộp...' : 'Nộp bài'}
        </button>
      </div>
    </div>
  );
};
