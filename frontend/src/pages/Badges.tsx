import { useState, useEffect } from 'react';
import { learningService, Badge } from '../services/learning.service';
import { BadgeCard } from '../components/learning/BadgeCard';
import { useAuth } from '../hooks/useAuth';
import { FiAward } from 'react-icons/fi';

export default function Badges() {
  const { isAuthenticated } = useAuth();
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadBadges();
  }, [isAuthenticated]);

  const loadBadges = async () => {
    try {
      const data = await learningService.getUserBadges();
      setBadges(data);
    } catch (error) {
      console.error('Failed to load badges:', error);
    } finally {
      setLoading(false);
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
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Huy hiệu của tôi</h1>

      {badges.length === 0 ? (
        <div className="card text-center py-12">
          <FiAward className="mx-auto text-4xl text-gray-400 mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Chưa có huy hiệu nào</h2>
          <p className="text-gray-600">Hoàn thành khóa học và duy trì chuỗi học tập để nhận huy hiệu</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {badges.map((badge) => (
            <BadgeCard key={badge.id} badge={badge} />
          ))}
        </div>
      )}
    </div>
  );
}
