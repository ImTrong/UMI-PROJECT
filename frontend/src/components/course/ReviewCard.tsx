import { Review } from '../../services/course.service';
import { RatingStars } from './RatingStars';
import { formatDistanceToNow } from 'date-fns';

interface ReviewCardProps {
  review: Review;
  onEdit?: () => void;
  onDelete?: () => void;
  isOwner?: boolean;
}

export const ReviewCard = ({ review, onEdit, onDelete, isOwner }: ReviewCardProps) => {
  return (
    <div className="border-b border-slate-100 py-4 last:border-0">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center space-x-2">
            <span className="font-semibold">
              {review.user?.fullName || 'Ẩn danh'}
            </span>
            <span className="text-sm text-slate-500">
              {formatDistanceToNow(new Date(review.createdAt), { addSuffix: true })}
            </span>
          </div>
          <RatingStars rating={review.rating} size={16} />
        </div>
        {isOwner && (
          <div className="flex space-x-2">
            <button
              onClick={onEdit}
              className="text-sm text-primary-600 hover:text-primary-700"
            >
              Sửa
            </button>
            <button
              onClick={onDelete}
              className="text-sm text-red-600 hover:text-red-700"
            >
              Xóa
            </button>
          </div>
        )}
      </div>
      {review.comment && (
        <p className="mt-2 text-slate-700">{review.comment}</p>
      )}
    </div>
  );
};
