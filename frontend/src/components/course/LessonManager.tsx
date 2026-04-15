import { useState } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiChevronUp, FiChevronDown, FiVideo, FiFileText, FiCheckSquare } from 'react-icons/fi';
import { courseService, Lesson, CreateLessonData } from '../../services/course.service';
import toast from 'react-hot-toast';
import { QuizBuilder } from './QuizBuilder';
import { AssignmentBuilder } from './AssignmentBuilder';
import { FiUploadCloud } from 'react-icons/fi';
import axios from 'axios';

interface LessonManagerProps {
  courseId: string;
  initialLessons: Lesson[];
}

export const LessonManager = ({ courseId, initialLessons }: LessonManagerProps) => {
  const [lessons, setLessons] = useState<Lesson[]>(initialLessons);
  const [isAdding, setIsAdding] = useState(false);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeBuilderLessonId, setActiveBuilderLessonId] = useState<string | null>(null);
  const [builderType, setBuilderType] = useState<'QUIZ' | 'ASSIGNMENT'>('QUIZ');
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [formData, setFormData] = useState<CreateLessonData>({
    title: '',
    description: '',
    videoUrl: '',
    duration: 0,
    isPreview: false,
  });

  const handleResetForm = () => {
    setFormData({
      title: '',
      description: '',
      videoUrl: '',
      duration: 0,
      isPreview: false,
    });
    setIsAdding(false);
    setEditingLesson(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploadingFile(true);
      setUploadProgress(0);

      const { uploadUrl, fileUrl } = await courseService.getUploadUrl(courseId, file.name, file.type);

      await axios.put(uploadUrl, file, {
        headers: {
          'Content-Type': file.type,
        },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(percentCompleted);
          }
        },
      });

      setFormData((prev) => ({ ...prev, videoUrl: fileUrl }));
      toast.success('Upload tài nguyên thành công!');
    } catch (error) {
      console.error('File upload failed:', error);
      toast.error('Upload tài nguyên thất bại. Vui lòng thử lại.');
    } finally {
      setIsUploadingFile(false);
      setUploadProgress(0);
      // Reset input value so same file can be selected again
      e.target.value = '';
    }
  };

  const handleAddLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const newLesson = await courseService.createLesson(courseId, {
        ...formData,
        order: lessons.length + 1,
      });
      setLessons([...lessons, newLesson]);
      toast.success('Thêm bài học thành công');
      handleResetForm();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Thêm bài học thất bại');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLesson) return;
    setLoading(true);
    try {
      const updated = await courseService.updateLesson(courseId, editingLesson.id, formData);
      setLessons(lessons.map((l) => (l.id === updated.id ? updated : l)));
      toast.success('Cập nhật bài học thành công');
      handleResetForm();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Cập nhật bài học thất bại');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLesson = async (lessonId: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa bài học này?')) return;
    try {
      await courseService.deleteLesson(courseId, lessonId);
      setLessons(lessons.filter((l) => l.id !== lessonId));
      toast.success('Xóa bài học thành công');
    } catch (error) {
      toast.error('Xóa bài học thất bại');
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const newLessons = [...lessons];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= lessons.length) return;

    [newLessons[index], newLessons[targetIndex]] = [newLessons[targetIndex], newLessons[index]];
    
    // Update orders
    const lessonOrders = newLessons.map((l, i) => ({ id: l.id, order: i + 1 }));
    
    try {
      await courseService.reorderLessons(courseId, lessonOrders);
      setLessons(newLessons);
    } catch (error) {
      toast.error('Sắp xếp lại bài học thất bại');
    }
  };

  const startEdit = (lesson: Lesson) => {
    setEditingLesson(lesson);
    setFormData({
      title: lesson.title,
      description: lesson.description || '',
      videoUrl: lesson.videoUrl,
      duration: lesson.duration,
      isPreview: lesson.isPreview,
    });
    setIsAdding(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900">Bài học trong Khóa học</h2>
        {!isAdding && !editingLesson && (
          <button
            onClick={() => setIsAdding(true)}
            className="btn-primary flex items-center space-x-2"
          >
            <FiPlus />
            <span>Thêm Bài học</span>
          </button>
        )}
      </div>

      {(isAdding || editingLesson) && (
        <form onSubmit={editingLesson ? handleUpdateLesson : handleAddLesson} className="card bg-gray-50 border-2 border-primary-100 p-4 space-y-4">
          <h3 className="font-medium text-lg">
            {editingLesson ? 'Sửa Bài học' : 'Thêm Bài học mới'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Tiêu đề *</label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="input-field"
                placeholder="Tiêu đề Bài học"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="input-field"
                rows={2}
                placeholder="Mô tả Bài học"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Upload Tài nguyên (Video/PDF) *</label>
              
              <div className="flex gap-2">
                <input
                  type="url"
                  value={formData.videoUrl}
                  onChange={(e) => setFormData({ ...formData, videoUrl: e.target.value })}
                  className="input-field flex-1"
                  placeholder="https://..."
                />
                
                <div className="relative flex-shrink-0">
                  <input
                    type="file"
                    onChange={handleFileUpload}
                    disabled={isUploadingFile}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                    accept="video/*,application/pdf"
                  />
                  <button
                    type="button"
                    disabled={isUploadingFile}
                    className="h-full px-4 flex items-center gap-2 bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-700 font-medium rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                  >
                    <FiUploadCloud /> {isUploadingFile ? 'Đang tải lên...' : 'Tải file lên'}
                  </button>
                </div>
              </div>
              
              {isUploadingFile && (
                <div className="mt-2 w-full bg-gray-200 rounded-full h-2.5">
                  <div className="bg-primary-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                </div>
              )}
              {formData.videoUrl && !isUploadingFile && (
                <p className="mt-1 text-sm text-green-600 font-medium">✓ Đã có tài nguyên: {formData.videoUrl.split('/').pop()}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Thời lượng (giây) *</label>
              <input
                type="number"
                required
                min="0"
                value={formData.duration}
                onChange={(e) => setFormData({ ...formData, duration: parseInt(e.target.value) })}
                className="input-field"
              />
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="isPreview"
                checked={formData.isPreview}
                onChange={(e) => setFormData({ ...formData, isPreview: e.target.checked })}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="isPreview" className="text-sm font-medium text-gray-700">
                Cho phép học thử (Miễn phí)
              </label>
            </div>
          </div>
          <div className="flex justify-end space-x-3 mt-4">
            <button
              type="button"
              onClick={handleResetForm}
              className="btn-secondary"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
            >
              {loading ? 'Đang lưu...' : (editingLesson ? 'Cập nhật Bài học' : 'Thêm Bài học')}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {lessons.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
            <p className="text-gray-500">Chưa có bài học nào.</p>
          </div>
        ) : (
          lessons.map((lesson, index) => (
            <div key={lesson.id} className="flex flex-col border border-gray-200 rounded-lg shadow-sm bg-white overflow-hidden mb-3">
              <div className="flex items-center justify-between p-4 hover:border-primary-300 transition-colors">
                <div className="flex items-center space-x-4">
                  <div className="flex flex-col text-gray-400">
                    <button
                      onClick={() => handleMove(index, 'up')}
                      disabled={index === 0}
                      className="hover:text-primary-600 disabled:opacity-30"
                    >
                      <FiChevronUp size={20} />
                    </button>
                    <button
                      onClick={() => handleMove(index, 'down')}
                      disabled={index === lessons.length - 1}
                      className="hover:text-primary-600 disabled:opacity-30"
                    >
                      <FiChevronDown size={20} />
                    </button>
                  </div>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    lesson.title.toLowerCase().includes('quiz') || lesson.videoUrl.includes('QUIZ') ? 'bg-purple-100 text-purple-600' :
                    lesson.title.toLowerCase().includes('assignment') || lesson.videoUrl.includes('ASSIGNMENT') ? 'bg-amber-100 text-amber-600' :
                    'bg-primary-100 text-primary-600'
                  }`}>
                    {lesson.title.toLowerCase().includes('quiz') || lesson.videoUrl.includes('QUIZ') ? <FiCheckSquare /> :
                     lesson.title.toLowerCase().includes('assignment') || lesson.videoUrl.includes('ASSIGNMENT') ? <FiFileText /> :
                     <FiVideo />}
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">{lesson.title}</h4>
                    <div className="flex items-center space-x-3 text-xs text-gray-500">
                      <span>{Math.floor(lesson.duration / 60)}p {lesson.duration % 60}s</span>
                      {lesson.isPreview && (
                        <span className="text-green-600 font-medium">Học thử miễn phí</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => { setActiveBuilderLessonId(lesson.id); setBuilderType('QUIZ'); }}
                    className="flex items-center gap-1 p-2 text-purple-600 hover:bg-purple-50 rounded text-xs font-medium border border-purple-100"
                    title="Quản lý Trắc nghiệm"
                  >
                    <FiCheckSquare size={14} /> Thêm Trắc nghiệm
                  </button>
                  <button
                    onClick={() => { setActiveBuilderLessonId(lesson.id); setBuilderType('ASSIGNMENT'); }}
                    className="flex items-center gap-1 p-2 text-amber-600 hover:bg-amber-50 rounded text-xs font-medium border border-amber-100 mr-2"
                    title="Quản lý Bài tập"
                  >
                    <FiFileText size={14} /> Thêm Bài tập
                  </button>
                  <div className="w-px h-6 bg-gray-300 mx-1"></div>
                  <button
                    onClick={() => startEdit(lesson)}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded-full"
                    title="Edit"
                  >
                    <FiEdit2 size={18} />
                  </button>
                  <button
                    onClick={() => handleDeleteLesson(lesson.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-full"
                    title="Delete"
                  >
                    <FiTrash2 size={18} />
                  </button>
                </div>
              </div>

              {activeBuilderLessonId === lesson.id && (
                <div className="border-t bg-gray-50 p-4">
                  {builderType === 'QUIZ' ? (
                    <QuizBuilder courseId={courseId} lessonId={lesson.id} onClose={() => setActiveBuilderLessonId(null)} />
                  ) : (
                    <AssignmentBuilder courseId={courseId} lessonId={lesson.id} onClose={() => setActiveBuilderLessonId(null)} />
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
