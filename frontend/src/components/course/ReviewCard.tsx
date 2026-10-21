import { Review } from '../../services/course.service';
import { RatingStars } from './RatingStars';
import { formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';

interface ReviewCardProps {
  review: Review & { course?: { title: string; slug: string } };
  onEdit?: () => void;
  onDelete?: () => void;
  isOwner?: boolean;
  showCourseName?: boolean;
}

export const ReviewCard = ({ review, onEdit, onDelete, isOwner, showCourseName = false }: ReviewCardProps) => {
  const timeAgo = formatDistanceToNow(new Date(review.createdAt), { addSuffix: true, locale: vi });

  return (
    <div className="border-b border-slate-100 py-5 last:border-0">
      <div className="flex justify-between items-start gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Avatar */}
          <div className="shrink-0">
            {review.user?.avatar ? (
              <img
                src={review.user.avatar}
                alt={review.user.fullName || 'User'}
                className="w-10 h-10 rounded-full object-cover border-2 border-slate-100"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-sm">
                {(review.user?.fullName || 'A').charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-900 text-sm">
                {review.user?.fullName || 'Ẩn danh'}
              </span>
              <span className="text-xs text-slate-400">
                {timeAgo}
              </span>
            </div>
            <div className="mt-0.5">
              <RatingStars rating={review.rating} size={14} />
            </div>
            {showCourseName && review.course && (
              <p className="text-xs text-primary-600 mt-1 font-medium truncate">
                Khóa học: {review.course.title}
              </p>
            )}
            {review.comment && (
              <p className="mt-2 text-slate-700 text-sm leading-relaxed">{review.comment}</p>
            )}
          </div>
        </div>

        {/* Actions */}
        {isOwner && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onEdit}
              className="text-xs text-primary-600 hover:text-primary-700 font-medium px-2 py-1 rounded-lg hover:bg-primary-50 transition-colors"
            >
              Sửa
            </button>
            <button
              onClick={onDelete}
              className="text-xs text-red-500 hover:text-red-600 font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
            >
              Xóa
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
