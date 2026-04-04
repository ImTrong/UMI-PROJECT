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
      toast.error('Failed to load submissions');
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
      toast.success(status === 'GRADED' ? 'Grade submitted successfully' : 'Submission returned to student');
      setSelectedSubmission(null);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to submit grade');
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
        <button onClick={() => navigate(-1)} className="p-2 bg-white border rounded-lg hover:bg-gray-50">
          <FiChevronLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Student Submissions</h1>
          <p className="text-gray-500 text-sm">Review, grade, and provide feedback</p>
        </div>
      </div>

      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Student</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Score</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {submissions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    No submissions found for this assignment yet.
                  </td>
                </tr>
              ) : (
                submissions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{sub.userId}</div>
                      <div className="text-sm text-gray-500">ID: {sub.id.substring(0, 8)}...</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        sub.status === 'GRADED' ? 'bg-green-100 text-green-800' :
                        sub.status === 'SUBMITTED' ? 'bg-blue-100 text-blue-800' :
                        sub.status === 'LATE_SUBMISSION' ? 'bg-amber-100 text-amber-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {sub.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {sub.submittedAt ? new Date(sub.submittedAt).toLocaleString() : 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      {sub.score !== undefined ? sub.score : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => openGradingModal(sub)}
                        className="text-primary-600 hover:text-primary-900"
                        disabled={sub.status === 'DRAFT'}
                      >
                        {sub.status === 'GRADED' ? 'Edit Grade' : 'Grade'}
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
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="p-6 border-b flex justify-between items-center">
              <h3 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary-600 to-purple-600">
                Grade Submission
              </h3>
              <button onClick={() => setSelectedSubmission(null)} className="text-gray-400 hover:text-gray-600">
                <FiX size={24} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <div className="mb-6 grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg">
                <div>
                  <p className="text-sm text-gray-500 mb-1">Student ID</p>
                  <p className="font-medium">{selectedSubmission.userId}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-1">Submitted at</p>
                  <p className="font-medium">{selectedSubmission.submittedAt ? new Date(selectedSubmission.submittedAt).toLocaleString() : 'N/A'}</p>
                </div>
              </div>

              <div className="mb-6">
                <h4 className="font-semibold text-gray-800 mb-3 text-sm uppercase tracking-wider">Student's Work</h4>
                
                {selectedSubmission.submissionText && (
                  <div className="mb-4 bg-white border border-gray-200 rounded-lg p-4 prose max-w-none text-sm text-gray-700">
                    <p className="whitespace-pre-wrap">{selectedSubmission.submissionText}</p>
                  </div>
                )}

                {selectedSubmission.fileUrls && selectedSubmission.fileUrls.length > 0 && (
                  <div className="space-y-2">
                    {selectedSubmission.fileUrls.map((url, i) => (
                      <a href={url} target="_blank" rel="noreferrer" key={i} className="flex items-center justify-between p-3 bg-primary-50 rounded-lg text-primary-700 hover:bg-primary-100 transition">
                        <div className="flex items-center gap-3">
                          <FiFile />
                          <span className="font-medium text-sm">{url.split('/').pop() || `Attachment ${i + 1}`}</span>
                        </div>
                        <FiDownload size={18} />
                      </a>
                    ))}
                  </div>
                )}
                
                {!selectedSubmission.submissionText && (!selectedSubmission.fileUrls || selectedSubmission.fileUrls.length === 0) && (
                  <p className="text-gray-500 italic text-sm p-4 bg-gray-50 rounded text-center">Empty submission.</p>
                )}
              </div>

              <hr className="my-6" />

              <h4 className="font-semibold text-gray-800 mb-4 text-sm uppercase tracking-wider">Grading</h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Score (Points)</label>
                  <input
                    type="number"
                    min="0"
                    value={score}
                    onChange={(e) => setScore(Number(e.target.value))}
                    className="input-field max-w-[150px] font-bold text-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Instructor Feedback</label>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    className="input-field min-h-[120px]"
                    placeholder="Provide constructive feedback for the student..."
                  />
                </div>
              </div>
            </div>

            <div className="p-6 border-t bg-gray-50 flex justify-end gap-3 rounded-b-xl">
              <button
                onClick={() => submitGrade('RETURNED')}
                disabled={grading}
                className="btn-secondary"
              >
                Return to Student
              </button>
              <button
                onClick={() => submitGrade('GRADED')}
                disabled={grading}
                className="btn-primary flex items-center gap-2 px-8"
              >
                <FiCheck /> {grading ? 'Saving...' : 'Submit Grade'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
