import { ActivityLog } from '../../services/learning.service';
import { formatDistanceToNow } from 'date-fns';
import { FiBookOpen, FiCheckCircle, FiAward, FiPlayCircle, FiShoppingCart } from 'react-icons/fi';

interface ActivityFeedProps {
  activities: ActivityLog[];
}

export const ActivityFeed = ({ activities }: ActivityFeedProps) => {
  const getActivityIcon = (action: string) => {
    switch (action) {
      case 'COURSE_ENROLL':
        return <FiShoppingCart className="text-green-500" />;
      case 'COURSE_COMPLETE':
        return <FiCheckCircle className="text-blue-500" />;
      case 'LESSON_START':
        return <FiPlayCircle className="text-yellow-500" />;
      case 'LESSON_COMPLETE':
        return <FiCheckCircle className="text-green-500" />;
      case 'CERTIFICATE_GENERATED':
        return <FiAward className="text-purple-500" />;
      case 'BADGE_EARNED':
        return <FiAward className="text-orange-500" />;
      default:
        return <FiBookOpen className="text-gray-500" />;
    }
  };

  const getActivityText = (activity: ActivityLog) => {
    switch (activity.action) {
      case 'COURSE_ENROLL':
        return `Đã đăng ký ${activity.metadata?.courseTitle || 'một khóa học'}`;
      case 'COURSE_COMPLETE':
        return `Đã hoàn thành ${activity.metadata?.courseTitle || 'một khóa học'}`;
      case 'LESSON_START':
        return `Bắt đầu ${activity.metadata?.lessonTitle || 'một bài học'}`;
      case 'LESSON_COMPLETE':
        return `Đã hoàn thành ${activity.metadata?.lessonTitle || 'một bài học'}`;
      case 'CERTIFICATE_GENERATED':
        return `Nhận chứng chỉ cho ${activity.metadata?.courseTitle || 'một khóa học'}`;
      case 'BADGE_EARNED':
        return `Đạt huy hiệu ${activity.metadata?.badgeName || 'mới'}`;
      default:
        return activity.action;
    }
  };

  return (
    <div className="space-y-3">
      {activities.length === 0 ? (
        <p className="text-gray-500 text-center py-4">Chưa có hoạt động gần đây</p>
      ) : (
        activities.map((activity) => (
          <div key={activity.id} className="flex items-start space-x-3">
            <div className="mt-1">{getActivityIcon(activity.action)}</div>
            <div className="flex-1">
              <p className="text-sm text-gray-900">{getActivityText(activity)}</p>
              <p className="text-xs text-gray-500">
                {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
              </p>
              {activity.durationSeconds > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  Đã học {Math.floor(activity.durationSeconds / 60)} phút
                </p>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
};
