import { useState, useEffect, useRef } from 'react';
import { learningService, Assignment, AssignmentSubmission } from '../../services/learning.service';
import { FiUploadCloud, FiFileText, FiClock, FiCheckCircle, FiInfo, FiTrash2, FiFile } from 'react-icons/fi';
import axios from 'axios';

export const AssignmentPlayer = ({
  lessonId,
  courseId,
  onComplete,
}: {
  lessonId: string;
  courseId: string;
  onComplete: () => void;
}) => {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [submission, setSubmission] = useState<AssignmentSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  // Form State
  const [submissionText, setSubmissionText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
  }, [lessonId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const a = await learningService.getAssignmentByLesson(lessonId);
      setAssignment(a);
      
      try {
        const sub = await learningService.getMyAssignmentSubmission(a.id);
        setSubmission(sub);
        if (sub.status !== 'GRADED') {
          setSubmissionText(sub.content || '');
        }
      } catch (err: any) {
        // 404 means no submission yet
      }
    } catch (err: any) {
      if (err.response?.status !== 404) {
        setError('Không thể tải dữ liệu bài tập.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Drag and Drop Handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesSelected(Array.from(e.target.files));
    }
  };

  const handleFilesSelected = (newFiles: File[]) => {
    // Optional: filter by allowedFileTypes if strict client-side validation is desired
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!assignment) return;
    setSubmitting(true);
    setError('');
    
    try {
      let uploadedFileUrl = submission?.fileUrl;
      let uploadedFileName = submission?.fileName;

      if (files.length > 0) {
        const file = files[0];
        const { uploadUrl, fileUrl } = await learningService.getUploadUrl(assignment.id, file.name, file.type);
        await axios.put(uploadUrl, file, {
          headers: { 'Content-Type': file.type },
        });
        uploadedFileUrl = fileUrl;
        uploadedFileName = file.name;
      }

      const res = await learningService.submitAssignment(assignment.id, {
        courseId,
        content: submissionText,
        fileUrl: uploadedFileUrl,
        fileName: uploadedFileName,
      });

      setSubmission(res);
      setFiles([]); // Clear local files after upload
      onComplete();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Không thể nộp bài tập. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !assignment) return <div className="p-8 text-center"><div className="animate-spin h-8 w-8 mx-auto border-b-2 border-primary-600 rounded-full"></div></div>;
  if (!assignment) return <div className="p-8 text-center text-slate-500">Không tìm thấy bài tập nào cho bài học này.</div>;

  const isGraded = submission?.status === 'GRADED';
  const isSubmitted = submission?.status === 'SUBMITTED' || submission?.status === 'GRADING';
  const isReadOnly = isGraded || isSubmitted;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <div className="card mb-6 border-t-4 border-primary-500">
        <h2 className="text-2xl font-bold mb-2">{assignment.title}</h2>
        <div className="flex flex-wrap gap-4 text-sm text-slate-600 mb-6">
          {assignment.dueDate && (
            <div className="flex items-center gap-1">
              <FiClock className="text-amber-500" />
              <span>Hạn cuối: {new Date(assignment.dueDate).toLocaleDateString()}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <FiCheckCircle className="text-green-500" />
            <span>Điểm tối đa: {assignment.maxScore}</span>
          </div>
        </div>
        
        <div className="prose max-w-none text-slate-700 bg-slate-50 p-4 rounded-xl">
          <p className="whitespace-pre-wrap">{assignment.description}</p>
        </div>

        {assignment.instructions && (
          <div className="mt-4 bg-cyan-50 p-4 rounded-xl border border-cyan-100">
            <p className="text-sm font-semibold text-cyan-800 mb-1 flex items-center gap-1"><FiFileText /> Hướng dẫn chi tiết:</p>
            <p className="text-sm text-cyan-700 whitespace-pre-wrap">{assignment.instructions}</p>
          </div>
        )}
      </div>

      {/* Submission Status Banner */}
      {submission && (
        <div className={`mb-6 p-4 rounded-xl flex items-start gap-4 ${
          isGraded ? 'bg-green-50 border border-green-200' :
          isSubmitted ? 'bg-cyan-50 border border-cyan-200' :
          submission.status === 'RETURNED' ? 'bg-red-50 border border-red-200' : 'bg-slate-50 border border-slate-100'
        }`}>
          <div className={`mt-1 ${isGraded ? 'text-green-600' : isSubmitted ? 'text-cyan-600' : 'text-slate-600'}`}>
            <FiInfo size={24} />
          </div>
          <div className="flex-1">
            <h3 className={`font-bold ${isGraded ? 'text-green-800' : isSubmitted ? 'text-cyan-800' : 'text-slate-800'}`}>
              Trạng thái: {submission.status}
            </h3>
            {isGraded && (
              <div className="mt-2 text-sm text-slate-700">
                <p><span className="font-semibold">Điểm số:</span> <span className="text-lg font-bold text-green-700">{submission.score}</span> / {assignment.maxScore}</p>
                {submission.feedback && (
                  <div className="mt-2 bg-white p-3 rounded border border-green-100">
                    <p className="font-semibold text-xs text-slate-500 uppercase tracking-wide">Nhận xét của giảng viên:</p>
                    <p className="mt-1">{submission.feedback}</p>
                  </div>
                )}
              </div>
            )}
            {submission.status === 'RETURNED' && submission.feedback && (
              <div className="mt-2 text-sm text-red-700 bg-white p-3 rounded border border-red-100">
                <span className="font-semibold">Nhận xét:</span> {submission.feedback}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Submission Form */}
      <div className="card shadow-sm">
        <h3 className="text-xl font-bold mb-4 border-b pb-4">Nội dung nộp bài</h3>
        
        {error && <div className="p-3 mb-6 bg-red-50 text-red-700 rounded-lg text-sm border border-red-100">{error}</div>}

        <div className="space-y-6">
          {/* Text Area */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Văn bản bài nộp (Tùy chọn)</label>
            <textarea
              className="input-field min-h-[150px]"
              disabled={isReadOnly}
              value={submissionText}
              onChange={e => setSubmissionText(e.target.value)}
              placeholder="Viết câu trả lời hoặc thêm ghi chú về các tệp đính kèm của bạn ở đây..."
            />
          </div>

          {/* Existing Files */}
          {submission?.fileUrl && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Các tệp đã tải lên trước đó</label>
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                  <FiFile className="text-slate-400" size={20} />
                  <a href={submission.fileUrl} target="_blank" rel="noreferrer" className="flex-1 text-primary-600 hover:underline truncate">
                    {submission.fileName || submission.fileUrl.split('/').pop()}
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Modern Drag and Drop Zone */}
          {!isReadOnly && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Tệp đính kèm</label>
              
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ease-in-out cursor-pointer flex flex-col items-center justify-center min-h-[200px]
                  ${isDragging 
                    ? 'border-primary-500 bg-primary-50 shadow-inner scale-[0.99] ring-4 ring-primary-500/20' 
                    : 'border-slate-200 hover:border-primary-400 hover:bg-slate-50'
                  }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className={`p-4 rounded-full mb-4 transition-colors ${isDragging ? 'bg-primary-100 text-primary-600' : 'bg-slate-100 text-slate-500'}`}>
                  <FiUploadCloud size={40} className={isDragging ? 'animate-bounce' : ''} />
                </div>
                <h4 className="text-lg font-semibold text-slate-700 mb-1">
                  Nhấn để tải lên hoặc kéo & thả tệp
                </h4>
                <p className="text-sm text-slate-500 mb-4 px-8">
                  Hỗ trợ tải lên 1 tệp cho mỗi lần nộp bài. Nghiêm cấm tải lên nội dung độc hại hoặc tệp không được phép.
                </p>
                
                {assignment.allowedFileTypes.length > 0 && (
                  <div className="flex gap-2 flex-wrap justify-center mt-2">
                    {assignment.allowedFileTypes.map((type, i) => (
                      <span key={i} className="text-xs font-medium px-2.5 py-1 bg-slate-200 text-slate-600 rounded-full">
                        {type.toUpperCase()}
                      </span>
                    ))}
                  </div>
                )}
                
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileInput}
                  className="hidden"
                  accept={assignment.allowedFileTypes.length > 0 
                    ? assignment.allowedFileTypes.map(t => t.startsWith('.') ? t : `.${t}`).join(',') 
                    : undefined}
                />
              </div>

              {/* Staged Files List */}
              {files.length > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-medium text-slate-700 mb-3 flex items-center justify-between">
                    <span>Tệp chuẩn bị tải lên ({files.length})</span>
                    <button onClick={() => setFiles([])} className="text-xs text-red-500 hover:text-red-700 hover:underline">Xóa tất cả</button>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {files.map((file, index) => (
                      <div key={index} className="flex items-center p-3 bg-white border border-slate-100 shadow-sm rounded-xl group hover:border-primary-300 transition-colors">
                        <div className="w-10 h-10 rounded bg-primary-50 flex items-center justify-center text-primary-500 mr-3 flex-shrink-0">
                          <FiFile size={20} />
                        </div>
                        <div className="flex-1 min-w-0 pr-2">
                          <p className="text-sm font-medium text-slate-900 truncate">{file.name}</p>
                          <p className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeFile(index); }}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl opacity-0 group-hover:opacity-100 transition-all"
                          title="Xóa tệp"
                        >
                          <FiTrash2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          {!isReadOnly && (
            <div className="flex justify-end gap-4 pt-6 mt-8 border-t">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || (!submissionText.trim() && files.length === 0 && !submission?.fileUrl)}
                className="btn-primary px-8 shadow-sm shadow-primary-500/30 disabled:opacity-50 disabled:shadow-none"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Đang nộp bài...
                  </span>
                ) : (
                  'Nộp bài tập'
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
