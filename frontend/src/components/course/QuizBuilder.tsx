import { useState, useEffect, useRef } from 'react';
import { learningService, Quiz } from '../../services/learning.service';
import { FiPlus, FiTrash2, FiSave, FiAlertCircle, FiChevronDown, FiChevronUp, FiMessageCircle, FiCheckCircle, FiUpload, FiDownload, FiFile, FiX, FiCheck } from 'react-icons/fi';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';

// ===== FRONTEND editing format =====
interface FrontendOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

interface FrontendQuestion {
  questionText: string;
  questionType: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  options: FrontendOption[];
  points: number;
  explanation?: string;
}

// ===== BACKEND API format =====
interface BackendQuestion {
  id: string;
  text: string;
  type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'MULTI_SELECT';
  options: { id: string; text: string }[];
  correctAnswerIds: string[];
  points: number;
  explanation?: string;
}

// ===== Transform helpers =====
function frontendTypeToBackend(type: string): string {
  switch (type) {
    case 'SINGLE_CHOICE': return 'MULTIPLE_CHOICE';
    case 'MULTIPLE_CHOICE': return 'MULTI_SELECT';
    case 'TRUE_FALSE': return 'TRUE_FALSE';
    default: return 'MULTIPLE_CHOICE';
  }
}

function backendTypeToFrontend(type: string): 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE' {
  switch (type) {
    case 'MULTIPLE_CHOICE': return 'SINGLE_CHOICE';
    case 'MULTI_SELECT': return 'MULTIPLE_CHOICE';
    case 'TRUE_FALSE': return 'TRUE_FALSE';
    default: return 'SINGLE_CHOICE';
  }
}

function frontendToBackendQuestions(questions: FrontendQuestion[]): BackendQuestion[] {
  return questions.map((q, index) => ({
    id: `q-${Date.now()}-${index}`,
    text: q.questionText,
    type: frontendTypeToBackend(q.questionType) as BackendQuestion['type'],
    options: q.options.map(opt => ({ id: opt.id, text: opt.text })),
    correctAnswerIds: q.options.filter(opt => opt.isCorrect).map(opt => opt.id),
    points: q.points,
    explanation: q.explanation || '',
  }));
}

function backendToFrontendQuestions(questions: any[]): FrontendQuestion[] {
  return questions.map(q => ({
    questionText: q.text || q.questionText || '',
    questionType: backendTypeToFrontend(q.type || q.questionType || 'MULTIPLE_CHOICE'),
    options: (q.options || []).map((opt: any) => ({
      id: opt.id,
      text: opt.text,
      isCorrect: (q.correctAnswerIds || []).includes(opt.id),
    })),
    points: q.points || 10,
    explanation: q.explanation || '',
  }));
}

interface QuizBuilderProps {
  courseId: string;
  lessonId: string;
  onClose: () => void;
}

