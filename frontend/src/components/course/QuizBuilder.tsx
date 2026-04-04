import { useState, useEffect } from 'react';
import { learningService, Quiz, Question } from '../../services/learning.service';
import { FiPlus, FiTrash2, FiSave, FiAlertCircle } from 'react-icons/fi';
import toast from 'react-hot-toast';

interface QuizBuilderProps {
  lessonId: string;
  onClose: () => void;
}

export const QuizBuilder = ({ lessonId, onClose }: QuizBuilderProps) => {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(0);
  const [passingScore, setPassingScore] = useState(80);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [questions, setQuestions] = useState<Omit<Question, 'id' | 'quizId'>[]>([]);

  useEffect(() => {
    loadQuiz();
  }, [lessonId]);

  const loadQuiz = async () => {
    setLoading(true);
    try {
      const q = await learningService.getQuizByLesson(lessonId);
      setQuiz(q);
      setTitle(q.title);
      setDescription(q.description || '');
      setTimeLimitMinutes(q.timeLimitMinutes || 0);
      setPassingScore(q.passingScore);
      setMaxAttempts(q.maxAttempts);
      setQuestions(q.questions.map(qt => ({
        ...qt,
      })));
    } catch (err: any) {
      if (err.response?.status !== 404) {
        setError('Tải bài trắc nghiệm thất bại');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAddQuestion = () => {
    setQuestions([
      ...questions,
      {
        questionText: '',
        questionType: 'SINGLE_CHOICE',
        options: [{ id: '1', text: '', isCorrect: true }, { id: '2', text: '', isCorrect: false }],
        points: 10,
        orderIndex: questions.length + 1,
      } as any // Extending option type for builder
    ]);
  };

  const handleUpdateQuestion = (index: number, updates: any) => {
    const updated = [...questions];
    updated[index] = { ...updated[index], ...updates };
    setQuestions(updated);
  };

  const handleRemoveQuestion = (index: number) => {
    if (window.confirm('Xóa câu hỏi này?')) {
      const updated = [...questions];
      updated.splice(index, 1);
      setQuestions(updated);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (questions.length === 0) {
      setError('Vui lòng thêm ít nhất một câu hỏi.');
      return;
    }
    
    // Quick validation
    for (let i = 0; i < questions.length; i++) {
      if (!questions[i].questionText.trim()) {
        setError(`Câu hỏi ${i + 1} đang trống nội dung.`);
        return;
      }
      if (questions[i].options.length < 2) {
        setError(`Câu hỏi ${i + 1} phải có ít nhất 2 lựa chọn.`);
        return;
      }
    }

    setSaving(true);
    setError('');

    const payload = {
      lessonId,
      title,
      description,
      timeLimitMinutes,
      passingScore,
      maxAttempts,
      questions: questions.map((q, i) => ({ ...q, orderIndex: i + 1 })),
    };

    try {
      if (quiz) {
        await learningService.updateQuiz(quiz.id, payload as any);
        toast.success('Cập nhật trắc nghiệm thành công');
      } else {
        await learningService.createQuiz(payload as any);
        toast.success('Tạo trắc nghiệm thành công');
      }
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Lưu trắc nghiệm thất bại');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-4 text-center">Đang tải dữ liệu trắc nghiệm...</div>;

  return (
    <div className="bg-white border rounded-xl overflow-hidden shadow-sm mt-4 mb-8 border-primary-200">
      <div className="bg-primary-50 p-4 border-b border-primary-100 flex justify-between items-center">
        <h3 className="text-lg font-bold text-primary-900">{quiz ? 'Sửa Trắc nghiệm' : 'Tạo Trắc nghiệm'}</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-800 font-medium text-sm">Đóng</button>
      </div>

      <form onSubmit={handleSave} className="p-6">
        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-2">
            <FiAlertCircle /> {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Tiêu đề bài trắc nghiệm *</label>
            <input required value={title} onChange={e => setTitle(e.target.value)} className="input-field" placeholder="VD: Kiểm tra kiến thức cuối phần" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} className="input-field" rows={2} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Thời gian giới hạn (Phút)</label>
            <input type="number" min="0" value={timeLimitMinutes} onChange={e => setTimeLimitMinutes(Number(e.target.value))} className="input-field" placeholder="0 = Không giới hạn" />
            <p className="text-xs text-gray-500 mt-1">Để 0 nếu không giới hạn thời gian.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Điểm đạt yêu cầu (%) *</label>
            <input type="number" min="1" max="100" required value={passingScore} onChange={e => setPassingScore(Number(e.target.value))} className="input-field" />
          </div>
        </div>

        <div className="mb-6 border-b pb-4 flex justify-between items-end">
          <h4 className="text-lg font-bold text-gray-800">Câu hỏi ({questions.length})</h4>
          <button type="button" onClick={handleAddQuestion} className="btn-secondary text-sm flex items-center gap-2 py-2">
            <FiPlus /> Thêm câu hỏi
          </button>
        </div>

        <div className="space-y-6">
          {questions.map((q, qIndex) => (
            <div key={qIndex} className="p-5 border border-gray-200 rounded-lg bg-gray-50 relative group">
              <button type="button" onClick={() => handleRemoveQuestion(qIndex)} className="absolute top-4 right-4 text-gray-400 hover:text-red-600 transition-colors">
                <FiTrash2 size={18} />
              </button>
              
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div className="md:col-span-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Câu hỏi {qIndex + 1} *</label>
                  <input required value={q.questionText} onChange={e => handleUpdateQuestion(qIndex, { questionText: e.target.value })} className="input-field bg-white" placeholder="Như thế nào là..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Điểm *</label>
                  <input type="number" min="1" required value={q.points} onChange={e => handleUpdateQuestion(qIndex, { points: Number(e.target.value) })} className="input-field bg-white" />
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Loại câu hỏi</label>
                <select value={q.questionType} onChange={e => handleUpdateQuestion(qIndex, { questionType: e.target.value })} className="input-field bg-white w-full md:w-1/2">
                  <option value="SINGLE_CHOICE">Một đáp án</option>
                  <option value="MULTIPLE_CHOICE">Nhiều đáp án</option>
                  <option value="TRUE_FALSE">Đúng / Sai</option>
                </select>
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-medium text-gray-700">Lựa chọn *</label>
                {(q.options as any[]).map((opt, optIndex) => (
                  <div key={optIndex} className="flex gap-3 items-center">
                    <input
                      type={q.questionType === 'MULTIPLE_CHOICE' ? 'checkbox' : 'radio'}
                      name={`q-${qIndex}-correct`}
                      checked={opt.isCorrect}
                      onChange={(e) => {
                        const newOpts = [...q.options as any[]];
                        if (q.questionType !== 'MULTIPLE_CHOICE') {
                          newOpts.forEach(o => o.isCorrect = false);
                        }
                        newOpts[optIndex].isCorrect = e.target.checked;
                        handleUpdateQuestion(qIndex, { options: newOpts });
                      }}
                      className="w-4 h-4 text-primary-600 cursor-pointer"
                    />
                    <input
                      required
                      value={opt.text}
                      onChange={(e) => {
                        const newOpts = [...q.options as any[]];
                        newOpts[optIndex].text = e.target.value;
                        handleUpdateQuestion(qIndex, { options: newOpts });
                      }}
                      className="input-field py-2 bg-white flex-1"
                      placeholder={`Lựa chọn ${optIndex + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (q.options.length <= 2) return;
                        const newOpts = [...q.options as any[]];
                        newOpts.splice(optIndex, 1);
                        handleUpdateQuestion(qIndex, { options: newOpts });
                      }}
                      className="text-gray-400 hover:text-red-500 disabled:opacity-30"
                      disabled={q.options.length <= 2} // Enforce min 2 options
                    >
                      <FiTrash2 />
                    </button>
                  </div>
                ))}
                {q.questionType !== 'TRUE_FALSE' && (
                  <button
                    type="button"
                    onClick={() => {
                      const newOpts = [...q.options as any[], { id: Date.now().toString(), text: '', isCorrect: false }];
                      handleUpdateQuestion(qIndex, { options: newOpts });
                    }}
                    className="text-sm text-primary-600 font-medium hover:underline mt-2 inline-block"
                  >
                    + Thêm Lựa chọn
                  </button>
                )}
              </div>
            </div>
          ))}
          {questions.length === 0 && (
            <div className="text-center py-8 bg-gray-50 border border-dashed rounded-lg text-gray-500">
              Chưa có câu hỏi nào. Nhấn "Thêm câu hỏi" bên trên.
            </div>
          )}
        </div>

        <div className="mt-8 flex justify-end gap-4 border-t pt-6">
          <button type="button" onClick={onClose} className="btn-secondary">Hủy</button>
          <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 px-8">
            <FiSave /> {saving ? 'Đang lưu...' : 'Lưu Trắc nghiệm'}
          </button>
        </div>
      </form>
    </div>
  );
};
