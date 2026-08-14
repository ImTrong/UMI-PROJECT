import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminPathService, AdminLearningPath, SubmissionFieldType, CertificateConfig } from '../../services/admin-path.service';
import { courseApi } from '../../services/api';
import { courseService } from '../../services/course.service';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiSave, FiPlus, FiTrash2, FiArrowUp, FiArrowDown, FiUploadCloud, FiAward } from 'react-icons/fi';

export default function AdminLearningPathForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = !!id;

  const [activeTab, setActiveTab] = useState('basic');
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  
  const [formData, setFormData] = useState<Partial<AdminLearningPath>>({
    title: '',
    slug: '',
    description: '',
    shortDescription: '',
    category: '',
    difficulty: 'ALL',
    imageUrl: '',
    bannerUrl: '',
    careerGoal: '',
    skills: [],
    courseIds: [],
    prerequisiteRules: [],
    completionRule: 'ALL_COURSES',
    recommended: false,
    status: 'DRAFT',
    certificateConfig: {
      title: '',
      subtitle: '',
      description: '',
      signerName: '',
      signerTitle: '',
      organizationName: '',
      validityYears: 5,
      skills: [],
    },
  });

  const [certSkillInput, setCertSkillInput] = useState('');

  const handleCertConfigChange = (field: keyof CertificateConfig, value: any) => {
    setFormData(prev => ({
      ...prev,
      certificateConfig: {
        ...(prev.certificateConfig || {}),
        [field]: value,
      },
    }));
  };

  const handleAddCertSkill = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && certSkillInput.trim()) {
      e.preventDefault();
      const currentSkills = formData.certificateConfig?.skills || [];
      if (!currentSkills.includes(certSkillInput.trim())) {
        handleCertConfigChange('skills', [...currentSkills, certSkillInput.trim()]);
      }
      setCertSkillInput('');
    }
  };

  const handleRemoveCertSkill = (skill: string) => {
    const currentSkills = formData.certificateConfig?.skills || [];
    handleCertConfigChange('skills', currentSkills.filter(s => s !== skill));
  };

  const [availableCourses, setAvailableCourses] = useState<any[]>([]);
  const [searchCourse, setSearchCourse] = useState('');
  const [skillInput, setSkillInput] = useState('');
  
  const imageInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const [projectData, setProjectData] = useState<Partial<any> | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectSaving, setProjectSaving] = useState(false);

  useEffect(() => {
    loadCourses();
    if (isEdit && id) {
      loadPath(id);
      loadProject(id);
    }
  }, [id]);

  const loadProject = async (pathId: string) => {
    try {
      setProjectLoading(true);
      const project = await adminPathService.getFinalProject(pathId);
      if (project) {
        setProjectData(project);
      } else {
        setProjectData(null);
      }
    } catch {
      // It's okay if not found
    } finally {
      setProjectLoading(false);
    }
  };

  const handleSaveProject = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!id || !projectData) return;
    try {
      setProjectSaving(true);
      if (projectData.id) {
        await adminPathService.updateFinalProject(projectData.id, projectData);
        toast.success('Cập nhật project thành công');
      } else {
        const newProject = await adminPathService.createFinalProject(id, projectData);
        setProjectData(newProject);
        toast.success('Tạo project thành công');
      }
    } catch {
      toast.error('Lưu project thất bại');
    } finally {
      setProjectSaving(false);
    }
  };

  const handleAddEvaluationStage = () => {
    const newStage = {
      stageNumber: (projectData?.evaluationPipeline?.length || 0) + 1,
      title: '',
      objective: '',
      criteria: '',
      maxScore: 20,
      weight: 0.2,
      passCriteria: 'Đạt ≥ 70%',
    };
    setProjectData((prev: any) => ({
      ...prev,
      evaluationPipeline: [...(prev?.evaluationPipeline || []), newStage],
    }));
  };

  const handleUpdateEvaluationStage = (index: number, field: string, value: any) => {
    setProjectData((prev: any) => {
      const newPipeline = [...(prev.evaluationPipeline || [])];
      newPipeline[index] = { ...newPipeline[index], [field]: value };
      return { ...prev, evaluationPipeline: newPipeline };
    });
  };

  const handleRemoveEvaluationStage = (index: number) => {
    setProjectData((prev: any) => {
      const newPipeline = [...(prev.evaluationPipeline || [])];
      newPipeline.splice(index, 1);
      newPipeline.forEach((stage, idx) => {
        stage.stageNumber = idx + 1;
      });
      return { ...prev, evaluationPipeline: newPipeline };
    });
  };

  // ========== Submission Types Handlers ==========
  const SUBMISSION_TYPE_OPTIONS: { value: SubmissionFieldType; label: string; icon: string; defaultAccept?: string; defaultPlaceholder?: string }[] = [
    { value: 'FILE', label: 'Tệp tin (PDF, Word, ZIP...)', icon: '📎', defaultAccept: '.pdf,.doc,.docx,.zip,.rar' },
    { value: 'IMAGE', label: 'Hình ảnh', icon: '🖼️', defaultAccept: '.png,.jpg,.jpeg,.gif,.webp' },
    { value: 'VIDEO', label: 'Video', icon: '🎬', defaultAccept: '.mp4,.mov,.avi,.webm' },
    { value: 'AUDIO', label: 'Âm thanh', icon: '🎵', defaultAccept: '.mp3,.wav,.ogg,.m4a' },
    { value: 'GITHUB_LINK', label: 'Link GitHub', icon: '💻', defaultPlaceholder: 'https://github.com/...' },
    { value: 'DEMO_LINK', label: 'Link Demo', icon: '🔗', defaultPlaceholder: 'https://...' },
    { value: 'FIGMA_LINK', label: 'Link Figma', icon: '🎨', defaultPlaceholder: 'https://figma.com/...' },
    { value: 'TEXT', label: 'Văn bản', icon: '📝', defaultPlaceholder: 'Nhập nội dung...' },
    { value: 'CUSTOM', label: 'Loại khác (Custom)', icon: '📌', defaultPlaceholder: '' },
  ];

  const handleAddSubmissionType = (type: SubmissionFieldType) => {
    const option = SUBMISSION_TYPE_OPTIONS.find(o => o.value === type);
    if (!option) return;
    const newItem = {
      type,
      label: option.label,
      required: true,
      accept: option.defaultAccept || '',
      placeholder: option.defaultPlaceholder || '',
      maxSizeMB: 50,
    };
    setProjectData((prev: any) => ({
      ...prev,
      submissionTypes: [...(prev?.submissionTypes || []), newItem],
    }));
  };

  const handleUpdateSubmissionType = (index: number, field: string, value: any) => {
    setProjectData((prev: any) => {
      const arr = [...(prev.submissionTypes || [])];
      arr[index] = { ...arr[index], [field]: value };
      return { ...prev, submissionTypes: arr };
    });
  };

  const handleRemoveSubmissionType = (index: number) => {
    setProjectData((prev: any) => {
      const arr = [...(prev.submissionTypes || [])];
      arr.splice(index, 1);
      return { ...prev, submissionTypes: arr };
    });
  };

  const loadCourses = async () => {
    try {
      const response = await courseApi.get('/api/courses?limit=100'); 
      setAvailableCourses(response.data.data || response.data.courses || []);
    } catch {
      toast.error('Không thể tải danh sách khóa học');
    }
  };

  const loadPath = async (pathId: string) => {
    try {
      setLoading(true);
      const data = await adminPathService.getPathById(pathId);
      setFormData({
        ...data,
        prerequisiteRules: data.prerequisiteRules || [],
      });
    } catch {
      toast.error('Tải lộ trình học tập thất bại');
      navigate('/admin/learning-paths');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      setSaving(true);
      const payload: any = { ...formData };
      
      // Ensure pending skill input is saved
      if (skillInput.trim() && !payload.skills?.includes(skillInput.trim())) {
        payload.skills = [...(payload.skills || []), skillInput.trim()];
        setSkillInput('');
      }

      delete payload.id;
      delete payload.createdAt;
      delete payload.updatedAt;
      delete payload.createdBy;
      delete payload.enrollmentCount;
      delete payload.totalDurationMinutes;

      if (isEdit && id) {
        await adminPathService.updatePath(id, payload);
        toast.success('Cập nhật lộ trình thành công');
      } else {
        const newPath = await adminPathService.createPath(payload);
        toast.success('Tạo lộ trình mới thành công');
        navigate(`/admin/learning-paths/${newPath.id}/edit`);
      }
    } catch {
      toast.error('Lưu lộ trình thất bại');
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, field: 'imageUrl' | 'bannerUrl') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Kích thước ảnh phải nhỏ hơn 5MB');
      e.target.value = '';
      return;
    }

    const isImage = field === 'imageUrl';
    const setUploading = isImage ? setUploadingImage : setUploadingBanner;
    
    setUploading(true);
    try {
      const { uploadUrl, fileUrl } = await courseService.getUploadUrl('learning-path-assets', file.name, file.type);
      
      await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type
        }
      });

      setFormData(prev => ({ ...prev, [field]: fileUrl }));
      toast.success('Tải ảnh lên thành công');
    } catch (error) {
      toast.error('Lỗi khi tải ảnh lên MinIO');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // Basic Info Handlers
  const handleAddSkill = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && skillInput.trim()) {
      e.preventDefault();
      if (!formData.skills?.includes(skillInput.trim())) {
        setFormData((prev: Partial<AdminLearningPath>) => ({ ...prev, skills: [...(prev.skills || []), skillInput.trim()] }));
      }
      setSkillInput('');
    }
  };

  const handleRemoveSkill = (skill: string) => {
    setFormData((prev: Partial<AdminLearningPath>) => ({ ...prev, skills: prev.skills?.filter((s: string) => s !== skill) }));
  };

  // Course Selection Handlers
  const handleAddCourse = (courseId: string) => {
    if (!formData.courseIds?.includes(courseId)) {
      setFormData((prev: Partial<AdminLearningPath>) => ({ ...prev, courseIds: [...(prev.courseIds || []), courseId] }));
    }
  };

  const handleRemoveCourse = (courseId: string) => {
    setFormData((prev: Partial<AdminLearningPath>) => ({
      ...prev,
      courseIds: prev.courseIds?.filter((id: string) => id !== courseId),
      prerequisiteRules: (prev.prerequisiteRules || []).filter((rule: any) => rule.courseId !== courseId).map((rule: any) => ({
        ...rule,
        requiredCourseIds: rule.requiredCourseIds.filter((id: string) => id !== courseId)
      }))
    }));
  };

  const moveCourse = (index: number, direction: 'up' | 'down') => {
    const newCourseIds = [...(formData.courseIds || [])];
    if (direction === 'up' && index > 0) {
      [newCourseIds[index - 1], newCourseIds[index]] = [newCourseIds[index], newCourseIds[index - 1]];
    } else if (direction === 'down' && index < newCourseIds.length - 1) {
      [newCourseIds[index + 1], newCourseIds[index]] = [newCourseIds[index], newCourseIds[index + 1]];
    }
    setFormData((prev: Partial<AdminLearningPath>) => ({ ...prev, courseIds: newCourseIds }));
  };

  // Prerequisite Handlers
  const handleTogglePrerequisite = (courseId: string, requiredCourseId: string) => {
    const rules = [...(formData.prerequisiteRules || [])];
    const ruleIndex = rules.findIndex((r: any) => r.courseId === courseId);
    
    if (ruleIndex >= 0) {
      const requiredIds = rules[ruleIndex].requiredCourseIds;
      if (requiredIds.includes(requiredCourseId)) {
        rules[ruleIndex].requiredCourseIds = requiredIds.filter((id: string) => id !== requiredCourseId);
      } else {
        rules[ruleIndex].requiredCourseIds.push(requiredCourseId);
      }
    } else {
      rules.push({ courseId, requiredCourseIds: [requiredCourseId] });
    }
    
    setFormData((prev: Partial<AdminLearningPath>) => ({ ...prev, prerequisiteRules: rules }));
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Đang tải dữ liệu...</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 select-none font-sans bg-slate-50 min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/admin/learning-paths')} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <FiArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <h1 className="text-2xl font-bold text-slate-900">{isEdit ? 'Chỉnh sửa Lộ trình' : 'Tạo Lộ trình mới'}</h1>
        </div>
        <button
          onClick={() => {
            if (activeTab === 'final-project') {
              handleSaveProject();
            } else {
              handleSubmit();
            }
          }}
          disabled={saving || projectSaving}
          className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-6 py-2.5 rounded-lg font-bold transition-colors disabled:opacity-70"
        >
          <FiSave /> {(saving || projectSaving) ? 'Đang lưu...' : 'Lưu'}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-slate-200 overflow-x-auto">
          {['basic', 'courses', 'prerequisites', 'settings', 'certificate', 'final-project'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-4 font-semibold text-sm capitalize whitespace-nowrap outline-none transition-colors ${
                activeTab === tab ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50/50' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab === 'basic' ? 'Thông tin cơ bản' : tab === 'courses' ? 'Khóa học & Tiến trình' : tab === 'prerequisites' ? 'Điều kiện tiên quyết' : tab === 'settings' ? 'Cài đặt & Luật' : tab === 'certificate' ? '🏅 Chứng chỉ' : 'Dự án cuối kỳ'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6 md:p-8">
          
          {/* TAB 1: Basic Info */}
          {activeTab === 'basic' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Tên lộ trình *</label>
                  <input
                    type="text"
                    required
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 transition-shadow"
                    value={formData.title}
                    onChange={e => setFormData({ ...formData, title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Slug (Đường dẫn tĩnh)</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 bg-slate-50 transition-shadow"
                    value={formData.slug}
                    onChange={e => setFormData({ ...formData, slug: e.target.value })}
                    placeholder="Tự động tạo nếu để trống"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Mô tả ngắn</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 transition-shadow"
                  value={formData.shortDescription || ''}
                  onChange={e => setFormData({ ...formData, shortDescription: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Mô tả chi tiết</label>
                <textarea
                  rows={4}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 transition-shadow"
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Danh mục</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 transition-shadow"
                    value={formData.category || ''}
                    onChange={e => setFormData({ ...formData, category: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Độ khó</label>
                  <select
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 transition-shadow"
                    value={formData.difficulty}
                    onChange={e => setFormData({ ...formData, difficulty: e.target.value })}
                  >
                    <option value="ALL">Mọi cấp độ</option>
                    <option value="BEGINNER">Cơ bản</option>
                    <option value="INTERMEDIATE">Trung cấp</option>
                    <option value="ADVANCED">Nâng cao</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Mục tiêu nghề nghiệp</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 transition-shadow"
                    value={formData.careerGoal || ''}
                    onChange={e => setFormData({ ...formData, careerGoal: e.target.value })}
                    placeholder="VD: Frontend Developer"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Ảnh đại diện (Thumbnail)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 bg-slate-50 text-slate-500"
                      value={formData.imageUrl || ''}
                      readOnly
                      placeholder="URL sẽ hiện tại đây sau khi tải lên..."
                    />
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      ref={imageInputRef}
                      onChange={(e) => handleFileUpload(e, 'imageUrl')}
                    />
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={uploadingImage}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg font-medium hover:bg-blue-100 transition-colors disabled:opacity-50"
                    >
                      <FiUploadCloud /> {uploadingImage ? 'Đang tải...' : 'Tải ảnh lên'}
                    </button>
                  </div>
                  {formData.imageUrl && (
                    <img src={formData.imageUrl} alt="Preview" className="mt-2 h-24 rounded-lg object-cover border border-slate-200" />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Ảnh bìa (Banner)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 bg-slate-50 text-slate-500"
                      value={formData.bannerUrl || ''}
                      readOnly
                      placeholder="URL sẽ hiện tại đây sau khi tải lên..."
                    />
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      ref={bannerInputRef}
                      onChange={(e) => handleFileUpload(e, 'bannerUrl')}
                    />
                    <button
                      type="button"
                      onClick={() => bannerInputRef.current?.click()}
                      disabled={uploadingBanner}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg font-medium hover:bg-blue-100 transition-colors disabled:opacity-50"
                    >
                      <FiUploadCloud /> {uploadingBanner ? 'Đang tải...' : 'Tải ảnh bìa'}
                    </button>
                  </div>
                  {formData.bannerUrl && (
                    <img src={formData.bannerUrl} alt="Preview" className="mt-2 h-24 w-full rounded-lg object-cover border border-slate-200" />
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Kỹ năng đạt được</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {formData.skills?.map((skill: string) => (
                    <span key={skill} className="bg-primary-50 text-primary-700 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1 border border-primary-200">
                      {skill}
                      <button type="button" onClick={() => handleRemoveSkill(skill)} className="hover:text-red-500 transition-colors">&times;</button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 transition-shadow"
                  value={skillInput}
                  onChange={e => setSkillInput(e.target.value)}
                  onKeyDown={handleAddSkill}
                  placeholder="Gõ tên kỹ năng và nhấn Enter..."
                />
              </div>
            </div>
          )}

          {/* TAB 2: Courses & Timeline */}
          {activeTab === 'courses' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-fadeIn">
              {/* Selected Courses Timeline */}
              <div>
                <h3 className="font-bold text-slate-900 mb-4 border-b border-slate-200 pb-2">Trình tự Khóa học ({formData.courseIds?.length})</h3>
                
                {formData.courseIds?.length === 0 ? (
                  <div className="text-center p-8 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-slate-400">
                    Chưa có khóa học nào. Hãy tìm và chọn từ danh sách bên phải.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {formData.courseIds?.map((cId: string, index: number) => {
                      const course = availableCourses.find(c => c.id === cId) || { title: `Khóa học chưa rõ (${cId})`, id: cId };
                      return (
                        <div key={cId} className="flex items-center gap-3 bg-white border border-slate-200 p-3 rounded-xl shadow-sm hover:border-primary-300 transition-colors">
                          <div className="flex flex-col items-center justify-center bg-slate-100 text-slate-500 font-bold rounded-lg w-8 h-8 flex-shrink-0">
                            {index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm text-slate-900 truncate">{course.title}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => moveCourse(index, 'up')} disabled={index === 0} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded disabled:opacity-30 transition-colors">
                              <FiArrowUp />
                            </button>
                            <button type="button" onClick={() => moveCourse(index, 'down')} disabled={index === formData.courseIds!.length - 1} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded disabled:opacity-30 transition-colors">
                              <FiArrowDown />
                            </button>
                            <button type="button" onClick={() => handleRemoveCourse(cId)} className="p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 rounded ml-1 transition-colors">
                              <FiTrash2 />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Course Search */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h3 className="font-bold text-slate-900 mb-4">Khóa học hiện có</h3>
                <input
                  type="text"
                  placeholder="Tìm kiếm khóa học..."
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 mb-4 transition-shadow"
                  value={searchCourse}
                  onChange={e => setSearchCourse(e.target.value)}
                />
                
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                  {availableCourses
                    .filter(c => c.title?.toLowerCase().includes(searchCourse.toLowerCase()))
                    .filter(c => !formData.courseIds?.includes(c.id))
                    .map(course => (
                      <div key={course.id} className="flex items-center justify-between bg-white p-3 border border-slate-200 rounded-lg hover:border-primary-300 transition-colors">
                        <div>
                          <p className="font-bold text-sm text-slate-800 line-clamp-1">{course.title}</p>
                          <p className="text-xs text-slate-500">{course.category?.name || 'Không có danh mục'}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAddCourse(course.id)}
                          className="p-2 bg-primary-50 text-primary-600 rounded-lg hover:bg-primary-100 transition-colors"
                          title="Thêm vào lộ trình"
                        >
                          <FiPlus />
                        </button>
                      </div>
                  ))}
                  {availableCourses.length === 0 && (
                    <div className="text-center text-slate-400 py-4 text-sm">Không tìm thấy khóa học nào</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Prerequisites */}
          {activeTab === 'prerequisites' && (
            <div className="animate-fadeIn">
              <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl mb-6 text-sm text-amber-800">
                <strong>Điều kiện tiên quyết:</strong> Học viên phải hoàn thành các khóa học tiên quyết trước khi có thể mở khóa học tiếp theo trong lộ trình. Chỉ những khóa học nằm <strong>TRƯỚC</strong> trên trình tự mới có thể được chọn làm điều kiện tiên quyết.
              </div>

              {formData.courseIds?.length! < 2 ? (
                <div className="text-center p-8 text-slate-400">Vui lòng thêm ít nhất 2 khóa học vào trình tự để thiết lập điều kiện tiên quyết.</div>
              ) : (
                <div className="space-y-6">
                  {formData.courseIds?.map((cId: string, index: number) => {
                    if (index === 0) return null; // First course can't have prerequisites from this path
                    const course = availableCourses.find(c => c.id === cId) || { title: `Khóa học ${cId}` };
                    const priorCourseIds = formData.courseIds!.slice(0, index);
                    
                    const rule = (formData.prerequisiteRules || []).find((r: any) => r.courseId === cId);
                    const requiredCourseIds = rule ? rule.requiredCourseIds : [];

                    return (
                      <div key={cId} className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm hover:border-primary-200 transition-colors">
                        <h4 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-xs flex items-center justify-center">{index + 1}</span>
                          {course.title}
                        </h4>
                        
                        <div className="pl-8 space-y-2">
                          <p className="text-xs font-semibold text-slate-500 mb-2 uppercase">Yêu cầu hoàn thành trước:</p>
                          {priorCourseIds.map((priorId: string) => {
                            const priorCourse = availableCourses.find(c => c.id === priorId) || { title: `Khóa học ${priorId}` };
                            const isRequired = requiredCourseIds.includes(priorId);
                            
                            return (
                              <label key={priorId} className="flex items-center gap-3 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  className="w-4 h-4 text-primary-600 rounded border-slate-300 focus:ring-primary-500 cursor-pointer transition-shadow"
                                  checked={isRequired}
                                  onChange={() => handleTogglePrerequisite(cId, priorId)}
                                />
                                <span className={`text-sm transition-colors ${isRequired ? 'text-slate-900 font-bold' : 'text-slate-600 group-hover:text-slate-900'}`}>
                                  {priorCourse.title}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Settings & Rules */}
          {activeTab === 'settings' && (
            <div className="max-w-2xl space-y-8 animate-fadeIn">
              
              <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                <h3 className="font-bold text-slate-900 mb-4">Tiêu chí hoàn thành lộ trình</h3>
                <div className="space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="radio"
                      name="completionRule"
                      className="mt-1 text-primary-600"
                      checked={formData.completionRule === 'ALL_COURSES'}
                      onChange={() => setFormData({ ...formData, completionRule: 'ALL_COURSES' })}
                    />
                    <div>
                      <p className="font-bold text-sm text-slate-900 group-hover:text-primary-700 transition-colors">Hoàn thành 100% Khóa học</p>
                      <p className="text-xs text-slate-500">Học viên bắt buộc phải học xong toàn bộ các khóa trong lộ trình.</p>
                    </div>
                  </label>
                  
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="radio"
                      name="completionRule"
                      className="mt-1 text-primary-600"
                      checked={formData.completionRule?.startsWith('MIN_PERCENT')}
                      onChange={() => setFormData({ ...formData, completionRule: 'MIN_PERCENT:80' })}
                    />
                    <div>
                      <p className="font-bold text-sm text-slate-900 group-hover:text-primary-700 transition-colors">Hoàn thành theo tỷ lệ phần trăm</p>
                      <p className="text-xs text-slate-500">Học viên chỉ cần hoàn thành một tỷ lệ khóa học nhất định (VD: 80%).</p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                <h3 className="font-bold text-slate-900 mb-4">Đề xuất và Hiển thị</h3>
                
                <label className="flex items-center gap-3 cursor-pointer mb-4 group">
                  <input
                    type="checkbox"
                    className="w-5 h-5 text-primary-600 rounded border-slate-300 focus:ring-primary-500 transition-shadow"
                    checked={formData.recommended}
                    onChange={(e) => setFormData({ ...formData, recommended: e.target.checked })}
                  />
                  <div>
                    <p className="font-bold text-sm text-slate-900 group-hover:text-primary-700 transition-colors">Đánh dấu là "Lộ trình nổi bật"</p>
                    <p className="text-xs text-slate-500">Lộ trình này sẽ được ghim lên đầu hoặc làm nổi bật ở trang chủ.</p>
                  </div>
                </label>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-900 mb-4">Trạng thái phát hành</h3>
                <select
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 font-bold bg-slate-50 transition-shadow"
                  value={formData.status}
                  onChange={e => setFormData({ ...formData, status: e.target.value })}
                >
                  <option value="DRAFT">BẢN NHÁP (Chưa hiển thị cho học viên)</option>
                  <option value="PUBLISHED">ĐÃ XUẤT BẢN (Hiển thị công khai)</option>
                  <option value="ARCHIVED">LƯU TRỮ (Ẩn khỏi danh sách tìm kiếm)</option>
                </select>
              </div>

            </div>
          )}

          {/* TAB 5: Certificate Config */}
          {activeTab === 'certificate' && (
            <div className="max-w-3xl space-y-8 animate-fadeIn">
              <div className="flex items-center gap-3 mb-2">
                <FiAward className="w-6 h-6 text-amber-500" />
                <div>
                  <h3 className="font-bold text-lg text-slate-900">Cấu hình Chứng chỉ Lộ trình</h3>
                  <p className="text-sm text-slate-500">Tùy chỉnh thông tin hiển thị trên chứng chỉ khi học viên hoàn thành lộ trình. Nếu để trống, hệ thống sẽ dùng tên lộ trình làm mặc định.</p>
                </div>
              </div>

              <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-bold text-slate-700 mb-1">Tên chứng chỉ</label>
                    <input
                      type="text"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500 transition-shadow"
                      value={formData.certificateConfig?.title || ''}
                      onChange={e => handleCertConfigChange('title', e.target.value)}
                      placeholder={`Mặc định: ${formData.title || 'Tên lộ trình'}`}
                    />
                    <p className="text-xs text-slate-400 mt-1">Tên hiển thị chính trên chứng chỉ. Để trống để dùng tên lộ trình.</p>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-bold text-slate-700 mb-1">Phụ đề</label>
                    <input
                      type="text"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500 transition-shadow"
                      value={formData.certificateConfig?.subtitle || ''}
                      onChange={e => handleCertConfigChange('subtitle', e.target.value)}
                      placeholder="VD: Chương trình đào tạo chuyên sâu Frontend Developer"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-bold text-slate-700 mb-1">Mô tả chứng chỉ</label>
                    <textarea
                      rows={2}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500 transition-shadow"
                      value={formData.certificateConfig?.description || ''}
                      onChange={e => handleCertConfigChange('description', e.target.value)}
                      placeholder="Mô tả ngắn gọn về chứng chỉ (không bắt buộc)"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6 shadow-sm">
                <h4 className="font-bold text-slate-900 flex items-center gap-2">
                  <span className="text-lg">✍️</span> Thông tin Người ký & Tổ chức
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Tên người ký</label>
                    <input
                      type="text"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 transition-shadow"
                      value={formData.certificateConfig?.signerName || ''}
                      onChange={e => handleCertConfigChange('signerName', e.target.value)}
                      placeholder="VD: TS. Nguyễn Văn A"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Chức danh người ký</label>
                    <input
                      type="text"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 transition-shadow"
                      value={formData.certificateConfig?.signerTitle || ''}
                      onChange={e => handleCertConfigChange('signerTitle', e.target.value)}
                      placeholder="VD: Giám đốc đào tạo"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Tên tổ chức</label>
                    <input
                      type="text"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 transition-shadow"
                      value={formData.certificateConfig?.organizationName || ''}
                      onChange={e => handleCertConfigChange('organizationName', e.target.value)}
                      placeholder="VD: UMI Education"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">Thời hạn hiệu lực (năm)</label>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 transition-shadow"
                      value={formData.certificateConfig?.validityYears || 5}
                      onChange={e => handleCertConfigChange('validityYears', Number(e.target.value))}
                    />
                    <p className="text-xs text-slate-400 mt-1">Mặc định: 5 năm. Chứng chỉ sẽ hết hạn sau thời gian này.</p>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-sm">
                <h4 className="font-bold text-slate-900 flex items-center gap-2">
                  <span className="text-lg">🎯</span> Kỹ năng ghi nhận trên chứng chỉ
                </h4>
                <p className="text-sm text-slate-500">Danh sách kỹ năng sẽ hiển thị trên chứng chỉ khi hoàn thành. Riêng biệt với kỹ năng của lộ trình.</p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {(formData.certificateConfig?.skills || []).map((skill: string) => (
                    <span key={skill} className="bg-amber-50 text-amber-700 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1 border border-amber-200">
                      {skill}
                      <button type="button" onClick={() => handleRemoveCertSkill(skill)} className="hover:text-red-500 transition-colors">&times;</button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500 transition-shadow"
                  value={certSkillInput}
                  onChange={e => setCertSkillInput(e.target.value)}
                  onKeyDown={handleAddCertSkill}
                  placeholder="Gõ tên kỹ năng và nhấn Enter..."
                />
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                <h4 className="font-bold text-slate-700 mb-3">👁️ Xem trước thông tin chứng chỉ</h4>
                <div className="bg-white border border-slate-200 rounded-lg p-6 text-center space-y-2">
                  <p className="text-xs text-amber-600 font-bold tracking-widest">CHỨNG CHỈ HOÀN THÀNH LỘ TRÌNH</p>
                  <p className="text-2xl font-bold text-slate-900">CERTIFICATE OF ACHIEVEMENT</p>
                  {formData.certificateConfig?.subtitle && (
                    <p className="text-sm text-slate-500 italic">{formData.certificateConfig.subtitle}</p>
                  )}
                  <div className="w-24 h-0.5 bg-amber-400 mx-auto my-3" />
                  <p className="text-slate-500">Chứng nhận rằng</p>
                  <p className="text-xl font-bold text-amber-700">[Tên học viên]</p>
                  <p className="text-slate-500">đã hoàn thành xuất sắc lộ trình học tập</p>
                  <p className="text-lg font-bold text-slate-900">{formData.certificateConfig?.title || formData.title || '[Tên lộ trình]'}</p>
                  {formData.certificateConfig?.signerName && (
                    <div className="pt-4 border-t border-dashed border-slate-200 mt-4">
                      <div className="w-32 h-px bg-amber-400 mx-auto mb-1" />
                      <p className="font-bold text-sm text-slate-800">{formData.certificateConfig.signerName}</p>
                      {formData.certificateConfig.signerTitle && <p className="text-xs text-slate-500">{formData.certificateConfig.signerTitle}</p>}
                      {formData.certificateConfig.organizationName && <p className="text-xs text-slate-500">{formData.certificateConfig.organizationName}</p>}
                    </div>
                  )}
                  {(formData.certificateConfig?.skills || []).length > 0 && (
                    <p className="text-xs text-slate-400 pt-2">Kỹ năng: {formData.certificateConfig!.skills!.join(' • ')}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: Final Project */}
          {activeTab === 'final-project' && (
            <div className="space-y-8 animate-fadeIn">
              {!isEdit ? (
                <div className="text-center p-8 bg-amber-50 text-amber-800 rounded-xl border border-amber-200">
                  <FiAward className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <h3 className="font-bold text-lg mb-2">Lưu lộ trình trước</h3>
                  <p>Bạn cần phải lưu lộ trình học tập cơ bản trước khi cấu hình dự án cuối kỳ.</p>
                </div>
              ) : projectLoading ? (
                <div className="text-center p-8 text-slate-500">Đang tải dự án cuối kỳ...</div>
              ) : (
                <div className="bg-white rounded-xl">
                  {!projectData && (
                    <div className="mb-6 p-4 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-indigo-900">Chưa có dự án cuối kỳ</h4>
                        <p className="text-sm text-indigo-700">Lộ trình này hiện tại chưa được định cấu hình dự án cuối kỳ.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setProjectData({
                          title: 'Dự án cuối kỳ: ' + formData.title,
                          description: '',
                          maxScore: 100,
                          passingScore: 80,
                          maxAttempts: 3,
                          submissionTypes: [],
                          evaluationPipeline: []
                        })}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700"
                      >
                        Tạo dự án cuối kỳ
                      </button>
                    </div>
                  )}

                  {projectData && (
                    <div className="space-y-8">
                      {/* Basic Info */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-bold text-slate-700 mb-1">Tiêu đề dự án *</label>
                          <input
                            type="text"
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 font-medium"
                            value={projectData.title || ''}
                            onChange={e => setProjectData({ ...projectData, title: e.target.value })}
                            required
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-bold text-slate-700 mb-1">Mô tả & Hướng dẫn *</label>
                          <textarea
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 min-h-[100px]"
                            value={projectData.description || ''}
                            onChange={e => setProjectData({ ...projectData, description: e.target.value })}
                            required
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-bold text-slate-700 mb-1">Mục tiêu đầu ra (Objectives)</label>
                          <textarea
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 min-h-[80px]"
                            value={projectData.objectives || ''}
                            onChange={e => setProjectData({ ...projectData, objectives: e.target.value })}
                            placeholder="Nhập mục tiêu học viên cần đạt được..."
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Điểm tối đa</label>
                          <input
                            type="number"
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
                            value={projectData.maxScore || 100}
                            onChange={e => setProjectData({ ...projectData, maxScore: Number(e.target.value) })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Ngưỡng điểm đạt (%)</label>
                          <input
                            type="number"
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
                            value={projectData.passingScore || 80}
                            onChange={e => setProjectData({ ...projectData, passingScore: Number(e.target.value) })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Số lần nộp lại tối đa</label>
                          <input
                            type="number"
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
                            value={projectData.maxAttempts || 3}
                            onChange={e => setProjectData({ ...projectData, maxAttempts: Number(e.target.value) })}
                          />
                        </div>
                      </div>

                      {/* Submission Types Config */}
                      <div className="border-t border-slate-200 pt-8">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="font-bold text-lg text-slate-900">Cấu hình loại bài nộp</h3>
                            <p className="text-sm text-slate-500">Thiết lập các loại dữ liệu mà học viên cần nộp. Hỗ trợ nhiều lĩnh vực: lập trình, thiết kế, marketing, ngoại ngữ...</p>
                          </div>
                          <div className="relative group">
                            <button
                              type="button"
                              className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-4 py-2 rounded-lg font-bold text-sm transition-colors"
                            >
                              <FiPlus /> Thêm loại bài nộp
                            </button>
                            <div className="hidden group-hover:block absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 min-w-[280px]">
                              {SUBMISSION_TYPE_OPTIONS.map(opt => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => handleAddSubmissionType(opt.value)}
                                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left text-sm transition-colors"
                                >
                                  <span className="text-lg">{opt.icon}</span>
                                  <span>{opt.label}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {(!projectData.submissionTypes || projectData.submissionTypes.length === 0) ? (
                          <div className="text-center p-8 bg-slate-50 text-slate-500 rounded-lg border border-dashed border-slate-300">
                            Chưa cấu hình loại bài nộp. Mặc định học viên sẽ nộp bằng link và văn bản.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {projectData.submissionTypes.map((st: any, index: number) => {
                              const opt = SUBMISSION_TYPE_OPTIONS.find(o => o.value === st.type);
                              return (
                                <div key={index} className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-4 relative">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveSubmissionType(index)}
                                    className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                  >
                                    <FiTrash2 size={14} />
                                  </button>
                                  <div className="flex items-center gap-2 mb-3">
                                    <span className="text-lg">{opt?.icon || '📌'}</span>
                                    <span className="font-bold text-sm text-slate-700">{st.type}</span>
                                    {st.required && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold">Bắt buộc</span>}
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="md:col-span-2">
                                      <label className="block text-xs font-bold text-slate-600 mb-1">Tên hiển thị</label>
                                      <input
                                        type="text"
                                        className="w-full px-3 py-1.5 border border-slate-300 rounded outline-none focus:border-emerald-500 text-sm"
                                        value={st.label}
                                        onChange={e => handleUpdateSubmissionType(index, 'label', e.target.value)}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-bold text-slate-600 mb-1">Bắt buộc?</label>
                                      <select
                                        className="w-full px-3 py-1.5 border border-slate-300 rounded outline-none focus:border-emerald-500 text-sm"
                                        value={st.required ? 'true' : 'false'}
                                        onChange={e => handleUpdateSubmissionType(index, 'required', e.target.value === 'true')}
                                      >
                                        <option value="true">Có</option>
                                        <option value="false">Không</option>
                                      </select>
                                    </div>
                                    {['FILE', 'IMAGE', 'VIDEO', 'AUDIO'].includes(st.type) && (
                                      <>
                                        <div>
                                          <label className="block text-xs font-bold text-slate-600 mb-1">Định dạng chấp nhận</label>
                                          <input
                                            type="text"
                                            className="w-full px-3 py-1.5 border border-slate-300 rounded outline-none focus:border-emerald-500 text-sm"
                                            value={st.accept || ''}
                                            onChange={e => handleUpdateSubmissionType(index, 'accept', e.target.value)}
                                            placeholder=".pdf,.doc,.zip"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-xs font-bold text-slate-600 mb-1">Dung lượng tối đa (MB)</label>
                                          <input
                                            type="number"
                                            className="w-full px-3 py-1.5 border border-slate-300 rounded outline-none focus:border-emerald-500 text-sm"
                                            value={st.maxSizeMB || 50}
                                            onChange={e => handleUpdateSubmissionType(index, 'maxSizeMB', Number(e.target.value))}
                                          />
                                        </div>
                                      </>
                                    )}
                                    {['GITHUB_LINK', 'DEMO_LINK', 'FIGMA_LINK', 'TEXT', 'CUSTOM'].includes(st.type) && (
                                      <div className="md:col-span-2">
                                        <label className="block text-xs font-bold text-slate-600 mb-1">Placeholder</label>
                                        <input
                                          type="text"
                                          className="w-full px-3 py-1.5 border border-slate-300 rounded outline-none focus:border-emerald-500 text-sm"
                                          value={st.placeholder || ''}
                                          onChange={e => handleUpdateSubmissionType(index, 'placeholder', e.target.value)}
                                        />
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Evaluation Pipeline */}
                      <div className="border-t border-slate-200 pt-8">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="font-bold text-lg text-slate-900">Bộ tiêu chí đánh giá (Evaluation Rubric)</h3>
                            <p className="text-sm text-slate-500">Xây dựng bộ tiêu chí để AI đánh giá bài nộp. Mỗi tiêu chí gồm: tên, mô tả, trọng số, điều kiện đạt, kết quả đầu ra mong muốn.</p>
                          </div>
                          <button
                            type="button"
                            onClick={handleAddEvaluationStage}
                            className="flex items-center gap-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-4 py-2 rounded-lg font-bold text-sm transition-colors"
                          >
                            <FiPlus /> Thêm tiêu chí
                          </button>
                        </div>

                        {(!projectData.evaluationPipeline || projectData.evaluationPipeline.length === 0) ? (
                          <div className="text-center p-8 bg-slate-50 text-slate-500 rounded-lg border border-dashed border-slate-300">
                            Chưa cấu hình tiêu chí đánh giá. AI sẽ không thể chấm điểm.
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {projectData.evaluationPipeline.map((stage: any, index: number) => (
                              <div key={index} className="bg-slate-50 border border-slate-200 rounded-xl p-5 relative">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveEvaluationStage(index)}
                                  className="absolute top-4 right-4 p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                >
                                  <FiTrash2 />
                                </button>
                                
                                <h4 className="font-bold text-slate-900 mb-4">Tiêu chí {stage.stageNumber}</h4>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Tên tiêu chí *</label>
                                    <input
                                      type="text"
                                      className="w-full px-3 py-2 border border-slate-300 rounded outline-none focus:border-indigo-500 text-sm"
                                      value={stage.title}
                                      onChange={(e) => handleUpdateEvaluationStage(index, 'title', e.target.value)}
                                      placeholder="VD: Kiểm tra cấu trúc thư mục"
                                    />
                                  </div>
                                  <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Mô tả yêu cầu cần đạt (Objective)</label>
                                    <input
                                      type="text"
                                      className="w-full px-3 py-2 border border-slate-300 rounded outline-none focus:border-indigo-500 text-sm"
                                      value={stage.objective}
                                      onChange={(e) => handleUpdateEvaluationStage(index, 'objective', e.target.value)}
                                    />
                                  </div>
                                  <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Tiêu chí đánh giá chi tiết (Criteria) *</label>
                                    <textarea
                                      className="w-full px-3 py-2 border border-slate-300 rounded outline-none focus:border-indigo-500 text-sm min-h-[60px]"
                                      value={stage.criteria}
                                      onChange={(e) => handleUpdateEvaluationStage(index, 'criteria', e.target.value)}
                                      placeholder="Mô tả chi tiết những tiêu chí kiểm tra cho AI..."
                                    />
                                  </div>
                                  <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Kết quả đầu ra mong muốn (Expected Output)</label>
                                    <textarea
                                      className="w-full px-3 py-2 border border-slate-300 rounded outline-none focus:border-indigo-500 text-sm min-h-[60px]"
                                      value={stage.expectedOutput || ''}
                                      onChange={(e) => handleUpdateEvaluationStage(index, 'expectedOutput', e.target.value)}
                                      placeholder="Mô tả kết quả đầu ra mong muốn của tiêu chí này. VD: Phải có file README.md hoàn chỉnh với hướng dẫn cài đặt..."
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Điểm tối đa</label>
                                    <input
                                      type="number"
                                      className="w-full px-3 py-2 border border-slate-300 rounded outline-none focus:border-indigo-500 text-sm"
                                      value={stage.maxScore}
                                      onChange={(e) => handleUpdateEvaluationStage(index, 'maxScore', Number(e.target.value))}
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Trọng số (Weight từ 0 đến 1)</label>
                                    <input
                                      type="number"
                                      step="0.1"
                                      max="1"
                                      min="0"
                                      className="w-full px-3 py-2 border border-slate-300 rounded outline-none focus:border-indigo-500 text-sm"
                                      value={stage.weight}
                                      onChange={(e) => handleUpdateEvaluationStage(index, 'weight', Number(e.target.value))}
                                    />
                                  </div>
                                  <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Điều kiện đạt (Pass Criteria)</label>
                                    <input
                                      type="text"
                                      className="w-full px-3 py-2 border border-slate-300 rounded outline-none focus:border-indigo-500 text-sm"
                                      value={stage.passCriteria || ''}
                                      onChange={(e) => handleUpdateEvaluationStage(index, 'passCriteria', e.target.value)}
                                      placeholder="VD: Đạt ≥ 70% tiêu chí"
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
