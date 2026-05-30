import { FiStar } from 'react-icons/fi';

interface RatingStarsProps {
  rating: number;
  size?: number;
  interactive?: boolean;
  onChange?: (rating: number) => void;
}

export const RatingStars = ({ rating, size = 20, interactive = false, onChange }: RatingStarsProps) => {
  const fullStars = Math.floor(rating);

  const handleClick = (value: number) => {
    if (interactive && onChange) {
      onChange(value);
    }
  };

  return (
    <div className="flex items-center">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => handleClick(star)}
          disabled={!interactive}
          className={interactive ? 'cursor-pointer' : 'cursor-default'}
        >
          {star <= fullStars ? (
            <FiStar
              size={size}
              className="text-yellow-400 fill-current"
            />
          ) : (
            <FiStar
              size={size}
              className="text-slate-300"
            />
          )}
        </button>
      ))}
    </div>
  );
};
