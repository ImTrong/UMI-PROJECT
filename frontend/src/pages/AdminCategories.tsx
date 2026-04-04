import { useState, useEffect } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiTag } from 'react-icons/fi';
import { courseService, Category } from '../services/course.service';
import toast from 'react-hot-toast';

export default function AdminCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '', icon: '' });

  const loadCategories = async () => {
    setLoading(true);
    try {
      const data = await courseService.getCategories(true);
      setCategories(data);
    } catch (error) {
      toast.error('Tải danh mục thất bại');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await courseService.updateCategory(editingId, formData);
        toast.success('Đã cập nhật danh mục');
      } else {
        await courseService.createCategory(formData);
        toast.success('Đã tạo danh mục');
      }
      setFormData({ name: '', description: '', icon: '' });
      setIsAdding(false);
      setEditingId(null);
      loadCategories();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Lưu danh mục thất bại');
    }
  };

  const handleEdit = (category: Category) => {
    setEditingId(category.id);
    setFormData({
      name: category.name,
      description: category.description || '',
      icon: category.icon || '',
    });
    setIsAdding(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa danh mục "${name}"?`)) return;
    try {
      await courseService.deleteCategory(id);
      toast.success('Đã xóa danh mục');
      loadCategories();
    } catch (error) {
      toast.error('Xóa danh mục thất bại');
    }
  };

  if (loading && categories.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Quản lý Danh mục</h1>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="btn-primary flex items-center space-x-2"
          >
            <FiPlus />
            <span>Thêm Danh mục</span>
          </button>
        )}
      </div>

      {isAdding && (
        <form onSubmit={handleSubmit} className="card bg-gray-50 mb-8 p-6 space-y-4">
          <h2 className="text-xl font-semibold">
            {editingId ? 'Sửa Danh mục' : 'Tạo Danh mục Mới'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tên *</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="input-field"
                placeholder="VD: Phát triển Web"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Biểu tượng (emoji hoặc class)</label>
              <input
                type="text"
                value={formData.icon}
                onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                className="input-field"
                placeholder="VD: 🌐"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="input-field"
                rows={2}
                placeholder="Mô tả danh mục..."
              />
            </div>
          </div>
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => {
                setIsAdding(false);
                setEditingId(null);
                setFormData({ name: '', description: '', icon: '' });
              }}
              className="btn-secondary"
            >
              Hủy
            </button>
            <button type="submit" className="btn-primary">
              {editingId ? 'Cập nhật Danh mục' : 'Tạo Danh mục'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {categories.map((category) => (
            <li key={category.id}>
              <div className="px-4 py-4 flex items-center sm:px-6">
                <div className="min-w-0 flex-1 flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600 text-2xl">
                      {category.icon || <FiTag />}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 px-4">
                    <div>
                      <h3 className="text-lg font-medium text-primary-600 truncate">
                        {category.name}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {category._count?.courses || 0} khóa học
                      </p>
                    </div>
                    {category.description && (
                      <p className="mt-1 text-sm text-gray-600 line-clamp-1">
                        {category.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleEdit(category)}
                    className="p-2 text-gray-400 hover:text-primary-600 transition-colors"
                    title="Edit"
                  >
                    <FiEdit2 size={20} />
                  </button>
                  <button
                    onClick={() => handleDelete(category.id, category.name)}
                    className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                    title="Delete"
                  >
                    <FiTrash2 size={20} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
