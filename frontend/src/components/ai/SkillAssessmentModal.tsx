import { useState, useEffect, useCallback } from 'react';
import {
  FiX, FiArrowRight, FiArrowLeft, FiCheck, FiClock,
  FiZap, FiTarget, FiAward, FiChevronRight, FiLoader
} from 'react-icons/fi';
import {
  aiService,
  AssessmentQuestion,
  AssessmentAnswer,
  SkillProfileEntry,
  CareerAdvisorResponse,
  CareerPathRecommendation,
} from '../../services/ai.service';
import toast from 'react-hot-toast';

// ==================== Types ====================

type ModalScreen = 'INTRO' | 'QUESTIONS' | 'BATCH_LOADING' | 'COMPLETE' | 'ROADMAP_LOADING' | 'SKIP_CONFIRM';

interface SkillAssessmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  goal: string;
  sessionId: string;
  initialQuestions: AssessmentQuestion[];
  initialSkillProfile: SkillProfileEntry[];
  initialProfile: { profileCompleteness: number; summary: string };
  skillsToAssess: string[];
  assessmentReason: string;
  onRoadmapReady: (roadmap: CareerPathRecommendation) => void;
}

// ==================== Skill Level Display ====================

const LEVEL_LABELS: Record<string, { label: string; color: string; bgColor: string }> = {
  ADVANCED: { label: 'Nâng cao', color: 'text-emerald-700 dark:text-emerald-300', bgColor: 'bg-emerald-100 dark:bg-emerald-500/20' },
  INTERMEDIATE: { label: 'Trung bình', color: 'text-blue-700 dark:text-blue-300', bgColor: 'bg-blue-100 dark:bg-blue-500/20' },
  BEGINNER: { label: 'Cơ bản', color: 'text-amber-700 dark:text-amber-300', bgColor: 'bg-amber-100 dark:bg-amber-500/20' },
  NO_EVIDENCE: { label: 'Chưa đủ dữ liệu', color: 'text-slate-500 dark:text-gray-400', bgColor: 'bg-slate-100 dark:bg-gray-700/50' },
};

// ==================== Main Component ====================

