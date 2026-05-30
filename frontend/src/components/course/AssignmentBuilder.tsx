import { useState, useEffect } from 'react';
import { learningService, Assignment } from '../../services/learning.service';
import { FiSave, FiAlertCircle, FiX, FiPlus, FiFileText, FiClock } from 'react-icons/fi';
import toast from 'react-hot-toast';

interface AssignmentBuilderProps {
  courseId: string;
  lessonId: string;
  onClose: () => void;
}

const COMMON_FILE_TYPES = ['pdf', 'doc', 'docx', 'zip', 'png', 'jpg', 'txt', 'rar', 'mp4'];

export const AssignmentBuilder = ({ courseId, lessonId, onClose }: AssignmentBuilderProps) => {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [maxScore, setMaxScore] = useState(100);
  const [allowLateSubmission, setAllowLateSubmission] = useState(false);
  
  // Custom Tag Input state
  const [allowedFileTypes, setAllowedFileTypes] = useState<string[]>(['pdf', 'doc', 'docx', 'zip']);
  const [fileTypeInput, setFileTypeInput] = useState('');

  useEffect(() => {
    loadAssignment();
  }, [lessonId]);

  const loadAssignment = async () => {
    setLoading(true);
    try {
      const a = await learningService.getAssignmentByLesson(lessonId);
      setAssignment(a);
      setTitle(a.title);
      setDescription(a.description || '');
      setInstructions(a.instructions || '');
      if (a.dueDate) {
        setDueDate(new Date(a.dueDate).toISOString().slice(0, 16));
      }
      setMaxScore(a.maxScore);
      setAllowLateSubmission(a.allowLateSubmission);
      if (a.allowedFileTypes && a.allowedFileTypes.length > 0) {
         setAllowedFileTypes(a.allowedFileTypes);
      }
    } catch (err: any) {
      if (err.response?.status !== 404) {
        setError('Tải quản lý bài tập thất bại');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAddFileType = (e?: React.KeyboardEvent | React.FocusEvent) => {
    if (e && 'key' in e && e.key !== 'Enter' && e.key !== ',') return;
    if (e && 'key' in e) e.preventDefault();
    
    const token = fileTypeInput.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().trim();
    if (token && !allowedFileTypes.includes(token)) {
      setAllowedFileTypes([...allowedFileTypes, token]);
    }
    setFileTypeInput('');
  };

  const handleRemoveFileType = (typeToRemove: string) => {
    setAllowedFileTypes(allowedFileTypes.filter(t => t !== typeToRemove));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    setSaving(true);
    setError('');

    if (allowedFileTypes.length === 0) {
      setError('Vui lòng cho phép ít nhất 1 định dạng file (VD: pdf).');
      setSaving(false);
      return;
    }

    const payload = {
      courseId,
      lessonId,
      title,
      description,
      instructions: instructions || undefined,
      dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      maxScore,
      allowLateSubmission,
      allowedFileTypes,
    };

    try {
      if (assignment) {
        await learningService.updateAssignment(assignment.id, payload);
        toast.success('Cập nhật bài tập thành công');
      } else {
        await learningService.createAssignment(payload as any);
        toast.success('Tạo bài tập thành công');
      }
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Lưu bài tập thất bại do lỗi hệ thống.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500 animate-pulse">Đang nạp cấu hình bài tập thực hành...</div>;

  return (
    <div className="bg-white border rounded-xl shadow-sm mt-4 mb-8 border-primary-200 overflow-hidden">
      {/* HEADER SECTION */}
      <div className="bg-gradient-to-r from-amber-600 to-orange-600 p-5 flex justify-between items-center text-white">
        <h3 className="text-xl font-bold flex items-center gap-2">
           <FiFileText size={22} className="opacity-90" />
           {assignment ? 'Sửa Yêu cầu Bài tập' : 'Khởi tạo Bài tập Mới'}
        </h3>
        <div className="flex items-center gap-3">
          {assignment && (
            <a href={`/instructor/assignments/${assignment.id}/submissions`} target="_blank" rel="noreferrer" className="text-sm font-medium text-amber-900 bg-white/90 hover:bg-white px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1.5 shadow-sm">
              <span>Chấm điểm</span>
              <span className="bg-amber-100 text-amber-700 px-1.5 rounded-lg text-xs">Phím tắt</span>
            </a>
          )}
          <button onClick={onClose} className="text-white/80 hover:text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-xl transition-colors text-sm font-medium">Đóng</button>
        </div>
      </div>

      <form onSubmit={handleSave} className="p-6 md:p-8">
        {error && (
          <div className="mb-8 p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl flex items-start gap-3">
            <FiAlertCircle className="mt-0.5 flex-shrink-0" size={18} /> 
            <span className="font-medium text-sm">{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          {/* LỀ TRÁI: Nội dung chính */}
          <div className="md:col-span-8 space-y-6">
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">Tiêu đề Bài tập <span className="text-red-500">*</span></label>
              <input required value={title} onChange={e => setTitle(e.target.value)} className="input-field shadow-sm text-lg py-3" placeholder="VD: Nộp báo cáo Đồ án cuối môn học" />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5 flex justify-between">
                <span>Mô tả tổng quát (Yêu cầu) <span className="text-red-500">*</span></span>
              </label>
              <textarea required value={description} onChange={e => setDescription(e.target.value)} className="input-field shadow-sm py-3 min-h-[120px]" placeholder="Nêu rõ bối cảnh và mục tiêu bài thực hành để học viên nắm vững..." />
            </div>

            <div className="bg-cyan-50/50 p-5 rounded-xl border border-cyan-100/50">
              <label className="block text-sm font-semibold text-cyan-900 mb-1.5">Hướng dẫn từng bước (Tùy chọn)</label>
              <textarea value={instructions} onChange={e => setInstructions(e.target.value)} className="input-field shadow-sm border-cyan-200 focus:border-cyan-400 focus:ring-cyan-400 min-h-[120px] bg-white/70" placeholder="Bước 1: Tải template đính kèm...&#10;Bước 2: Điền thông số...&#10;Bước 3: Lên báo cáo mật độ..." />
              <p className="text-xs text-cyan-600/70 mt-2">Phần này sẽ hiện dưới dạng danh sách nhiệm vụ nếu có đánh dấu hoa thị/gạch đầu dòng.</p>
            </div>
          </div>

          {/* LỀ PHẢI: Thiết lập thuộc tính */}
          <div className="md:col-span-4 space-y-6">
            <div className="bg-slate-50 rounded-xl p-5 border border-slate-100">
               <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4 border-b pb-2">Cấu hình Nộp bài</h4>
               
               <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Điểm tuyệt đối tối đa <span className="text-red-500">*</span></label>
                    <div className="relative">
                      <input type="number" min="1" required value={maxScore} onChange={e => setMaxScore(Number(e.target.value))} className="input-field shadow-sm pr-12 font-bold text-lg text-amber-700" />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">Điểm</span>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                      <FiClock className="text-slate-400" /> Hạn chót (Due Date)
                    </label>
                    <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input-field shadow-sm" />
                    {dueDate && new Date(dueDate) < new Date() && (
                      <p className="text-red-500 text-xs mt-1 font-medium">Lưu ý: Hạn chót này nằm trong quá khứ.</p>
                    )}
                  </div>

                  <div className="flex items-start gap-3 bg-white p-3 border border-slate-100 rounded-xl shadow-sm">
                    <div className="flex items-center h-5 mt-0.5">
                      <input 
                         id="late-sub" 
                         type="checkbox" 
                         checked={allowLateSubmission} 
                         onChange={e => setAllowLateSubmission(e.target.checked)} 
                         className="w-4 h-4 text-amber-600 focus:ring-amber-500 border-slate-200 rounded cursor-pointer" 
                      />
                    </div>
                    <div className="flex flex-col">
                      <label htmlFor="late-sub" className="text-sm font-semibold text-slate-800 cursor-pointer">Cho phép nộp trễ</label>
                      <span className="text-xs text-slate-500 mt-0.5 leading-relaxed">Nếu tắt, cổng nộp sẽ tự động khóa cứng sau hạn chót thời gian trên.</span>
                    </div>
                  </div>
               </div>
            </div>

            {/* QUẢN LÝ ĐỊNH DẠNG FILE */}
            <div className="bg-slate-50 rounded-xl p-5 border border-slate-100">
               <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4 border-b pb-2 flex justify-between items-center">
                  Định dạng File
                  <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-medium">{allowedFileTypes.length} loại</span>
               </h4>
               
               <div className="space-y-4">
                  <div className="relative">
                    <input 
                      type="text" 
                      value={fileTypeInput} 
                      onChange={e => setFileTypeInput(e.target.value)} 
                      onKeyDown={handleAddFileType}
                      onBlur={handleAddFileType}
                      className="input-field shadow-sm pr-10 border-slate-200 focus:border-amber-400 focus:ring-amber-400" 
                      placeholder="Nhập đuôi file (VD: mp4) + Enter..." 
                    />
                    <button type="button" onClick={(e) => handleAddFileType(e as any)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-amber-600 bg-slate-100 hover:bg-amber-50 p-1 rounded-lg transition-colors">
                      <FiPlus />
                    </button>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 min-h-[4rem] p-3 bg-white border border-slate-100 rounded-xl shadow-inner content-start">
                    {allowedFileTypes.length === 0 && (
                      <span className="text-xs text-slate-400 italic">Chưa có giới hạn định dạng</span>
                    )}
                    {allowedFileTypes.map(type => (
                      <span key={type} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                        .{type}
                        <button type="button" onClick={() => handleRemoveFileType(type)} className="hover:text-red-500 hover:bg-amber-200 rounded-full p-0.5 ml-1 transition-colors outline-none focus:ring-2 focus:ring-offset-1 focus:ring-amber-400">
                           <FiX size={12} />
                        </button>
                      </span>
                    ))}
                  </div>

                  <div className="pt-2">
                    <p className="text-xs text-slate-500 font-medium mb-2">Đề xuất nhanh:</p>
                    <div className="flex flex-wrap gap-1.5">
                       {COMMON_FILE_TYPES.filter(t => !allowedFileTypes.includes(t)).slice(0, 5).map(type => (
                         <button
                           key={type}
                           type="button"
                           onClick={() => setAllowedFileTypes([...allowedFileTypes, type])}
                           className="text-[10px] font-medium text-slate-500 hover:text-amber-700 bg-slate-100 hover:bg-amber-50 border border-slate-100 hover:border-amber-200 rounded px-1.5 py-0.5 transition-colors"
                         >
                           +{type}
                         </button>
                       ))}
                    </div>
                  </div>
               </div>
            </div>
          </div>
        </div>

        {/* BOTTOM ACTIONS */}
        <div className="mt-8 flex justify-end gap-3 pt-6 border-t border-slate-100 bg-white sticky bottom-0 pb-2">
          <button type="button" onClick={onClose} className="px-6 py-2.5 font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors outline-none focus:ring-2 focus:ring-slate-200">Hủy bỏ</button>
          <button type="submit" disabled={saving} className="btn-primary bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 border-none py-2.5 px-8 rounded-xl shadow-sm shadow-amber-500/30 disabled:opacity-50 disabled:shadow-none flex items-center gap-2 outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500">
            <FiSave size={18} className={saving ? 'animate-pulse' : ''} />
            {saving ? 'Đang tạo phiên bản...' : 'Lưu Hồ sơ Bài tập'}
          </button>
        </div>
      </form>
    </div>
  );
};
