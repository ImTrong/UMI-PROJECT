import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminPathService, AdminLearningPath } from '../../services/admin-path.service';
import { courseApi } from '../../services/api';
import toast from 'react-hot-toast';
import { FiArrowLeft, FiSave, FiPlus, FiTrash2, FiArrowUp, FiArrowDown, FiAward } from 'react-icons/fi';

export default function AdminLearningPathForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = !!id;

  const [activeTab, setActiveTab] = useState('basic');
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

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
  });

  const [availableCourses, setAvailableCourses] = useState<any[]>([]);
  const [searchCourse, setSearchCourse] = useState('');
  const [skillInput, setSkillInput] = useState('');

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
        toast.success('Project updated successfully');
      } else {
        const newProject = await adminPathService.createFinalProject(id, projectData);
        setProjectData(newProject);
        toast.success('Project created successfully');
      }
    } catch {
      toast.error('Failed to save final project');
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
      // Re-assign stageNumbers
      newPipeline.forEach((stage, idx) => {
        stage.stageNumber = idx + 1;
      });
      return { ...prev, evaluationPipeline: newPipeline };
    });
  };

  const loadCourses = async () => {
    try {
      // Fetch all courses (for admin selection)
      // Note: Assuming there is a generic courses endpoint or search
      const response = await courseApi.get('/courses?limit=100');
      setAvailableCourses(response.data.data || response.data.courses || []);
    } catch {
      toast.error('Could not load courses');
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
      toast.error('Failed to load learning path');
      navigate('/admin/learning-paths');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      setSaving(true);
      if (isEdit && id) {
        await adminPathService.updatePath(id, formData);
        toast.success('Path updated successfully');
      } else {
        const newPath = await adminPathService.createPath(formData);
        toast.success('Path created successfully');
        navigate(`/admin/learning-paths/${newPath.id}/edit`);
      }
    } catch {
      toast.error('Failed to save path');
    } finally {
      setSaving(false);
    }
  };

  // Basic Info Handlers
  const handleAddSkill = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && skillInput.trim()) {
      e.preventDefault();
      if (!formData.skills?.includes(skillInput.trim())) {
        setFormData(prev => ({ ...prev, skills: [...(prev.skills || []), skillInput.trim()] }));
      }
      setSkillInput('');
    }
  };

  const handleRemoveSkill = (skill: string) => {
    setFormData(prev => ({ ...prev, skills: prev.skills?.filter(s => s !== skill) }));
  };

  // Course Selection Handlers
  const handleAddCourse = (courseId: string) => {
    if (!formData.courseIds?.includes(courseId)) {
      setFormData(prev => ({ ...prev, courseIds: [...(prev.courseIds || []), courseId] }));
    }
  };

  const handleRemoveCourse = (courseId: string) => {
    setFormData(prev => ({
      ...prev,
      courseIds: prev.courseIds?.filter(id => id !== courseId),
      // Also remove from prerequisite rules if any
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
    setFormData(prev => ({ ...prev, courseIds: newCourseIds }));
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

    setFormData(prev => ({ ...prev, prerequisiteRules: rules }));
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 select-none font-sans bg-slate-50 min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/admin/learning-paths')} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <FiArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <h1 className="text-2xl font-bold text-slate-900">{isEdit ? 'Edit Learning Path' : 'Create Learning Path'}</h1>
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
          <FiSave /> {(saving || projectSaving) ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-slate-200 overflow-x-auto">
          {['basic', 'courses', 'prerequisites', 'settings', 'final-project'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-4 font-semibold text-sm capitalize whitespace-nowrap outline-none ${activeTab === tab ? 'text-primary-600 border-b-2 border-primary-600 bg-primary-50/50' : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              {tab === 'basic' ? 'Basic Info' : tab === 'courses' ? 'Courses & Timeline' : tab === 'prerequisites' ? 'Prerequisites' : tab === 'settings' ? 'Settings & Rules' : 'Final Project'}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6 md:p-8">

          {/* TAB 1: Basic Info */}
          {activeTab === 'basic' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Path Title *</label>
                  <input
                    type="text"
                    required
                    className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
                    value={formData.title}
                    onChange={e => setFormData({ ...formData, title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Slug</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-primary-500 bg-slate-50"
                    value={formData.slug}
                    onChange={e => setFormData({ ...formData, slug: e.target.value })}
                    placeholder="Auto-generated if empty"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Short Description</label>
                <input
                  type="text"
                  className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
                  value={formData.shortDescription || ''}
                  onChange={e => setFormData({ ...formData, shortDescription: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Detailed Description</label>
                <textarea
                  rows={4}
                  className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Category</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
                    value={formData.category || ''}
                    onChange={e => setFormData({ ...formData, category: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Difficulty</label>
                  <select
                    className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
                    value={formData.difficulty}
                    onChange={e => setFormData({ ...formData, difficulty: e.target.value })}
                  >
                    <option value="ALL">All Levels</option>
                    <option value="BEGINNER">Beginner</option>
                    <option value="INTERMEDIATE">Intermediate</option>
                    <option value="ADVANCED">Advanced</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Career Goal</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
                    value={formData.careerGoal || ''}
                    onChange={e => setFormData({ ...formData, careerGoal: e.target.value })}
                    placeholder="e.g. Frontend Developer"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Image URL</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
                    value={formData.imageUrl || ''}
                    onChange={e => setFormData({ ...formData, imageUrl: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Banner URL</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
                    value={formData.bannerUrl || ''}
                    onChange={e => setFormData({ ...formData, bannerUrl: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Skills Achieved</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {formData.skills?.map(skill => (
                    <span key={skill} className="bg-primary-50 text-primary-700 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1 border border-primary-200">
                      {skill}
                      <button type="button" onClick={() => handleRemoveSkill(skill)} className="hover:text-red-500">&times;</button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
                  value={skillInput}
                  onChange={e => setSkillInput(e.target.value)}
                  onKeyDown={handleAddSkill}
                  placeholder="Type a skill and press Enter"
                />
              </div>
            </div>
          )}

          {/* TAB 2: Courses & Timeline */}
          {activeTab === 'courses' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Selected Courses Timeline */}
              <div>
                <h3 className="font-bold text-slate-900 mb-4 border-b pb-2">Path Timeline ({formData.courseIds?.length} Courses)</h3>

                {formData.courseIds?.length === 0 ? (
                  <div className="text-center p-8 bg-slate-50 border border-dashed rounded-xl text-slate-400">
                    No courses added yet. Search and select courses from the right.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {formData.courseIds?.map((cId, index) => {
                      const course = availableCourses.find(c => c.id === cId) || { title: `Unknown Course (${cId})`, id: cId };
                      return (
                        <div key={cId} className="flex items-center gap-3 bg-white border border-slate-200 p-3 rounded-xl shadow-sm">
                          <div className="flex flex-col items-center justify-center bg-slate-100 text-slate-500 font-bold rounded-lg w-8 h-8 flex-shrink-0">
                            {index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm text-slate-900 truncate">{course.title}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => moveCourse(index, 'up')} disabled={index === 0} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded disabled:opacity-30">
                              <FiArrowUp />
                            </button>
                            <button type="button" onClick={() => moveCourse(index, 'down')} disabled={index === formData.courseIds!.length - 1} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded disabled:opacity-30">
                              <FiArrowDown />
                            </button>
                            <button type="button" onClick={() => handleRemoveCourse(cId)} className="p-1.5 text-red-400 hover:bg-red-50 rounded ml-1">
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
                <h3 className="font-bold text-slate-900 mb-4">Available Courses</h3>
                <input
                  type="text"
                  placeholder="Search courses..."
                  className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-primary-500 mb-4"
                  value={searchCourse}
                  onChange={e => setSearchCourse(e.target.value)}
                />

                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                  {availableCourses
                    .filter(c => c.title?.toLowerCase().includes(searchCourse.toLowerCase()))
                    .filter(c => !formData.courseIds?.includes(c.id))
                    .map(course => (
                      <div key={course.id} className="flex items-center justify-between bg-white p-3 border border-slate-200 rounded-lg hover:border-primary-300 transition-colors">
                        <div>
                          <p className="font-bold text-sm text-slate-800 line-clamp-1">{course.title}</p>
                          <p className="text-xs text-slate-500">{course.category || 'Course'}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAddCourse(course.id)}
                          className="p-2 bg-primary-50 text-primary-600 rounded-lg hover:bg-primary-100 transition-colors"
                        >
                          <FiPlus />
                        </button>
                      </div>
                    ))}
                  {availableCourses.length === 0 && (
                    <div className="text-center text-slate-400 py-4 text-sm">No courses found</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Prerequisites */}
          {activeTab === 'prerequisites' && (
            <div>
              <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl mb-6 text-sm text-amber-800">
                <strong>Prerequisites (Khóa học tiên quyết):</strong> Students must complete the required courses before they can access a dependent course in this path. Only courses listed <strong>BEFORE</strong> a course in the timeline can be set as its prerequisites.
              </div>

              {formData.courseIds?.length! < 2 ? (
                <div className="text-center p-8 text-slate-400">Add at least 2 courses to the timeline to set prerequisites.</div>
              ) : (
                <div className="space-y-6">
                  {formData.courseIds?.map((cId, index) => {
                    if (index === 0) return null; // First course can't have prerequisites from this path
                    const course = availableCourses.find(c => c.id === cId) || { title: `Course ${cId}` };
                    const priorCourseIds = formData.courseIds!.slice(0, index);

                    const rule = (formData.prerequisiteRules || []).find((r: any) => r.courseId === cId);
                    const requiredCourseIds = rule ? rule.requiredCourseIds : [];

                    return (
                      <div key={cId} className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
                        <h4 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-xs flex items-center justify-center">{index + 1}</span>
                          {course.title}
                        </h4>

                        <div className="pl-8 space-y-2">
                          <p className="text-xs font-semibold text-slate-500 mb-2 uppercase">Requires completion of:</p>
                          {priorCourseIds.map(priorId => {
                            const priorCourse = availableCourses.find(c => c.id === priorId) || { title: `Course ${priorId}` };
                            const isRequired = requiredCourseIds.includes(priorId);

                            return (
                              <label key={priorId} className="flex items-center gap-3 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  className="w-4 h-4 text-primary-600 rounded border-slate-300 focus:ring-primary-500 cursor-pointer"
                                  checked={isRequired}
                                  onChange={() => handleTogglePrerequisite(cId, priorId)}
                                />
                                <span className={`text-sm ${isRequired ? 'text-slate-900 font-bold' : 'text-slate-600 group-hover:text-slate-900'}`}>
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
            <div className="max-w-2xl space-y-8">

              <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                <h3 className="font-bold text-slate-900 mb-4">Completion Criteria</h3>
                <div className="space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="completionRule"
                      className="mt-1"
                      checked={formData.completionRule === 'ALL_COURSES'}
                      onChange={() => setFormData({ ...formData, completionRule: 'ALL_COURSES' })}
                    />
                    <div>
                      <p className="font-bold text-sm text-slate-900">Complete 100% of Courses</p>
                      <p className="text-xs text-slate-500">Student must finish all courses in the path timeline.</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="completionRule"
                      className="mt-1"
                      checked={formData.completionRule?.startsWith('MIN_PERCENT')}
                      onChange={() => setFormData({ ...formData, completionRule: 'MIN_PERCENT:80' })}
                    />
                    <div>
                      <p className="font-bold text-sm text-slate-900">Minimum Percentage</p>
                      <p className="text-xs text-slate-500">Student needs to complete a certain percentage of courses (e.g. 80%).</p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="bg-slate-50 p-5 rounded-xl border border-slate-200">
                <h3 className="font-bold text-slate-900 mb-4">Discovery & AI Recommendation</h3>

                <label className="flex items-center gap-3 cursor-pointer mb-4">
                  <input
                    type="checkbox"
                    className="w-5 h-5 text-primary-600 rounded border-slate-300"
                    checked={formData.recommended}
                    onChange={(e) => setFormData({ ...formData, recommended: e.target.checked })}
                  />
                  <div>
                    <p className="font-bold text-sm text-slate-900">Mark as Recommended Path</p>
                    <p className="text-xs text-slate-500">This path will be highlighted on student dashboards.</p>
                  </div>
                </label>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-900 mb-4">Publishing Status</h3>
                <select
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 font-bold bg-slate-50"
                  value={formData.status}
                  onChange={e => setFormData({ ...formData, status: e.target.value })}
                >
                  <option value="DRAFT">Draft (Hidden from students)</option>
                  <option value="PUBLISHED">Published (Visible to everyone)</option>
                  <option value="ARCHIVED">Archived (Legacy, hidden from lists)</option>
                </select>
              </div>

            </div>
          )}

          {/* TAB 5: Final Project */}
          {activeTab === 'final-project' && (
            <div className="space-y-8">
              {!isEdit ? (
                <div className="text-center p-8 bg-amber-50 text-amber-800 rounded-xl border border-amber-200">
                  <FiAward className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <h3 className="font-bold text-lg mb-2">Save path first</h3>
                  <p>You must save the basic learning path before configuring the final project.</p>
                </div>
              ) : projectLoading ? (
                <div className="text-center p-8">Loading final project...</div>
              ) : (
                <div className="bg-white rounded-xl">
                  {!projectData && (
                    <div className="mb-6 p-4 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-indigo-900">No Final Project</h4>
                        <p className="text-sm text-indigo-700">This learning path currently does not have a final project.</p>
                      </div>
                      <button
                        onClick={() => setProjectData({
                          title: 'Dự án cuối kỳ: ' + formData.title,
                          description: '',
                          maxScore: 100,
                          passingScore: 80,
                          maxAttempts: 3,
                          evaluationPipeline: []
                        })}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700"
                      >
                        Create Project
                      </button>
                    </div>
                  )}

                  {projectData && (
                    <div className="space-y-8">
                      {/* Basic Info */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-bold text-slate-700 mb-1">Project Title *</label>
                          <input
                            type="text"
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 font-medium"
                            value={projectData.title || ''}
                            onChange={e => setProjectData({ ...projectData, title: e.target.value })}
                            required
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-bold text-slate-700 mb-1">Description *</label>
                          <textarea
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 min-h-[100px]"
                            value={projectData.description || ''}
                            onChange={e => setProjectData({ ...projectData, description: e.target.value })}
                            required
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-bold text-slate-700 mb-1">Objectives (Mục tiêu đầu ra)</label>
                          <textarea
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 min-h-[80px]"
                            value={projectData.objectives || ''}
                            onChange={e => setProjectData({ ...projectData, objectives: e.target.value })}
                            placeholder="Nhập mục tiêu học viên cần đạt được..."
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Max Score</label>
                          <input
                            type="number"
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
                            value={projectData.maxScore || 100}
                            onChange={e => setProjectData({ ...projectData, maxScore: Number(e.target.value) })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Passing Score (%)</label>
                          <input
                            type="number"
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
                            value={projectData.passingScore || 80}
                            onChange={e => setProjectData({ ...projectData, passingScore: Number(e.target.value) })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Max Attempts (Số lần nộp lại)</label>
                          <input
                            type="number"
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-primary-500"
                            value={projectData.maxAttempts || 3}
                            onChange={e => setProjectData({ ...projectData, maxAttempts: Number(e.target.value) })}
                          />
                        </div>
                      </div>

                      {/* Evaluation Pipeline */}
                      <div className="border-t border-slate-200 pt-8">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="font-bold text-lg text-slate-900">AI Evaluation Pipeline</h3>
                            <p className="text-sm text-slate-500">Configure how the AI will grade the project submissions stage by stage.</p>
                          </div>
                          <button
                            onClick={handleAddEvaluationStage}
                            className="flex items-center gap-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-4 py-2 rounded-lg font-bold text-sm transition-colors"
                          >
                            <FiPlus /> Add Stage
                          </button>
                        </div>

                        {(!projectData.evaluationPipeline || projectData.evaluationPipeline.length === 0) ? (
                          <div className="text-center p-8 bg-slate-50 text-slate-500 rounded-lg border border-dashed border-slate-300">
                            No evaluation stages configured yet.
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {projectData.evaluationPipeline.map((stage: any, index: number) => (
                              <div key={index} className="bg-slate-50 border border-slate-200 rounded-xl p-5 relative">
                                <button
                                  onClick={() => handleRemoveEvaluationStage(index)}
                                  className="absolute top-4 right-4 p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                >
                                  <FiTrash2 />
                                </button>
                                
                                <h4 className="font-bold text-slate-900 mb-4">Stage {stage.stageNumber}</h4>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Title *</label>
                                    <input
                                      type="text"
                                      className="w-full px-3 py-2 border border-slate-300 rounded outline-none focus:border-indigo-500 text-sm"
                                      value={stage.title}
                                      onChange={(e) => handleUpdateEvaluationStage(index, 'title', e.target.value)}
                                      placeholder="e.g. Kiểm tra cấu trúc Project"
                                    />
                                  </div>
                                  <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Objective</label>
                                    <input
                                      type="text"
                                      className="w-full px-3 py-2 border border-slate-300 rounded outline-none focus:border-indigo-500 text-sm"
                                      value={stage.objective}
                                      onChange={(e) => handleUpdateEvaluationStage(index, 'objective', e.target.value)}
                                    />
                                  </div>
                                  <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Grading Criteria (Tiêu chí chấm) *</label>
                                    <textarea
                                      className="w-full px-3 py-2 border border-slate-300 rounded outline-none focus:border-indigo-500 text-sm min-h-[60px]"
                                      value={stage.criteria}
                                      onChange={(e) => handleUpdateEvaluationStage(index, 'criteria', e.target.value)}
                                      placeholder="Mô tả rõ AI cần kiểm tra những gì..."
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Max Score</label>
                                    <input
                                      type="number"
                                      className="w-full px-3 py-2 border border-slate-300 rounded outline-none focus:border-indigo-500 text-sm"
                                      value={stage.maxScore}
                                      onChange={(e) => handleUpdateEvaluationStage(index, 'maxScore', Number(e.target.value))}
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Weight (Trọng số 0-1)</label>
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
