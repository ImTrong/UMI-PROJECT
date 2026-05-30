import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { learningService, AssignmentSubmission } from '../../services/learning.service';
import { FiChevronLeft, FiDownload, FiCheck, FiX, FiFile } from 'react-icons/fi';
import toast from 'react-hot-toast';

export default function AssignmentSubmissions() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState<AssignmentSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Grading Modal State
  const [selectedSubmission, setSelectedSubmission] = useState<AssignmentSubmission | null>(null);
  const [score, setScore] = useState<number>(0);
  const [feedback, setFeedback] = useState<string>('');
  const [grading, setGrading] = useState(false);

  useEffect(() => {
    if (assignmentId) {
      loadSubmissions();
    }
  }, [assignmentId]);

  const loadSubmissions = async () => {
    setLoading(true);
    try {
      const data = await learningService.getAssignmentSubmissions(assignmentId!);
      setSubmissions(data);
    } catch (error) {
      toast.error('Tải danh sách bài nộp thất bại');
    } finally {
      setLoading(false);
    }
  };

  const openGradingModal = (sub: AssignmentSubmission) => {
    setSelectedSubmission(sub);
    setScore(sub.score || 0);
    setFeedback(sub.feedback || '');
  };

  const submitGrade = async (status: 'GRADED' | 'RETURNED') => {
    if (!selectedSubmission) return;
    setGrading(true);
    try {
      const updated = await learningService.gradeSubmission(selectedSubmission.id, {
        score,
        feedback,
        status,
      });
      setSubmissions(submissions.map(s => s.id === updated.id ? updated : s));
      toast.success(status === 'GRADED' ? 'Chấm điểm thành công' : 'Bài nộp đã được trả lại cho học viên');
      setSelectedSubmission(null);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Chấm điểm thất bại');
    } finally {
      setGrading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => navigate(-1)} className="p-2 bg-white border rounded-xl hover:bg-slate-50">
          <FiChevronLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bài nộp của học viên</h1>
          <p className="text-slate-500 text-sm">Xem xét, chấm điểm và góp ý</p>
        </div>
      </div>

      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Học viên</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Trạng thái</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Ngày nộp</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Điểm</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Thao tác</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {submissions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                    Chưa có bài nộp nào cho bài tập này.
                  </td>
                </tr>
              ) : (
                submissions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-slate-900">{sub.userId}</div>
                      <div className="text-sm text-slate-500">ID: {sub.id.substring(0, 8)}...</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        sub.status === 'GRADED' ? 'bg-green-100 text-green-800' :
                        sub.status === 'SUBMITTED' ? 'bg-cyan-100 text-cyan-800' :
                        sub.status === 'RETURNED' ? 'bg-amber-100 text-amber-800' :
                        'bg-slate-100 text-slate-800'
                      }`}>
                        {sub.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                      {sub.submittedAt ? new Date(sub.submittedAt).toLocaleString() : 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      {sub.score !== undefined ? sub.score : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => openGradingModal(sub)}
                        className="text-primary-600 hover:text-primary-900"
                        disabled={false}
                      >
                        {sub.status === 'GRADED' ? 'Sửa điểm' : 'Chấm điểm'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Grading Modal */}
      {selectedSubmission && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-sm max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="p-6 border-b flex justify-between items-center">
              <h3 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary-600 to-teal-600">
                Chấm điểm bài nộp
              </h3>
              <button onClick={() => setSelectedSubmission(null)} className="text-slate-400 hover:text-slate-600">
                <FiX size={24} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <div className="mb-6 grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl">
                <div>
                  <p className="text-sm text-slate-500 mb-1">Mã học viên</p>
                  <p className="font-medium">{selectedSubmission.userId}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500 mb-1">Ngày nộp</p>
                  <p className="font-medium">{selectedSubmission.submittedAt ? new Date(selectedSubmission.submittedAt).toLocaleString() : 'N/A'}</p>
                </div>
              </div>

              <div className="mb-6">
                <h4 className="font-semibold text-slate-800 mb-3 text-sm uppercase tracking-wider">Bài làm của học viên</h4>
                
                {selectedSubmission.content && (
                  <div className="mb-4 bg-white border border-slate-100 rounded-xl p-4 prose max-w-none text-sm text-slate-700">
                    <p className="whitespace-pre-wrap">{selectedSubmission.content}</p>
                  </div>
                )}

                {selectedSubmission.fileUrl && (
                  <div className="space-y-2">
                    <a href={selectedSubmission.fileUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between p-3 bg-primary-50 rounded-xl text-primary-700 hover:bg-primary-100 transition">
                      <div className="flex items-center gap-3">
                        <FiFile />
                        <span className="font-medium text-sm">{selectedSubmission.fileName || selectedSubmission.fileUrl.split('/').pop() || 'Tệp đính kèm'}</span>
                      </div>
                      <FiDownload size={18} />
                    </a>
                  </div>
                )}
                
                {!selectedSubmission.content && !selectedSubmission.fileUrl && (
                  <p className="text-slate-500 italic text-sm p-4 bg-slate-50 rounded text-center">Bài nộp trống.</p>
                )}
              </div>

              <hr className="my-6" />

              <h4 className="font-semibold text-slate-800 mb-4 text-sm uppercase tracking-wider">Chấm điểm</h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Điểm số</label>
                  <input
                    type="number"
                    min="0"
                    value={score}
                    onChange={(e) => setScore(Number(e.target.value))}
                    className="input-field max-w-[150px] font-bold text-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Nhận xét của giảng viên</label>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    className="input-field min-h-[120px]"
                    placeholder="Góp ý mang tính xây dựng cho học viên..."
                  />
                </div>
              </div>
            </div>

            <div className="p-6 border-t bg-slate-50 flex justify-end gap-3 rounded-b-xl">
              <button
                onClick={() => submitGrade('RETURNED')}
                disabled={grading}
                className="btn-secondary"
              >
                Trả lại cho học viên
              </button>
              <button
                onClick={() => submitGrade('GRADED')}
                disabled={grading}
                className="btn-primary flex items-center gap-2 px-8"
              >
                <FiCheck /> {grading ? 'Đang lưu...' : 'Gửi điểm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
