import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { courseService, Category, CreateCourseData } from '../../services/course.service';

interface CourseFormProps {
  initialData?: CreateCourseData;
  onSubmit: (data: CreateCourseData, thumbnailFile?: File | null) => Promise<void>;
  isLoading?: boolean;
}

export const CourseForm = ({ initialData, onSubmit, isLoading }: CourseFormProps) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [requirements, setRequirements] = useState<string[]>(initialData?.requirements || []);
  const [newRequirement, setNewRequirement] = useState('');
  const [targetAudience, setTargetAudience] = useState<string[]>(initialData?.targetAudience || []);
  const [newAudience, setNewAudience] = useState('');
  const [thumbnailPreview, setThumbnailPreview] = useState<string>(initialData?.thumbnail || '');
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<CreateCourseData>({
    defaultValues: initialData || {
      level: 'BEGINNER',
      price: 0,
    },
  });

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const data = await courseService.getCategories();
        setCategories(data);
      } catch (error) {
        console.error('Failed to load categories:', error);
      }
    };
    loadCategories();
  }, []);

  const addRequirement = () => {
    if (newRequirement.trim()) {
      setRequirements([...requirements, newRequirement.trim()]);
      setNewRequirement('');
    }
  };

  const removeRequirement = (index: number) => {
    setRequirements(requirements.filter((_, i) => i !== index));
  };

  const addAudience = () => {
    if (newAudience.trim()) {
      setTargetAudience([...targetAudience, newAudience.trim()]);
      setNewAudience('');
    }
  };

  const removeAudience = (index: number) => {
    setTargetAudience(targetAudience.filter((_, i) => i !== index));
  };

  const handleFormSubmit = async (data: CreateCourseData) => {
    const formattedData = {
      ...data,
      requirements,
      targetAudience,
      categoryId: data.categoryId === '' ? undefined : data.categoryId,
    };
    await onSubmit(formattedData, thumbnailFile);
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
      {/* Basic Information */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Tiêu đề Khóa học *
        </label>
        <input
          {...register('title', { required: 'Cần nhập tiêu đề' })}
          className="input-field"
          placeholder="VD: Khóa học Lập trình Node.js"
        />
        {errors.title && (
          <p className="mt-1 text-sm text-red-600">{errors.title.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Mô tả *
        </label>
        <textarea
          {...register('description', { required: 'Cần nhập mô tả' })}
          rows={5}
          className="input-field"
          placeholder="Học viên sẽ học được những gì trong khóa học này?"
        />
        {errors.description && (
          <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Giá tiền *
          </label>
          <input
            type="number"
            step="0.01"
            {...register('price', { 
              required: 'Cần nhập giá tiền', 
              min: 0,
              valueAsNumber: true 
            })}
            className="input-field"
            placeholder="0.00"
          />
          {errors.price && (
            <p className="mt-1 text-sm text-red-600">{errors.price.message}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Cấp độ
          </label>
          <select {...register('level')} className="input-field">
            <option value="BEGINNER">Cơ bản</option>
            <option value="INTERMEDIATE">Trung cấp</option>
            <option value="ADVANCED">Nâng cao</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Danh mục
          </label>
          <select {...register('categoryId')} className="input-field">
            <option value="">Chọn Danh mục</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Ảnh thu nhỏ (Thumbnail)
          </label>
          <div className="space-y-3">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setThumbnailFile(file);
                if (file) {
                  const previewUrl = URL.createObjectURL(file);
                  setThumbnailPreview(previewUrl);
                }
              }}
              className="input-field"
            />
            <input
              {...register('thumbnail', {
                onChange: (e) => {
                  const value = e.target.value as string;
                  if (value) setThumbnailPreview(value);
                },
              })}
              className="input-field"
              placeholder="Hoặc dán URL ảnh: https://example.com/image.jpg"
            />
            {thumbnailPreview && (
              <div className="border rounded-lg p-2 bg-gray-50">
                <img
                  src={thumbnailPreview}
                  alt="Thumbnail preview"
                  className="w-full max-h-56 object-cover rounded"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Bạn sẽ học được gì
        </label>
        <textarea
          {...register('whatYouWillLearn')}
          rows={3}
          className="input-field"
          placeholder="Liệt kê các kiến thức chính học được từ khóa học này..."
        />
      </div>

      {/* Requirements */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Yêu cầu
        </label>
        <div className="flex space-x-2 mb-2">
          <input
            type="text"
            value={newRequirement}
            onChange={(e) => setNewRequirement(e.target.value)}
            className="input-field flex-1"
            placeholder="VD: Kiến thức cơ bản về JavaScript"
            onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addRequirement())}
          />
          <button
            type="button"
            onClick={addRequirement}
            className="btn-secondary"
          >
            Thêm
          </button>
        </div>
        <div className="space-y-1">
          {requirements.map((req, index) => (
            <div key={index} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded">
              <span className="text-sm">{req}</span>
              <button
                type="button"
                onClick={() => removeRequirement(index)}
                className="text-red-600 hover:text-red-700"
              >
                Xóa
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Target Audience */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Đối tượng mục tiêu
        </label>
        <div className="flex space-x-2 mb-2">
          <input
            type="text"
            value={newAudience}
            onChange={(e) => setNewAudience(e.target.value)}
            className="input-field flex-1"
            placeholder="VD: Lập trình viên mới bắt đầu"
            onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addAudience())}
          />
          <button
            type="button"
            onClick={addAudience}
            className="btn-secondary"
          >
            Thêm
          </button>
        </div>
        <div className="space-y-1">
          {targetAudience.map((audience, index) => (
            <div key={index} className="flex items-center justify-between bg-gray-50 px-3 py-2 rounded">
              <span className="text-sm">{audience}</span>
              <button
                type="button"
                onClick={() => removeAudience(index)}
                className="text-red-600 hover:text-red-700"
              >
                Xóa
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end space-x-3">
        <button
          type="submit"
          disabled={isLoading}
          className="btn-primary disabled:opacity-50"
        >
          {isLoading ? 'Đang lưu...' : (initialData ? 'Cập nhật Khóa học' : 'Tạo Khóa học')}
        </button>
      </div>
    </form>
  );
};
