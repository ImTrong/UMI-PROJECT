import { ActivityLog } from '../../services/learning.service';
import { formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';
import { FiBookOpen, FiCheckCircle, FiAward, FiPlayCircle, FiShoppingCart, FiActivity } from 'react-icons/fi';

interface ActivityFeedProps {
  activities: ActivityLog[];
}

export const ActivityFeed = ({ activities }: ActivityFeedProps) => {
  const getActivityData = (action: string) => {
    switch (action) {
      case 'COURSE_ENROLL':
        return { icon: <FiShoppingCart />, bg: 'bg-green-100', text: 'text-green-600', border: 'border-green-200' };
      case 'COURSE_COMPLETE':
        return { icon: <FiCheckCircle />, bg: 'bg-primary-100', text: 'text-primary-600', border: 'border-primary-200' };
      case 'LESSON_START':
        return { icon: <FiPlayCircle />, bg: 'bg-yellow-100', text: 'text-yellow-600', border: 'border-yellow-200' };
      case 'LESSON_COMPLETE':
        return { icon: <FiCheckCircle />, bg: 'bg-teal-100', text: 'text-teal-600', border: 'border-teal-200' };
      case 'CERTIFICATE_GENERATED':
        return { icon: <FiAward />, bg: 'bg-teal-100', text: 'text-teal-600', border: 'border-teal-200' };
      case 'BADGE_EARNED':
        return { icon: <FiAward />, bg: 'bg-orange-100', text: 'text-orange-600', border: 'border-orange-200' };
      default:
        return { icon: <FiBookOpen />, bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-100' };
    }
  };

  const getActivityDescription = (activity: ActivityLog) => {
    switch (activity.action) {
      case 'COURSE_ENROLL':
        return <span>Đã đăng ký khóa học <strong className="text-slate-900">{activity.metadata?.courseTitle || 'Một khóa học'}</strong></span>;
      case 'COURSE_COMPLETE':
        return <span>Tuyệt vời! Bạn đã hoàn thành khóa học <strong className="text-primary-600">{activity.metadata?.courseTitle || 'Một khóa học'}</strong></span>;
      case 'LESSON_START':
        return <span>Đã bắt đầu học bài <strong className="text-slate-900">{activity.metadata?.lessonTitle || 'Một bài học'}</strong></span>;
      case 'LESSON_COMPLETE':
        return <span>Đã học xong bài <strong className="text-slate-900">{activity.metadata?.lessonTitle || 'Một bài học'}</strong></span>;
      case 'CERTIFICATE_GENERATED':
        return <span>Nhận chứng nhận hoàn thành khóa <strong className="text-teal-600">{activity.metadata?.courseTitle || 'Một khóa học'}</strong></span>;
      case 'BADGE_EARNED':
        return <span>Chinh phục huy hiệu mới <strong className="text-orange-600">{activity.metadata?.badgeName || 'Mới'}</strong></span>;
      default:
        return <span>Thực hiện hành động <strong className="text-slate-900">{activity.action}</strong></span>;
    }
  };

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
          <FiActivity className="w-8 h-8 text-slate-400" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 mb-1">Chưa có hoạt động nào</h3>
        <p className="text-sm text-slate-500 max-w-sm">Hành trình ngàn dặm bắt đầu từ một bước chân. Hãy bắt đầu học tập ngay hôm nay!</p>
      </div>
    );
  }

  return (
    <div className="relative pl-4 sm:pl-0">
      {/* Vertical Timeline Line */}
      <div className="absolute left-[27px] sm:left-[35px] top-4 bottom-8 w-0.5 bg-slate-100 rounded-full"></div>
      
      <div className="space-y-8">
        {activities.map((activity) => {
          const style = getActivityData(activity.action);
          return (
            <div key={activity.id} className="relative flex items-start group">
              {/* Timeline Dot/Icon */}
              <div className={`relative z-10 flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-full border-[6px] border-white flex items-center justify-center ${style.bg} ${style.text} shadow-sm group-hover:scale-110 transition-transform duration-300`}>
                <div className="text-xl sm:text-2xl">{style.icon}</div>
              </div>
              
              {/* Content Card */}
              <div className="ml-4 sm:ml-6 flex-1 pt-1.5">
                <div className={`bg-white p-5 rounded-2xl border transition-all duration-300 shadow-sm hover:shadow-sm ${style.border}`}>
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 mb-2">
                    <p className="text-sm sm:text-base text-slate-700 font-medium">
                      {getActivityDescription(activity)}
                    </p>
                    <span className="inline-flex text-xs font-semibold text-slate-400 bg-slate-50 px-2.5 py-1 rounded-full border border-slate-100 sm:shrink-0">
                      {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true, locale: vi })}
                    </span>
                  </div>
                  
                  {activity.durationSeconds > 0 && (
                    <div className="inline-flex items-center text-xs font-medium text-slate-500 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100">
                      <FiPlayCircle className="mr-1.5 text-slate-400" />
                      Đã dành {Math.floor(activity.durationSeconds / 60)} phút học tập
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
