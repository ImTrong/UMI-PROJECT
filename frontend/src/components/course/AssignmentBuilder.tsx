import { useState, useEffect } from 'react';
import { learningService, Assignment } from '../../services/learning.service';
import { FiSave, FiAlertCircle } from 'react-icons/fi';
import toast from 'react-hot-toast';

interface AssignmentBuilderProps {
  lessonId: string;
  onClose: () => void;
}

export const AssignmentBuilder = ({ lessonId, onClose }: AssignmentBuilderProps) => {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instructionUrl, setInstructionUrl] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [maxScore, setMaxScore] = useState(100);
  const [passingScore, setPassingScore] = useState(80);
  const [allowLateSubmission, setAllowLateSubmission] = useState(false);
  const [allowedFileTypes, setAllowedFileTypes] = useState<string>('pdf,doc,docx,zip');

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
      setInstructionUrl(a.instructionUrl || '');
      if (a.dueDate) {
        setDueDate(new Date(a.dueDate).toISOString().slice(0, 16)); // Format for datetime-local input
      }
      setMaxScore(a.maxScore);
      setPassingScore(a.passingScore);
      setAllowLateSubmission(a.allowLateSubmission);
      setAllowedFileTypes(a.allowedFileTypes.join(','));
    } catch (err: any) {
      if (err.response?.status !== 404) {
        setError('Tải bài tập thất bại');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passingScore > maxScore) {
      setError('Điểm đạt yêu cầu không thể lớn hơn điểm tối đa.');
      return;
    }

    setSaving(true);
    setError('');

    const payload = {
      lessonId,
      title,
      description,
      instructionUrl,
      dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      maxScore,
      passingScore,
      allowLateSubmission,
      allowedFileTypes: allowedFileTypes.split(',').map(s => s.trim()).filter(Boolean),
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
      setError(err.response?.data?.error || 'Lưu bài tập thất bại');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-4 text-center">Đang tải dữ liệu bài tập...</div>;

  return (
    <div className="bg-white border rounded-xl overflow-hidden shadow-sm mt-4 mb-8 border-primary-200">
      <div className="bg-primary-50 p-4 border-b border-primary-100 flex justify-between items-center">
        <h3 className="text-lg font-bold text-primary-900">{assignment ? 'Sửa Bài tập' : 'Tạo Bài tập'}</h3>
        <div className="flex items-center gap-3">
          {assignment && (
            <a href={`/instructor/assignments/${assignment.id}/submissions`} target="_blank" rel="noreferrer" className="text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 border border-amber-200 shadow-sm">
              Chấm điểm Bài nộp <span>→</span>
            </a>
          )}
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 font-medium text-sm">Đóng</button>
        </div>
      </div>

      <form onSubmit={handleSave} className="p-6">
        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-2">
            <FiAlertCircle /> {error}
          </div>
        )}

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tiêu đề Bài tập *</label>
            <input required value={title} onChange={e => setTitle(e.target.value)} className="input-field" placeholder="VD: Bài nộp Dự án cuối khóa" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả (Yêu cầu) *</label>
            <textarea required value={description} onChange={e => setDescription(e.target.value)} className="input-field" rows={4} placeholder="Mô tả những gì học viên cần thực hiện..." />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Điểm tối đa *</label>
              <input type="number" min="1" required value={maxScore} onChange={e => setMaxScore(Number(e.target.value))} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Điểm đạt yêu cầu *</label>
              <input type="number" min="0" required value={passingScore} onChange={e => setPassingScore(Number(e.target.value))} className="input-field" />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ngày hạn chót</label>
              <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} className="input-field" />
            </div>
            <div className="flex flex-col justify-center">
              <label className="flex items-center gap-2 cursor-pointer mt-6">
                <input type="checkbox" checked={allowLateSubmission} onChange={e => setAllowLateSubmission(e.target.checked)} className="w-4 h-4 text-primary-600 focus:ring-primary-500" />
                <span className="text-sm font-medium text-gray-700">Cho phép nộp trễ</span>
              </label>
              <p className="text-xs text-gray-500 ml-6">Nếu không chọn, học viên sẽ không thể nộp bài sau hạn chót.</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Đường dẫn File Hướng dẫn (Tùy chọn)</label>
            <input type="url" value={instructionUrl} onChange={e => setInstructionUrl(e.target.value)} className="input-field" placeholder="https://..." />
            <p className="text-xs text-gray-500 mt-1">Liên kết đến file PDF hoặc tài liệu chứa hướng dẫn chi tiết.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Định dạng File Cho phép</label>
            <input type="text" value={allowedFileTypes} onChange={e => setAllowedFileTypes(e.target.value)} className="input-field" placeholder="pdf, zip, docx" />
            <p className="text-xs text-gray-500 mt-1">Danh sách các đuôi file phân cách bằng dấu phẩy (VD: pdf, zip, jpg).</p>
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-4 border-t pt-6">
          <button type="button" onClick={onClose} className="btn-secondary">Hủy</button>
          <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 px-8">
            <FiSave /> {saving ? 'Đang lưu...' : 'Lưu Bài tập'}
          </button>
        </div>
      </form>
    </div>
  );
};
