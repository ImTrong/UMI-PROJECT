import { useRef, useState, useEffect } from 'react';
import { FiChevronLeft, FiChevronRight, FiArrowRight } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { RecommendationSection } from '../../services/recommendation.service';
import { CourseCard } from '../course/CourseCard';
import { ContinueLearningCard } from './ContinueLearningCard';

interface CourseCarouselProps {
  section: RecommendationSection;
  icon?: string;
}

export const CourseCarousel = ({ section, icon }: CourseCarouselProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setCanScrollLeft(scrollLeft > 5);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 5);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener('scroll', checkScroll, { passive: true });
      window.addEventListener('resize', checkScroll);
      return () => {
        el.removeEventListener('scroll', checkScroll);
        window.removeEventListener('resize', checkScroll);
      };
    }
  }, [section.courses]);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const cardWidth = 320;
    const gap = 24;
    const scrollAmount = (cardWidth + gap) * 2;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  if (!section.courses.length) return null;

  const isContinueLearning = section.type === 'CONTINUE_LEARNING';

  const sectionIcons: Record<string, string> = {
    'CONTINUE_LEARNING': '📚',
    'BECAUSE_YOU_VIEWED': '👀',
    'FOR_YOU': '🎯',
    'PATH_BASED': '🗺️',
    'SKILL_UPGRADE': '📈',
    'TRENDING_IN_FIELD': '🔥',
    'COLLABORATIVE_FILTERING': '👥',
    'POPULAR': '🔥',
    'TOP_RATED': '⭐',
    'NEWEST': '🆕',
  };

  const displayIcon = icon || sectionIcons[section.type] || '📚';

  return (
    <section className="relative group/section">
      {/* Header */}
      <div className="flex items-end justify-between mb-5">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <span className="text-xl">{displayIcon}</span>
            <h2 className="text-xl md:text-2xl font-black text-slate-800">{section.title}</h2>
          </div>
          {section.subtitle && (
            <p className="text-sm text-slate-500 ml-9">{section.subtitle}</p>
          )}
        </div>
        <Link
          to="/courses"
          className="hidden sm:flex items-center gap-1 text-sm font-bold text-emerald-600 hover:text-emerald-700 transition-colors shrink-0"
        >
          Xem tất cả <FiArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Carousel Container */}
      <div className="relative">
        {/* Left Arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute -left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-white border border-slate-200 rounded-full flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105 transition-all opacity-0 group-hover/section:opacity-100"
            aria-label="Scroll left"
          >
            <FiChevronLeft className="w-5 h-5 text-slate-700" />
          </button>
        )}

        {/* Cards Container */}
        <div
          ref={scrollRef}
          className="flex gap-6 overflow-x-auto pb-4 hide-scrollbar snap-x snap-mandatory scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {section.courses.map((course) => (
            <div
              key={course.id}
              className="snap-start shrink-0 w-[280px] md:w-[300px] lg:w-[310px]"
            >
              {isContinueLearning ? (
                <ContinueLearningCard course={course} />
              ) : (
                <CourseCard
                  course={{
                    id: course.id,
                    title: course.title,
                    slug: course.slug,
                    description: course.recommendationReason || '',
                    instructorId: '',
                    price: course.price,
                    thumbnail: course.thumbnail,
                    level: (course.level as any) || 'BEGINNER',
                    language: 'Vietnamese',
                    requirements: [],
                    targetAudience: [],
                    published: true,
                    rating: course.rating || 0,
                    totalReviews: course.totalReviews || 0,
                    enrolledCount: course.enrolledCount || 0,
                    createdAt: '',
                    updatedAt: '',
                    category: course.category ? { id: course.category.id, name: course.category.name, slug: '' } : undefined,
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Right Arrow */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-white border border-slate-200 rounded-full flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105 transition-all opacity-0 group-hover/section:opacity-100"
            aria-label="Scroll right"
          >
            <FiChevronRight className="w-5 h-5 text-slate-700" />
          </button>
        )}

        {/* Gradient fades */}
        {canScrollLeft && (
          <div className="absolute left-0 top-0 bottom-4 w-12 bg-gradient-to-r from-white to-transparent pointer-events-none z-[1]" />
        )}
        {canScrollRight && (
          <div className="absolute right-0 top-0 bottom-4 w-12 bg-gradient-to-l from-white to-transparent pointer-events-none z-[1]" />
        )}
      </div>
    </section>
  );
};
