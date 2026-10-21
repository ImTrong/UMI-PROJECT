import { FiStar } from 'react-icons/fi';

interface RatingStarsProps {
  rating: number;
  size?: number;
  interactive?: boolean;
  onChange?: (rating: number) => void;
}

export const RatingStars = ({ rating, size = 20, interactive = false, onChange }: RatingStarsProps) => {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating - fullStars >= 0.25 && rating - fullStars < 0.75;
  const adjustedFull = rating - fullStars >= 0.75 ? fullStars + 1 : fullStars;

  const handleClick = (value: number) => {
    if (interactive && onChange) {
      onChange(value);
    }
  };

  return (
    <div className="flex items-center">
      {[1, 2, 3, 4, 5].map((star) => {
        const isFull = star <= adjustedFull;
        const isHalf = !isFull && hasHalfStar && star === adjustedFull + 1;

        return (
          <button
            key={star}
            type="button"
            onClick={() => handleClick(star)}
            disabled={!interactive}
            className={`relative ${interactive ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default'}`}
          >
            {isFull ? (
              <FiStar
                size={size}
                className="text-yellow-400 fill-current"
              />
            ) : isHalf ? (
              <span className="relative inline-block" style={{ width: size, height: size }}>
                <FiStar size={size} className="text-slate-300 absolute top-0 left-0" />
                <span className="absolute top-0 left-0 overflow-hidden" style={{ width: size / 2 }}>
                  <FiStar size={size} className="text-yellow-400 fill-current" />
                </span>
              </span>
            ) : (
              <FiStar
                size={size}
                className="text-slate-300"
              />
            )}
          </button>
        );
      })}
    </div>
  );
};
