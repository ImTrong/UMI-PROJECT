import { useState, useEffect } from 'react';
import { recommendationService } from '../../services/recommendation.service';
import { FiChevronLeft, FiChevronRight, FiStar, FiUsers, FiAward } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { formatVND } from '../../utils/currency';

export default function RecommendationList() {
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scrollIndex, setScrollIndex] = useState(0);

  useEffect(() => {
    fetchRecommendations();
  }, []);

  const fetchRecommendations = async () => {
    try {
      setLoading(true);
      const data = await recommendationService.getPersonalizedRecommendations(6);
      setRecommendations(data);
    } catch (err) {
      console.error('Failed to fetch recommended courses:', err);
    } finally {
      setLoading(false);
    }
  };

  const scrollLeft = () => {
    setScrollIndex((prev) => Math.max(0, prev - 1));
  };

  const scrollRight = () => {
    setScrollIndex((prev) => Math.min(Math.max(0, recommendations.length - 3), prev + 1));
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-10 bg-white rounded-3xl border border-slate-100 shadow-sm">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  if (recommendations.length === 0) return null;

  return (
    <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm relative overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <FiAward className="text-emerald-600 animate-bounce" /> Gợi ý khóa học dành riêng cho bạn
          </h2>
          <p className="text-slate-500 text-xs mt-0.5">Dựa trên hành vi học tập và các thể loại bạn quan tâm</p>
        </div>

        {recommendations.length > 3 && (
          <div className="flex items-center gap-2">
            <button
              onClick={scrollLeft}
              disabled={scrollIndex === 0}
              className="p-1.5 rounded-xl border border-slate-100 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition duration-150 cursor-pointer"
            >
              <FiChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={scrollRight}
              disabled={scrollIndex >= recommendations.length - 3}
              className="p-1.5 rounded-xl border border-slate-100 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition duration-150 cursor-pointer"
            >
              <FiChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Recommendations Carousel */}
      <div className="relative overflow-hidden w-full">
        <div
          className="flex gap-6 transition-transform duration-500 ease-out"
          style={{
            transform: `translateX(-${scrollIndex * (100 / 3 + 2)}%)`,
            width: `${Math.max(100, (recommendations.length / 3) * 100)}%`,
          }}
        >
          {recommendations.map((course) => (
            <div
              key={course.id}
              className="bg-white rounded-2xl border border-slate-100 hover:border-emerald-100 hover:shadow-sm transition-all duration-300 flex flex-col overflow-hidden relative group"
              style={{ width: 'calc(33.333% - 16px)', flexShrink: 0 }}
            >
              {/* Image */}
              <div className="relative h-40 bg-slate-100 overflow-hidden flex-shrink-0">
                {course.thumbnail ? (
                  <img
                    src={course.thumbnail}
                    alt={course.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full bg-emerald-50 flex items-center justify-center text-emerald-400 font-bold text-sm">
                    UMI Course
                  </div>
                )}
                {course.category && (
                  <span className="absolute top-3 left-3 bg-white/95 backdrop-blur-md text-[10px] font-extrabold px-2.5 py-1 rounded-xl text-emerald-600 shadow-sm border border-slate-50">
                    {course.category.name}
                  </span>
                )}
              </div>

              {/* Course Detail Content */}
              <div className="p-4 flex-1 flex flex-col justify-between">
                <div>
                  <h4 className="font-bold text-slate-900 group-hover:text-emerald-600 text-sm leading-snug line-clamp-2 transition-colors">
                    {course.title}
                  </h4>

                  {/* Rating & Enrolled count */}
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500 font-semibold">
                    <span className="flex items-center gap-0.5 text-amber-500">
                      <FiStar className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                      {course.rating.toFixed(1)}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <FiUsers className="w-3.5 h-3.5" />
                      {course.enrolledCount} học viên
                    </span>
                  </div>
                </div>

                <div className="mt-4">
                  {/* Price */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900">
                      {course.price > 0 ? formatVND(course.price) : 'Miễn phí'}
                    </span>
                    <Link
                      to={`/courses/${course.slug}`}
                      className="text-xs font-bold text-emerald-600 hover:text-emerald-700 transition"
                    >
                      Xem chi tiết →
                    </Link>
                  </div>

                  {/* Recommendation Reason tag */}
                  {course.recommendationReason && (
                    <div className="mt-3 pt-2.5 border-t border-slate-50 text-[10px] text-emerald-500 leading-snug font-bold italic">
                      ✨ {course.recommendationReason}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
