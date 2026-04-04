import { Badge } from '../../services/learning.service';
import { formatDistanceToNow } from 'date-fns';

interface BadgeCardProps {
  badge: Badge;
}

export const BadgeCard = ({ badge }: BadgeCardProps) => {
  return (
    <div className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition">
      <div className="w-10 h-10 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center text-xl">
        {badge.iconUrl || '🏆'}
      </div>
      <div className="flex-1">
        <h4 className="font-semibold text-gray-900">{badge.badgeName}</h4>
        <p className="text-xs text-gray-500">{badge.description}</p>
        <p className="text-xs text-gray-400 mt-1">
          Earned {formatDistanceToNow(new Date(badge.earnedAt), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
};