export const QuizBuilder = ({ courseId, lessonId, onClose }: QuizBuilderProps) => {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState<number | ''>(0);
  const [passingScore, setPassingScore] = useState(80);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [questions, setQuestions] = useState<FrontendQuestion[]>([]);
  
  // Accordion state
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set([0]));

  // Import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importedQuestions, setImportedQuestions] = useState<FrontendQuestion[]>([]);
  const [importFileName, setImportFileName] = useState('');
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setTimeLimitMinutes(q.timeLimitMinutes || '');
      setPassingScore(q.passingScore);
      setMaxAttempts(q.maxAttempts);
      setQuestions(backendToFrontendQuestions(q.questions || []));
      
      // Mở sẵn tất cả câu hỏi nếu số lượng < 3, ngược lại chỉ gập hết
      if (q.questions && q.questions.length < 3) {
         setExpandedIndices(new Set(q.questions.map((_, i) => i)));
      } else {
         setExpandedIndices(new Set([]));
      }
    } catch (err: any) {
      if (err.response?.status !== 404) {
        setError('Tải bài trắc nghiệm thất bại');
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleAccordion = (index: number) => {
    const newSet = new Set(expandedIndices);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setExpandedIndices(newSet);
  };

  // ===== Import helpers =====
  const generateSampleJSON = () => {
    const sample: FrontendQuestion[] = [
      {
        questionText: 'Đâu là ngôn ngữ lập trình phổ biến nhất?',
        questionType: 'SINGLE_CHOICE',
        options: [
          { id: 'opt-1', text: 'Python', isCorrect: true },
          { id: 'opt-2', text: 'HTML', isCorrect: false },
          { id: 'opt-3', text: 'CSS', isCorrect: false },
          { id: 'opt-4', text: 'SQL', isCorrect: false },
        ],
        points: 10,
        explanation: 'Python là ngôn ngữ lập trình phổ biến và đa năng nhất hiện nay.',
      },
      {
        questionText: 'React là một framework?',
        questionType: 'TRUE_FALSE',
        options: [
          { id: 'opt-t', text: 'Đúng', isCorrect: false },
          { id: 'opt-f', text: 'Sai', isCorrect: true },
        ],
        points: 5,
        explanation: 'React là một thư viện (library), không phải framework.',
      },
    ];
    return sample;
  };

  const downloadSampleJSON = () => {
    const sample = generateSampleJSON();
    const blob = new Blob([JSON.stringify(sample, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quiz-template.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadSampleExcel = () => {
    const data = [
      {
        questionText: 'Đâu là ngôn ngữ lập trình phổ biến nhất?',
        questionType: 'SINGLE_CHOICE',
        optionA: 'Python',
        optionB: 'HTML',
        optionC: 'CSS',
        optionD: 'SQL',
        correctAnswer: 'A',
        points: 10,
        explanation: 'Python là ngôn ngữ lập trình phổ biến và đa năng nhất hiện nay.',
      },
      {
        questionText: 'React là một framework?',
        questionType: 'TRUE_FALSE',
        optionA: 'Đúng',
        optionB: 'Sai',
        optionC: '',
        optionD: '',
        correctAnswer: 'B',
        points: 5,
        explanation: 'React là một thư viện (library), không phải framework.',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Questions');
    XLSX.writeFile(wb, 'quiz-template.xlsx');
  };

  const parseJSONFile = (text: string): FrontendQuestion[] => {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((q: any, idx: number) => ({
      questionText: q.questionText || q.text || '',
      questionType: q.questionType || 'SINGLE_CHOICE',
      options: (q.options || []).map((opt: any, oi: number) => ({
        id: opt.id || `imp-${Date.now()}-${idx}-${oi}`,
        text: opt.text || '',
        isCorrect: opt.isCorrect === true,
      })),
      points: q.points || 10,
      explanation: q.explanation || '',
    }));
  };

  const parseExcelFile = (data: ArrayBuffer): FrontendQuestion[] => {
    const wb = XLSX.read(data, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(ws);
    
    return rows.map((row, idx) => {
      const options: FrontendOption[] = [];
      const optionLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
      const correctAnswers = (row.correctAnswer || 'A').toString().toUpperCase().split(',').map((s: string) => s.trim());
      
      for (const label of optionLabels) {
        const text = row[`option${label}`];
        if (text && text.toString().trim()) {
          options.push({
            id: `imp-${Date.now()}-${idx}-${label}`,
            text: text.toString().trim(),
            isCorrect: correctAnswers.includes(label),
          });
        }
      }

      let questionType: FrontendQuestion['questionType'] = 'SINGLE_CHOICE';
      const rawType = (row.questionType || '').toString().toUpperCase();
      if (rawType === 'TRUE_FALSE' || rawType === 'TRUEFALSE') {
        questionType = 'TRUE_FALSE';
      } else if (rawType === 'MULTIPLE_CHOICE' || rawType === 'MULTI_SELECT' || correctAnswers.length > 1) {
        questionType = 'MULTIPLE_CHOICE';
      }

      return {
        questionText: (row.questionText || row.question || '').toString(),
        questionType,
        options,
        points: parseInt(row.points) || 10,
        explanation: (row.explanation || '').toString(),
      };
    });
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError('');
    setImportFileName(file.name);

    try {
      if (file.name.endsWith('.json')) {
        const text = await file.text();
        const parsed = parseJSONFile(text);
        if (parsed.length === 0) throw new Error('File không chứa câu hỏi nào.');
        setImportedQuestions(parsed);
        setShowImportModal(true);
      } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        const parsed = parseExcelFile(buffer);
        if (parsed.length === 0) throw new Error('File không chứa câu hỏi nào.');
        setImportedQuestions(parsed);
        setShowImportModal(true);
      } else {
        setImportError('Chỉ hỗ trợ file .json hoặc .xlsx');
        toast.error('Định dạng file không được hỗ trợ');
      }
    } catch (err: any) {
      setImportError(err.message || 'Lỗi khi đọc file');
      toast.error('Không thể đọc file: ' + (err.message || 'Lỗi không xác định'));
    }
    // Reset input
    e.target.value = '';
  };

  const confirmImport = () => {
    const newQuestions = [...questions, ...importedQuestions];
    setQuestions(newQuestions);
    // Auto-expand imported questions
    const newIndices = new Set(expandedIndices);
    for (let i = questions.length; i < newQuestions.length; i++) {
      newIndices.add(i);
    }
    setExpandedIndices(newIndices);
    setShowImportModal(false);
    setImportedQuestions([]);
    toast.success(`Đã import ${importedQuestions.length} câu hỏi thành công!`);
  };
  const handleAddQuestion = () => {
    const newIndex = questions.length;
    setQuestions([
      ...questions,
      {
        questionText: '',
        questionType: 'SINGLE_CHOICE',
        options: [
          { id: `opt-${Date.now()}-1`, text: '', isCorrect: true },
          { id: `opt-${Date.now()}-2`, text: '', isCorrect: false },
        ],
        points: 10,
        explanation: ''
      },
    ]);
    
    // Auto-expand the newly created question
    setExpandedIndices(prev => new Set(prev).add(newIndex));
  };

  const handleUpdateQuestion = (index: number, updates: Partial<FrontendQuestion>) => {
    const updated = [...questions];
    updated[index] = { ...updated[index], ...updates };
    setQuestions(updated);
  };

  const handleQuestionTypeChange = (index: number, newType: any) => {
    const updated = [...questions];
    const q = updated[index];
    q.questionType = newType;
    
    if (newType === 'TRUE_FALSE') {
      q.options = [
        { id: `opt-true-${Date.now()}`, text: 'Đúng', isCorrect: true },
        { id: `opt-false-${Date.now()}`, text: 'Sai', isCorrect: false },
      ];
    } else if (q.options.length < 2 || (q.options[0].text === 'Đúng' && q.options[1].text === 'Sai')) {
      q.options = [
        { id: `opt-${Date.now()}-1`, text: '', isCorrect: true },
        { id: `opt-${Date.now()}-2`, text: '', isCorrect: false },
      ];
    }
    setQuestions(updated);
  };

  const handleRemoveQuestion = (index: number) => {
    if (window.confirm('Bạn có chắc chắn muốn xóa câu hỏi này?')) {
      const updated = [...questions];
      updated.splice(index, 1);
      setQuestions(updated);
    }
  };

  const totalPoints = questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (questions.length === 0) {
      setError('Vui lòng thêm ít nhất một câu hỏi.');
      return;
    }
    
    // Validation
    for (let i = 0; i < questions.length; i++) {
      if (!questions[i].questionText.trim()) {
        setError(`Câu hỏi ${i + 1} đang trống nội dung.`);
        setExpandedIndices(prev => new Set(prev).add(i));
        return;
      }
      if (questions[i].options.length < 2) {
        setError(`Câu hỏi ${i + 1} phải có ít nhất 2 lựa chọn.`);
        setExpandedIndices(prev => new Set(prev).add(i));
        return;
      }
      
      const hasCorrect = questions[i].options.some(opt => opt.isCorrect);
      if (!hasCorrect) {
        setError(`Câu hỏi ${i + 1} phải có ít nhất 1 đáp án đúng.`);
        setExpandedIndices(prev => new Set(prev).add(i));
        return;
      }
      
      for (let j = 0; j < questions[i].options.length; j++) {
        if (!questions[i].options[j].text.trim()) {
          setError(`Lựa chọn ${j + 1} của câu hỏi ${i + 1} đang trống.`);
          setExpandedIndices(prev => new Set(prev).add(i));
          return;
        }
      }
    }

    setSaving(true);
    setError('');

    const backendQuestions = frontendToBackendQuestions(questions);

    const payload = {
      courseId,
      lessonId,
      title,
      description,
      timeLimitMinutes: timeLimitMinutes ? Number(timeLimitMinutes) : null,
      passingScore,
      maxAttempts,
      questions: backendQuestions,
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
      setError(err.response?.data?.error || 'Lưu trắc nghiệm thất bại. Vui lòng kiểm tra lại thông tin.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500 animate-pulse">Đang nạp bộ công cụ tạo trò chơi trắc nghiệm...</div>;

  return (
    <div className="bg-white border rounded-xl shadow-lg mt-4 mb-8 border-primary-200 overflow-hidden transform transition-all">
      <div className="bg-gradient-to-r from-primary-600 to-indigo-600 p-5 flex justify-between items-center text-white">
        <h3 className="text-xl font-bold flex items-center gap-2">
           <FiCheckCircle size={22} className="opacity-90" />
           {quiz ? 'Cấu trúc lại Trắc nghiệm' : 'Khởi tạo Trắc nghiệm Mới'}
        </h3>
        <button onClick={onClose} className="text-white/80 hover:text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium">Đóng</button>
      </div>

      <form onSubmit={handleSave} className="p-6 md:p-8">
        {error && (
          <div className="mb-8 p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl flex items-start gap-3">
            <FiAlertCircle className="mt-0.5 flex-shrink-0" size={18} /> 
            <span className="font-medium text-sm">{error}</span>
          </div>
        )}

        {/* =============== Cài Đặt Chung =============== */}
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-6 mb-8">
           <h4 className="font-semibold text-gray-800 mb-4 pb-2 border-b">1. Thiết lập chung</h4>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Tiêu đề bài trắc nghiệm <span className="text-red-500">*</span></label>
                <input required value={title} onChange={e => setTitle(e.target.value)} className="input-field shadow-sm" placeholder="VD: Kiểm tra kiến thức cuối phần 1" />
              </div>
              
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Mô tả (Tùy chọn)</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} className="input-field shadow-sm" rows={2} placeholder="Nhập một số ghi chú hoặc lời khuyên..." />
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Thời gian giới hạn (Phút)</label>
                <div className="relative">
                   <input type="number" min="0" value={timeLimitMinutes} onChange={e => setTimeLimitMinutes(e.target.value === '' ? '' : Number(e.target.value))} className="input-field shadow-sm pr-12" placeholder="VD: 30" />
                   <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">Phút</span>
                </div>
                <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1.5 opacity-80"><FiAlertCircle size={12}/> Để trống hoặc 0 nếu không giới hạn.</p>
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Điểm đậu (Passing Score %) <span className="text-red-500">*</span></label>
                <div className="relative">
                   <input type="number" min="1" max="100" required value={passingScore} onChange={e => setPassingScore(Number(e.target.value))} className="input-field shadow-sm pr-12 text-primary-700 font-semibold" />
                   <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">%</span>
                </div>
              </div>
           </div>
        </div>

        {/* =============== Danh Sách Câu Hỏi =============== */}
        <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-gray-200 pb-4">
          <div>
            <h4 className="text-xl font-bold text-gray-800">2. Bộ câu hỏi ({questions.length})</h4>
            <p className="text-sm text-gray-500 mt-1">Tổng điểm: <strong className="text-primary-600">{totalPoints} điểm</strong></p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
              <button type="button" onClick={() => setExpandedIndices(new Set(questions.map((_, i) => i)))} className="text-sm text-gray-500 hover:text-primary-600 font-medium px-2">Mở tất cả</button>
              <button type="button" onClick={() => setExpandedIndices(new Set())} className="text-sm text-gray-500 hover:text-primary-600 font-medium px-2 border-r border-gray-300 pr-4">Gập tất cả</button>
              
              {/* Import from file */}
              <div className="relative">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.xlsx,.xls"
                  onChange={handleFileImport}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-secondary text-sm flex items-center gap-2 py-2 px-4 shadow-sm border-green-200 text-green-700 bg-green-50 hover:bg-green-100"
                >
                  <FiUpload strokeWidth={2.5} /> Import file
                </button>
              </div>

              <button type="button" onClick={handleAddQuestion} className="btn-secondary text-sm flex items-center gap-2 py-2 px-4 shadow-sm border-primary-200 text-primary-700 bg-primary-50 hover:bg-primary-100">
                <FiPlus strokeWidth={3} /> Thêm câu hỏi
              </button>
           </div>
        </div>

        <div className="space-y-4">
          {questions.map((q, qIndex) => {
            const isExpanded = expandedIndices.has(qIndex);
            
            return (
              <div key={qIndex} className={`border rounded-xl bg-white overflow-hidden transition-all duration-200 ${isExpanded ? 'border-primary-300 shadow-md ring-1 ring-primary-100' : 'border-gray-200 shadow-sm hover:border-gray-300'}`}>
                {/* HEAD */}
                <div 
                   className={`flex justify-between items-center p-4 cursor-pointer select-none transition-colors ${isExpanded ? 'bg-primary-50/50' : 'bg-gray-50 hover:bg-gray-100/80'}`}
                   onClick={() => toggleAccordion(qIndex)}
                >
                   <div className="flex items-center gap-3 flex-1 overflow-hidden">
                      <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center justify-center font-bold text-sm text-gray-600">
                         {qIndex + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                         <h5 className="font-semibold text-gray-800 truncate text-sm">
                            {q.questionText || <span className="text-gray-400 italic">...Đang soạn thảo...</span>}
                         </h5>
                         <div className="text-xs text-gray-500 mt-0.5 flex gap-2 items-center">
                            <span className="font-medium px-1.5 py-0.5 rounded bg-gray-100 border text-[10px] uppercase tracking-wider">{
                               q.questionType === 'SINGLE_CHOICE' ? 'Một đáp án' : 
                               q.questionType === 'MULTIPLE_CHOICE' ? 'Nhiều đáp án' : 
                               'Đúng/Sai'
                            }</span>
                            <span>{q.points} Điểm</span>
                         </div>
                      </div>
                   </div>
                   
                   <div className="flex items-center gap-2 ml-4">
                      <button type="button" onClick={(e) => { e.stopPropagation(); handleRemoveQuestion(qIndex); }} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors group" title="Xóa câu hỏi">
                        <FiTrash2 size={16} className="group-hover:scale-110 transition-transform" />
                      </button>
                      <div className="w-px h-6 bg-gray-200 mx-1"></div>
                      <div className="p-1 text-gray-400">
                        {isExpanded ? <FiChevronUp size={20} /> : <FiChevronDown size={20} />}
                      </div>
                   </div>
                </div>

                {/* BODY (COLLAPSIBLE) */}
                {isExpanded && (
                  <div className="p-6 border-t border-gray-100 bg-white">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
                      <div className="md:col-span-3">
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nội dung câu hỏi <span className="text-red-500">*</span></label>
                        <textarea required value={q.questionText} onChange={e => handleUpdateQuestion(qIndex, { questionText: e.target.value })} className="input-field !py-3 min-h-[100px]" placeholder="Nhập nội dung đề bài (Hỗ trợ xuống dòng)..." />
                      </div>
                      <div className="flex flex-col gap-5">
                        <div>
                           <label className="block text-sm font-semibold text-gray-700 mb-1.5">Loại câu hỏi</label>
                           <select value={q.questionType} onChange={e => handleQuestionTypeChange(qIndex, e.target.value)} className="input-field font-medium text-gray-800">
                             <option value="SINGLE_CHOICE">Một đáp án</option>
                             <option value="MULTIPLE_CHOICE">Nhiều đáp án (Multi-select)</option>
                             <option value="TRUE_FALSE">Đúng / Sai</option>
                           </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Điểm số <span className="text-red-500">*</span></label>
                          <input type="number" min="0" required value={q.points} onChange={e => handleUpdateQuestion(qIndex, { points: Number(e.target.value) })} className="input-field text-primary-700 font-bold" />
                        </div>
                      </div>
                    </div>

                    {/* OPTIONS SECTION */}
                    <div className="space-y-4 mb-8 bg-slate-50 p-5 rounded-xl border border-slate-200/60">
                      <div className="flex justify-between items-center mb-2">
                         <label className="block text-sm font-semibold text-gray-800 flex items-center gap-2">
                           Lựa chọn Đáp án 
                           <span className="text-xs font-normal text-gray-500 bg-gray-200 px-2 flex items-center rounded-full">Đánh dấu tích để chọn đáp án đúng</span>
                         </label>
                      </div>
                      
                      <div className="space-y-3">
                        {q.options.map((opt, optIndex) => {
                          const isOptCorrect = opt.isCorrect;
                          return (
                            <div key={opt.id} className={`flex gap-3 items-center group p-2 rounded-lg border transition-colors ${isOptCorrect ? 'bg-green-50/50 border-green-200' : 'bg-white border-transparent hover:border-gray-200 shadow-sm'}`}>
                              <div className="flex items-center justify-center pl-2">
                                <label className="relative flex items-center justify-center cursor-pointer">
                                  <input
                                    type={q.questionType === 'MULTIPLE_CHOICE' ? 'checkbox' : 'radio'}
                                    name={`q-${qIndex}-correct`}
                                    checked={isOptCorrect}
                                    onChange={(e) => {
                                      const newOpts = [...q.options];
                                      if (q.questionType !== 'MULTIPLE_CHOICE') {
                                        newOpts.forEach(o => o.isCorrect = false);
                                      }
                                      newOpts[optIndex] = { ...newOpts[optIndex], isCorrect: e.target.checked };
                                      handleUpdateQuestion(qIndex, { options: newOpts });
                                    }}
                                    className={`w-5 h-5 cursor-pointer peer ${q.questionType === 'MULTIPLE_CHOICE' ? 'rounded text-green-600 focus:ring-green-500' : 'text-green-600 focus:ring-green-500'}`}
                                  />
                                </label>
                              </div>
                              <input
                                required
                                value={opt.text}
                                disabled={q.questionType === 'TRUE_FALSE'}
                                onChange={(e) => {
                                  const newOpts = [...q.options];
                                  newOpts[optIndex] = { ...newOpts[optIndex], text: e.target.value };
                                  handleUpdateQuestion(qIndex, { options: newOpts });
                                }}
                                className={`input-field flex-1 ${q.questionType === 'TRUE_FALSE' ? 'bg-gray-100 text-gray-600 cursor-not-allowed font-medium' : 'bg-white'}`}
                                placeholder={`Nội dung lựa chọn ${optIndex + 1}`}
                              />
                              
                              {q.questionType !== 'TRUE_FALSE' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (q.options.length <= 2) return;
                                    const newOpts = [...q.options];
                                    newOpts.splice(optIndex, 1);
                                    handleUpdateQuestion(qIndex, { options: newOpts });
                                  }}
                                  className={`p-2 rounded-md transition-colors ${q.options.length <= 2 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100'}`}
                                  disabled={q.options.length <= 2}
                                  title="Xóa lựa chọn"
                                >
                                  <FiTrash2 size={16} />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {q.questionType !== 'TRUE_FALSE' && (
                        <button
                          type="button"
                          onClick={() => {
                            const newOpts = [...q.options, { id: `opt-${Date.now()}`, text: '', isCorrect: false }];
                            handleUpdateQuestion(qIndex, { options: newOpts });
                          }}
                          className="text-sm font-semibold text-primary-600 hover:text-primary-800 bg-primary-50 hover:bg-primary-100 rounded-lg px-4 py-2 mt-4 transition-colors flex items-center gap-1.5 w-max shadow-sm border border-primary-100"
                        >
                          <FiPlus strokeWidth={3} /> Lựa chọn mới
                        </button>
                      )}
                    </div>

                    {/* EXPLANATION */}
                    <div>
                       <label className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
                          <FiMessageCircle className="text-amber-500" />
                          Giải thích đáp án <span className="font-normal text-gray-500 text-xs ml-1">(Tùy chọn)</span>
                       </label>
                       <textarea 
                          value={q.explanation || ''} 
                          onChange={e => handleUpdateQuestion(qIndex, { explanation: e.target.value })} 
                          className="input-field bg-amber-50/30 border-amber-200 focus:border-amber-400 focus:ring-amber-400 placeholder:text-amber-900/30 text-amber-900" 
                          rows={2} 
                          placeholder="Học viên sẽ thấy giải thích này sau khi làm bài (giúp củng cố kiến thức)..." 
                       />
                    </div>
                    
                  </div>
                )}
              </div>
            );
          })}
          
          {questions.length === 0 && (
            <div className="text-center py-16 px-6 bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center group cursor-pointer transition-colors hover:bg-gray-100 hover:border-primary-300" onClick={handleAddQuestion}>
              <div className="w-16 h-16 rounded-full bg-primary-50 text-primary-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                 <FiCheckCircle size={32} />
              </div>
              <h4 className="text-lg font-bold text-gray-700 mb-1">Chưa có câu hỏi nào</h4>
              <p className="text-gray-500 text-sm max-w-sm">Tạo bộ câu hỏi để kiểm tra kiến thức học viên ở cuối mỗi chương.</p>
              <button type="button" className="mt-5 btn-primary text-sm px-6">Bắt đầu tạo câu hỏi</button>
            </div>
          )}
        </div>

        {/* Download templates */}
        <div className="mt-8 p-4 bg-slate-50 border border-slate-200 rounded-xl">
          <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <FiDownload className="text-gray-500" /> Tải file mẫu để import câu hỏi
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={downloadSampleJSON}
              className="text-sm flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors text-gray-700 font-medium shadow-sm"
            >
              <FiFile size={14} className="text-blue-500" />
              Mẫu JSON
            </button>
            <button
              type="button"
              onClick={downloadSampleExcel}
              className="text-sm flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors text-gray-700 font-medium shadow-sm"
            >
              <FiFile size={14} className="text-green-600" />
              Mẫu Excel (.xlsx)
            </button>
          </div>
        </div>

        {/* BOTTOM ACTIONS */}
        <div className="mt-10 flex justify-end gap-3 pt-6 border-t border-gray-200 bg-white sticky bottom-0 z-10 pb-2">
          <button type="button" onClick={onClose} className="px-6 py-2.5 font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors">Thoát</button>
          <button type="submit" disabled={saving || questions.length === 0} className="btn-primary py-2.5 px-8 rounded-xl shadow-lg shadow-primary-500/30 disabled:opacity-50 disabled:shadow-none flex items-center gap-2">
            <FiSave size={18} className={saving ? 'animate-pulse' : ''} />
            {saving ? 'Đang mã hóa & lưu...' : 'Xuất bản Trắc nghiệm'}
          </button>
        </div>

        {/* =============== Import Preview Modal =============== */}
        {showImportModal && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowImportModal(false)}>
            <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
              {/* Modal Header */}
              <div className="bg-gradient-to-r from-green-600 to-emerald-600 p-5 flex justify-between items-center text-white">
                <div>
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <FiUpload size={20} /> Preview Import
                  </h3>
                  <p className="text-green-100 text-sm mt-1">
                    {importFileName} — {importedQuestions.length} câu hỏi
                  </p>
                </div>
                <button onClick={() => setShowImportModal(false)} className="text-white/80 hover:text-white bg-white/10 hover:bg-white/20 p-2 rounded-lg transition-colors">
                  <FiX size={20} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="overflow-y-auto max-h-[55vh] p-6">
                {importError && (
                  <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm">
                    <FiAlertCircle className="inline mr-2" />{importError}
                  </div>
                )}
                
                <div className="space-y-3">
                  {importedQuestions.map((q, idx) => (
                    <div key={idx} className="border border-gray-200 rounded-xl p-4 bg-gray-50/50 hover:border-green-200 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-green-100 text-green-700 flex items-center justify-center font-bold text-sm flex-shrink-0 mt-0.5">
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-800 text-sm">{q.questionText || <span className="text-gray-400 italic">Không có nội dung</span>}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-100 border text-gray-500">
                              {q.questionType === 'SINGLE_CHOICE' ? 'Một đáp án' : q.questionType === 'MULTIPLE_CHOICE' ? 'Nhiều đáp án' : 'Đúng/Sai'}
                            </span>
                            <span className="text-xs text-gray-500">{q.points} điểm</span>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-1.5">
                            {q.options.map((opt, oi) => (
                              <div key={oi} className={`text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 ${
                                opt.isCorrect 
                                  ? 'bg-green-50 text-green-700 border border-green-200 font-medium' 
                                  : 'bg-white text-gray-600 border border-gray-100'
                              }`}>
                                {opt.isCorrect && <FiCheck size={12} className="flex-shrink-0" />}
                                {opt.text}
                              </div>
                            ))}
                          </div>
                          {q.explanation && (
                            <p className="mt-2 text-xs text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-100">
                              💡 {q.explanation}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="border-t p-5 flex items-center justify-between bg-gray-50">
                <p className="text-sm text-gray-500">
                  Sẽ thêm <strong className="text-green-700">{importedQuestions.length}</strong> câu hỏi vào danh sách hiện tại ({questions.length} câu)
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowImportModal(false)}
                    className="px-5 py-2.5 font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    onClick={confirmImport}
                    className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl shadow-lg shadow-green-500/30 transition-colors flex items-center gap-2"
                  >
                    <FiCheck size={18} />
                    Xác nhận Import ({importedQuestions.length} câu)
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};