export default function SkillAssessmentModal({
  isOpen,
  onClose,
  goal,
  sessionId,
  initialQuestions,
  initialSkillProfile,
  initialProfile,
  skillsToAssess,
  assessmentReason,
  onRoadmapReady,
}: SkillAssessmentModalProps) {
  // ---- Screen state machine ----
  const [screen, setScreen] = useState<ModalScreen>('INTRO');

  // ---- Questions state ----
  const [questions, setQuestions] = useState<AssessmentQuestion[]>(initialQuestions);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  // ---- Cumulative tracking ----
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [currentRound, setCurrentRound] = useState(1);
  const [currentSessionId, setCurrentSessionId] = useState(sessionId);

  // ---- Profile state ----
  const [skillProfile, setSkillProfile] = useState<SkillProfileEntry[]>(initialSkillProfile);
  const [profile, setProfile] = useState(initialProfile);

  // ---- Active skills being assessed ----
  const [activeSkills, setActiveSkills] = useState<string[]>(skillsToAssess);
  const [completedSkillGroups, setCompletedSkillGroups] = useState<string[]>([]);

  // ---- Final roadmap ----
  const [roadmap, setRoadmap] = useState<CareerPathRecommendation | null>(null);

  // Reset when modal reopens
  useEffect(() => {
    if (isOpen) {
      setScreen('INTRO');
      setQuestions(initialQuestions);
      setCurrentIndex(0);
      setAnswers({});
      setSelectedOption(null);
      setTotalAnswered(0);
      setCurrentRound(1);
      setCurrentSessionId(sessionId);
      setSkillProfile(initialSkillProfile);
      setProfile(initialProfile);
      setActiveSkills(skillsToAssess);
      setCompletedSkillGroups([]);
      setRoadmap(null);
    }
  }, [isOpen, sessionId]);

  // ---- Current question ----
  const currentQuestion = questions[currentIndex];
  const currentSkill = currentQuestion?.skill || '';

  // ---- Distinct skills in current batch ----
  const batchSkills = [...new Set(questions.map(q => q.skill))];

  // ---- Select answer ----
  const handleSelectOption = (option: string) => {
    setSelectedOption(option);
  };

  // ---- Navigate to next question ----
  const handleNext = () => {
    if (!selectedOption || !currentQuestion) return;

    // Save answer
    const updatedAnswers = { ...answers, [currentQuestion.id]: selectedOption };
    setAnswers(updatedAnswers);
    setSelectedOption(null);

    if (currentIndex < questions.length - 1) {
      // Next question in batch
      setCurrentIndex(currentIndex + 1);
    } else {
      // Batch complete → submit to backend
      submitBatch(updatedAnswers);
    }
  };

  // ---- Navigate to previous question ----
  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      // Restore previous answer
      const prevQuestion = questions[currentIndex - 1];
      setSelectedOption(answers[prevQuestion.id] || null);
    }
  };

  // ---- Submit batch to backend ----
  const submitBatch = useCallback(async (batchAnswers: Record<string, string>) => {
    setScreen('BATCH_LOADING');

    // Build answers array
    const answersArray: AssessmentAnswer[] = questions.map(q => ({
      questionId: q.id,
      skill: q.skill,
      answer: batchAnswers[q.id] || '',
      correctAnswer: q.correctAnswer,
    }));

    try {
      const result: CareerAdvisorResponse = await aiService.submitAssessmentAnswers(
        currentSessionId,
        answersArray
      );

      const newTotalAnswered = totalAnswered + questions.length;
      setTotalAnswered(newTotalAnswered);

      // Track completed skill groups
      const batchSkillSet = [...new Set(questions.map(q => q.skill))];
      setCompletedSkillGroups(prev => [...new Set([...prev, ...batchSkillSet])]);

      if (result.status === 'ROADMAP_READY') {
        // Assessment complete → show roadmap!
        const roadmapResult = result as any;
        setSkillProfile(roadmapResult.skillProfile?.skillProfile || roadmapResult.skillProfile || []);
        setRoadmap(roadmapResult.roadmap);
        setScreen('COMPLETE');
      } else if (result.status === 'PROFILE_COMPLETE') {
        // Profile complete but roadmap generation failed or pending
        const profileResult = result as any;
        setSkillProfile(profileResult.skillProfile?.skillProfile || profileResult.skillProfile || []);
        setScreen('ROADMAP_LOADING');
        // The roadmap will be generated by backend automatically
        toast.success('Đánh giá hoàn tất! Đang tạo lộ trình...');
      } else {
        // ASSESSMENT_CONTINUE — more questions needed
        const continueResult = result as any;
        setSkillProfile(continueResult.skillProfile || []);
        setProfile(continueResult.overallProfile || profile);
        setActiveSkills(continueResult.assessment?.skillsToAssess || []);
        setQuestions(continueResult.assessment?.questions || []);
        setCurrentRound(currentRound + 1);
        setCurrentIndex(0);
        setAnswers({});
        setSelectedOption(null);
        // Show questions for next batch
        setScreen('QUESTIONS');
        toast('Tiếp tục đánh giá thêm một số kỹ năng...', { icon: '📝' });
      }
    } catch (err: any) {
      console.error('Submit assessment error:', err);
      toast.error('Có lỗi khi gửi bài đánh giá. Vui lòng thử lại!');
      setScreen('QUESTIONS');
    }
  }, [questions, currentSessionId, totalAnswered, currentRound, profile]);

  // ---- Prevent body scroll when modal is open ----
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  // ==================== SCREEN: INTRO ====================
  const renderIntro = () => (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 animate-fadeIn">
      {/* Icon */}
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary-500 to-cyan-500 flex items-center justify-center mb-6 shadow-xl shadow-primary-500/30">
        <FiTarget className="text-white" size={36} />
      </div>

      {/* Title */}
      <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white mb-3 text-center">
        Đánh giá năng lực đầu vào
      </h2>

      {/* Goal badge */}
      <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-50 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/20 rounded-full mb-6">
        <FiTarget size={14} className="text-primary-500" />
        <span className="text-sm font-bold text-primary-700 dark:text-primary-300">{goal}</span>
      </div>

      {/* Description */}
      <p className="text-slate-600 dark:text-gray-400 text-center max-w-lg mb-8 leading-relaxed font-medium">
        {assessmentReason || 'Bài đánh giá giúp UMI xác định những kiến thức và kỹ năng bạn đã có liên quan đến mục tiêu. Kết quả sẽ được sử dụng để cá nhân hóa lộ trình học tập cho bạn.'}
      </p>

      {/* Info cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-xl w-full mb-8">
        <div className="bg-white dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700/50 rounded-xl p-4 text-center">
          <FiClock className="mx-auto mb-2 text-blue-500" size={22} />
          <p className="text-xs font-bold text-slate-500 dark:text-gray-400 uppercase">Thời gian</p>
          <p className="text-sm font-bold text-slate-800 dark:text-white">5–15 phút</p>
        </div>
        <div className="bg-white dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700/50 rounded-xl p-4 text-center">
          <FiZap className="mx-auto mb-2 text-amber-500" size={22} />
          <p className="text-xs font-bold text-slate-500 dark:text-gray-400 uppercase">Hình thức</p>
          <p className="text-sm font-bold text-slate-800 dark:text-white">Trắc nghiệm</p>
        </div>
        <div className="bg-white dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700/50 rounded-xl p-4 text-center">
          <FiAward className="mx-auto mb-2 text-emerald-500" size={22} />
          <p className="text-xs font-bold text-slate-500 dark:text-gray-400 uppercase">Mục đích</p>
          <p className="text-sm font-bold text-slate-800 dark:text-white">Cá nhân hóa</p>
        </div>
      </div>

      {/* Notice */}
      <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-xl p-4 max-w-lg w-full mb-8">
        <p className="text-sm text-blue-700 dark:text-blue-300 font-medium text-center">
          💡 Đây <strong>không phải</strong> bài thi đạt hoặc trượt. Mục đích là xác định <strong>điểm xuất phát</strong> để AI xây dựng lộ trình phù hợp nhất với bạn.
        </p>
      </div>

      {/* Skills to assess */}
      {activeSkills.length > 0 && (
        <div className="mb-8">
          <p className="text-xs font-bold text-slate-500 dark:text-gray-500 uppercase mb-3 text-center">Kỹ năng sẽ đánh giá</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {activeSkills.map(skill => (
              <span key={skill} className="px-3 py-1.5 text-sm font-semibold bg-slate-100 dark:bg-gray-700/50 text-slate-700 dark:text-gray-300 rounded-full border border-slate-200 dark:border-gray-600/30">
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Start and Skip buttons */}
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <button
          onClick={() => setScreen('SKIP_CONFIRM')}
          className="flex items-center gap-2 px-8 py-4 bg-white dark:bg-gray-800 border-2 border-slate-200 dark:border-gray-700 
            text-slate-600 dark:text-gray-300 font-bold rounded-2xl hover:bg-slate-50 dark:hover:bg-gray-700 
            transition-all active:scale-95 text-lg"
        >
          Bỏ qua, bắt đầu từ cơ bản
        </button>
        <button
          onClick={() => setScreen('QUESTIONS')}
          className="flex items-center gap-2 px-10 py-4 bg-gradient-to-r from-primary-500 to-cyan-500 text-white font-bold rounded-2xl
            hover:from-primary-600 hover:to-cyan-600 transition-all shadow-xl shadow-primary-500/30 active:scale-95 text-lg"
        >
          Bắt đầu đánh giá
          <FiArrowRight size={20} />
        </button>
      </div>
    </div>
  );

  // ==================== SCREEN: SKIP_CONFIRM ====================
  const renderSkipConfirm = () => (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 animate-fadeIn">
      <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-gray-800 flex items-center justify-center mb-6 shadow-md border border-slate-200 dark:border-gray-700">
        <FiTarget className="text-slate-400 dark:text-gray-500" size={36} />
      </div>

      <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white mb-4 text-center">
        Bạn muốn bỏ qua đánh giá năng lực?
      </h2>

      <p className="text-slate-600 dark:text-gray-400 text-center max-w-lg mb-8 leading-relaxed font-medium">
        UMI sẽ xây dựng lộ trình bắt đầu từ kiến thức nền tảng vì hiện tại chưa có đủ dữ liệu để xác định chính xác trình độ của bạn. Bạn vẫn có thể thực hiện đánh giá sau này để cá nhân hóa lộ trình tốt hơn.
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-4 w-full justify-center">
        <button
          onClick={() => setScreen('INTRO')}
          className="w-full sm:w-auto px-8 py-4 bg-white dark:bg-gray-800 border-2 border-slate-200 dark:border-gray-700 
            text-slate-700 dark:text-gray-300 font-bold rounded-2xl hover:bg-slate-50 dark:hover:bg-gray-700 
            transition-all active:scale-95"
        >
          Quay lại đánh giá
        </button>
        <button
          onClick={async () => {
            setScreen('ROADMAP_LOADING');
            try {
              const result = await aiService.skipAssessment(currentSessionId);
              if (result.status === 'ROADMAP_READY') {
                setRoadmap((result as any).roadmap);
                setSkillProfile((result as any).skillProfile || []);
                setScreen('COMPLETE');
              } else if (result.status === 'PROFILE_COMPLETE') {
                setSkillProfile((result as any).skillProfile || []);
                setScreen('ROADMAP_LOADING'); // wait for another polling or manual refresh if backend separates generation
                toast.success('Đã ghi nhận yêu cầu. Đang tạo lộ trình...');
              }
            } catch (err) {
              console.error('Skip assessment error:', err);
              toast.error('Có lỗi xảy ra. Vui lòng thử lại!');
              setScreen('SKIP_CONFIRM');
            }
          }}
          className="w-full sm:w-auto px-8 py-4 bg-slate-800 dark:bg-gray-200 text-white dark:text-slate-900 
            font-bold rounded-2xl hover:bg-slate-900 dark:hover:bg-white transition-all active:scale-95 shadow-lg"
        >
          Bỏ qua & bắt đầu từ cơ bản
        </button>
      </div>
    </div>
  );

  // ==================== SCREEN: QUESTIONS ====================
  const renderQuestions = () => {
    if (!currentQuestion) return null;

    const answeredInBatch = Object.keys(answers).length;
    const progressInBatch = ((answeredInBatch + (selectedOption ? 1 : 0)) / questions.length) * 100;

    return (
      <div className="flex flex-col h-full animate-fadeIn">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-200 dark:border-gray-700/50">
          {/* Goal & round */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FiTarget size={16} className="text-primary-500" />
              <span className="text-sm font-bold text-slate-600 dark:text-gray-400">{goal}</span>
            </div>
            <span className="text-xs font-bold text-slate-400 dark:text-gray-500">
              Vòng {currentRound}
            </span>
          </div>

          {/* Progress bar */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-bold text-slate-700 dark:text-gray-300">
                Câu {currentIndex + 1} · <span className="text-primary-600 dark:text-primary-400">{currentSkill}</span>
              </span>
              <span className="text-xs font-bold text-slate-400 dark:text-gray-500">
                Đã hoàn thành {totalAnswered + answeredInBatch} câu (Tối đa 30 câu)
              </span>
            </div>
            <div className="w-full h-2 bg-slate-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary-500 to-cyan-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressInBatch}%` }}
              />
            </div>
          </div>

          {/* Skill tracker */}
          <div className="flex items-center gap-2 flex-wrap">
            {batchSkills.map((skill) => {
              const isCurrentSkill = skill === currentSkill;
              const isDone = completedSkillGroups.includes(skill) ||
                (answers && questions.filter(q => q.skill === skill).every(q => answers[q.id]));
              return (
                <div key={skill} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold transition-all
                  ${isCurrentSkill
                    ? 'bg-primary-100 dark:bg-primary-500/20 text-primary-700 dark:text-primary-300 border border-primary-300 dark:border-primary-500/30'
                    : isDone
                      ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
                      : 'bg-slate-100 dark:bg-gray-700/40 text-slate-500 dark:text-gray-400 border border-slate-200 dark:border-gray-600/20'
                  }`}>
                  {isDone ? <FiCheck size={10} /> : isCurrentSkill ? <span className="w-1.5 h-1.5 bg-primary-500 rounded-full animate-pulse" /> : <span className="w-1.5 h-1.5 bg-slate-300 dark:bg-gray-500 rounded-full" />}
                  {skill}
                </div>
              );
            })}
          </div>
        </div>

        {/* Question area */}
        <div className="flex-1 overflow-y-auto px-6 py-8">
          {/* Difficulty badge */}
          <div className="mb-4">
            <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold
              ${currentQuestion.difficulty === 'BEGINNER' ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400' : ''}
              ${currentQuestion.difficulty === 'INTERMEDIATE' ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400' : ''}
              ${currentQuestion.difficulty === 'ADVANCED' ? 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400' : ''}
            `}>
              {currentQuestion.difficulty === 'BEGINNER' ? 'Cơ bản' : currentQuestion.difficulty === 'INTERMEDIATE' ? 'Trung bình' : 'Nâng cao'}
            </span>
          </div>

          {/* Question text */}
          <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white mb-8 leading-relaxed">
            {currentQuestion.question}
          </h3>

          {/* Options */}
          <div className="space-y-3 max-w-2xl">
            {currentQuestion.options.map((option, idx) => {
              const optionLetter = option.charAt(0); // A, B, C, D
              const isSelected = selectedOption === optionLetter;

              return (
                <button
                  key={idx}
                  onClick={() => handleSelectOption(optionLetter)}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-200
                    ${isSelected
                      ? 'border-primary-500 dark:border-primary-400 bg-primary-50 dark:bg-primary-500/15 shadow-md shadow-primary-500/10'
                      : 'border-slate-200 dark:border-gray-700/50 bg-white dark:bg-gray-800/40 hover:border-slate-300 dark:hover:border-gray-600 hover:bg-slate-50 dark:hover:bg-gray-800/60'
                    }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-sm font-bold transition-colors
                      ${isSelected
                        ? 'bg-primary-500 text-white'
                        : 'bg-slate-100 dark:bg-gray-700 text-slate-500 dark:text-gray-400'
                      }`}>
                      {optionLetter}
                    </div>
                    <span className={`text-sm sm:text-base font-medium pt-1
                      ${isSelected
                        ? 'text-primary-700 dark:text-primary-200'
                        : 'text-slate-700 dark:text-gray-300'
                      }`}>
                      {option.substring(3).trim()}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer navigation */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-gray-700/50 flex items-center justify-between">
          <button
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-slate-600 dark:text-gray-400
              bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl
              hover:bg-slate-50 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <FiArrowLeft size={16} />
            Câu trước
          </button>

          <button
            onClick={handleNext}
            disabled={!selectedOption}
            className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold text-white
              bg-gradient-to-r from-primary-500 to-cyan-500 rounded-xl
              hover:from-primary-600 hover:to-cyan-600
              disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary-500/20 active:scale-95"
          >
            {currentIndex < questions.length - 1 ? (
              <>Câu tiếp theo <FiArrowRight size={16} /></>
            ) : (
              <>Hoàn thành phần này <FiCheck size={16} /></>
            )}
          </button>
        </div>
      </div>
    );
  };

  // ==================== SCREEN: BATCH_LOADING ====================
  const renderBatchLoading = () => (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 animate-fadeIn">
      {/* Spinner */}
      <div className="relative mb-8">
        <div className="w-20 h-20 rounded-full border-4 border-slate-200 dark:border-gray-700" />
        <div className="absolute inset-0 w-20 h-20 rounded-full border-4 border-transparent border-t-primary-500 animate-spin" />
        <FiZap className="absolute inset-0 m-auto text-primary-500" size={28} />
      </div>

      <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3 text-center">
        Đang phân tích kết quả...
      </h3>
      <p className="text-slate-500 dark:text-gray-400 text-center max-w-sm font-medium">
        UMI đang đánh giá câu trả lời của bạn để xác định cần thêm thông tin gì.
      </p>

      <div className="mt-6 flex items-center gap-2 text-sm text-primary-600 dark:text-primary-400 font-bold animate-pulse">
        <FiLoader className="animate-spin" size={14} />
        Phân tích vòng {currentRound}...
      </div>
    </div>
  );

  // ==================== SCREEN: COMPLETE ====================
  const renderComplete = () => (
    <div className="flex flex-col items-center px-4 py-8 animate-fadeIn overflow-y-auto">
      {/* Celebration */}
      <div className="text-5xl mb-4">🎉</div>
      <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white mb-2 text-center">
        Đánh giá hoàn tất!
      </h2>
      <p className="text-slate-500 dark:text-gray-400 text-center max-w-md mb-8 font-medium">
        UMI đã thu thập đủ thông tin để phân tích năng lực hiện tại của bạn.
      </p>

      {/* Stats */}
      <div className="flex items-center gap-6 mb-8">
        <div className="text-center">
          <p className="text-3xl font-extrabold text-primary-600 dark:text-primary-400">{totalAnswered + questions.length}</p>
          <p className="text-xs font-bold text-slate-500 dark:text-gray-400 uppercase">Câu trả lời</p>
        </div>
        <div className="w-px h-10 bg-slate-200 dark:bg-gray-700" />
        <div className="text-center">
          <p className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">{currentRound}</p>
          <p className="text-xs font-bold text-slate-500 dark:text-gray-400 uppercase">Vòng đánh giá</p>
        </div>
      </div>

      {/* Skill Profile Table */}
      {Array.isArray(skillProfile) && skillProfile.length > 0 && (
        <div className="w-full max-w-lg mb-8">
          <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4 text-center">Năng lực hiện tại</h3>
          <div className="bg-white dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700/50 rounded-2xl overflow-hidden">
            {skillProfile.map((entry, idx) => {
              const levelInfo = LEVEL_LABELS[entry.level] || LEVEL_LABELS.NO_EVIDENCE;
              return (
                <div key={idx} className={`flex items-center justify-between px-5 py-3.5 ${idx > 0 ? 'border-t border-slate-100 dark:border-gray-700/30' : ''}`}>
                  <span className="font-semibold text-slate-700 dark:text-gray-300 text-sm">{entry.skill}</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${levelInfo.bgColor} ${levelInfo.color}`}>
                    {levelInfo.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Action button */}
      {roadmap ? (
        <button
          onClick={() => {
            onRoadmapReady(roadmap);
            onClose();
          }}
          className="flex items-center gap-2 px-10 py-4 bg-gradient-to-r from-primary-500 to-cyan-500 text-white font-bold rounded-2xl
            hover:from-primary-600 hover:to-cyan-600 transition-all shadow-xl shadow-primary-500/30 active:scale-95 text-lg"
        >
          <FiAward size={20} />
          Xem lộ trình cá nhân hóa
          <FiChevronRight size={18} />
        </button>
      ) : (
        <div className="text-center">
          <p className="text-sm text-slate-500 dark:text-gray-400 mb-4 font-medium">Đang tạo lộ trình...</p>
          <div className="animate-spin w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full mx-auto" />
        </div>
      )}
    </div>
  );

  // ==================== SCREEN: ROADMAP_LOADING ====================
  const renderRoadmapLoading = () => (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 animate-fadeIn">
      {/* Animated icon */}
      <div className="relative mb-8">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary-100 to-cyan-100 dark:from-primary-500/20 dark:to-cyan-500/20 flex items-center justify-center">
          <FiZap className="text-primary-500 dark:text-primary-400 animate-pulse" size={40} />
        </div>
        <div className="absolute inset-0 w-24 h-24 rounded-full border-2 border-primary-300 dark:border-primary-500/30 animate-ping opacity-30" />
      </div>

      <h3 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mb-3 text-center">
        Đang xây dựng lộ trình cá nhân hóa...
      </h3>
      <p className="text-slate-500 dark:text-gray-400 text-center max-w-md font-medium leading-relaxed">
        AI đang đối chiếu mục tiêu nghề nghiệp, năng lực hiện tại và các khóa học có trên UMI để tìm ra lộ trình phù hợp nhất với bạn.
      </p>
    </div>
  );

  // ==================== RENDER ====================
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm animate-fadeIn"
        onClick={screen === 'INTRO' ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative w-full max-w-3xl max-h-[90vh] mx-4 bg-slate-50 dark:bg-gray-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-gray-700/50 overflow-hidden flex flex-col animate-slideUp">
        {/* Close button */}
        {(screen === 'INTRO' || screen === 'COMPLETE') && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 p-2 rounded-xl bg-white/80 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700
              text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700 transition-all"
          >
            <FiX size={20} />
          </button>
        )}

        {/* Step indicator */}
        {screen !== 'ROADMAP_LOADING' && (
          <div className="flex items-center justify-center gap-2 pt-5 pb-2 px-6">
            {(['INTRO', 'QUESTIONS', 'COMPLETE'] as const).map((step, idx) => {
              const stepLabels = ['Giới thiệu', 'Đánh giá', 'Hoàn tất'];
              const isActive = step === screen || (screen === 'BATCH_LOADING' && step === 'QUESTIONS');
              const isDone =
                (step === 'INTRO' && screen !== 'INTRO') ||
                (step === 'QUESTIONS' && screen === 'COMPLETE');

              return (
                <div key={step} className="flex items-center gap-2">
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all
                    ${isDone ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
                      isActive ? 'bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-400' :
                        'bg-slate-100 dark:bg-gray-800 text-slate-400 dark:text-gray-500'
                    }`}>
                    {isDone ? <FiCheck size={12} /> : <span className="w-4 text-center">{idx + 1}</span>}
                    <span className="hidden sm:inline">{stepLabels[idx]}</span>
                  </div>
                  {idx < 2 && <div className="w-8 h-px bg-slate-200 dark:bg-gray-700" />}
                </div>
              );
            })}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {screen === 'INTRO' && renderIntro()}
          {screen === 'SKIP_CONFIRM' && renderSkipConfirm()}
          {screen === 'QUESTIONS' && renderQuestions()}
          {screen === 'BATCH_LOADING' && renderBatchLoading()}
          {screen === 'COMPLETE' && renderComplete()}
          {screen === 'ROADMAP_LOADING' && renderRoadmapLoading()}
        </div>
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
        .animate-slideUp { animation: slideUp 0.4s ease-out; }
      `}</style>
    </div>
  );
}
