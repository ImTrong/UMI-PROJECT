import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FiBook, FiAward, FiClock, FiArrowRight, FiCheckCircle, FiStar } from 'react-icons/fi';
import { useAuth } from '../hooks/useAuth';
import { courseService, Course, Category } from '../services/course.service';
import { recommendationService, HomeRecommendations, RecommendationSection } from '../services/recommendation.service';
import { CourseCard } from '../components/course/CourseCard';
import { CourseCarousel } from '../components/recommendation/CourseCarousel';

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<HomeRecommendations | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);

  // Fetch basic page data (categories, fallback courses)
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [coursesRes, categoriesRes] = await Promise.all([
          courseService.getCourses({ limit: 12, sortBy: 'newest' }),
          courseService.getCategories(true)
        ]);
        setCourses(coursesRes.courses || []);
        setCategories((categoriesRes || []).filter(c => (c._count?.courses || 0) > 0).slice(0, 5));
      } catch (err) {
        console.error('Failed to load homepage data', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Fetch personalized recommendations
  useEffect(() => {
    const fetchRecommendations = async () => {
      try {
        setRecsLoading(true);
        const data = await recommendationService.getHomeRecommendations();
        setRecommendations(data);
      } catch (err) {
        console.error('Failed to load recommendations', err);
      } finally {
        setRecsLoading(false);
      }
    };
    fetchRecommendations();
  }, [isAuthenticated]);

  // Build ordered list of recommendation sections to display
  const getSections = (): RecommendationSection[] => {
    if (!recommendations) return [];
    const sections: RecommendationSection[] = [];

    // Cold start mode (unauthenticated or new user)
    if (recommendations.coldStart && recommendations.coldStart.length > 0) {
      return recommendations.coldStart;
    }

    // Personalized mode
    if (recommendations.continueLearning?.courses?.length) {
      sections.push(recommendations.continueLearning);
    }
    if (recommendations.becauseYouViewed) {
      recommendations.becauseYouViewed.forEach(s => {
        if (s.courses?.length) sections.push(s);
      });
    }
    if (recommendations.forYou?.courses?.length) {
      sections.push(recommendations.forYou);
    }
    if (recommendations.pathBased?.courses?.length) {
      sections.push(recommendations.pathBased);
    }
    if (recommendations.skillUpgrade?.courses?.length) {
      sections.push(recommendations.skillUpgrade);
    }
    if (recommendations.trendingInField?.courses?.length) {
      sections.push(recommendations.trendingInField);
    }
    if (recommendations.learnersLikeYou?.courses?.length) {
      sections.push(recommendations.learnersLikeYou);
    }

    return sections;
  };

  const recSections = getSections();

  return (
    <div className="space-y-16 pb-16">
      {/* Hero Section */}
      <section className="relative pt-12 pb-20 lg:pt-24 lg:pb-32 overflow-hidden bg-white border-b border-slate-100">
        {/* Subtle grid background for modern feel */}
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.015] pointer-events-none"></div>
        <div className="relative max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-12">
          {/* Text Content */}
          <div className="flex-1 text-center lg:text-left z-10">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-slate-800 leading-tight mb-6">
              Học bất cứ điều gì, <br className="hidden md:block" />
              <span className="text-emerald-600">
                bất kỳ lúc nào.
              </span>
            </h1>
            <p className="text-lg md:text-xl text-slate-600 mb-8 max-w-2xl mx-auto lg:mx-0 leading-relaxed">
              Tiếp cận các khóa học chất lượng hàng đầu, học hỏi từ các chuyên gia thực chiến và kiến tạo sự nghiệp với nền tảng giáo dục điện tử toàn diện của chúng tôi.
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start">
              {!isAuthenticated ? (
                <>
                  <Link to="/register" className="w-full sm:w-auto px-8 py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition-all transform hover:-translate-y-0.5 text-lg">
                    Bắt đầu miễn phí
                  </Link>
                  <Link to="/courses" className="w-full sm:w-auto px-8 py-3.5 bg-white text-slate-700 font-bold rounded-xl border border-slate-200 hover:bg-slate-50 transition-all text-lg">
                    Khám phá khóa học
                  </Link>
                </>
              ) : (
                <Link to="/courses" className="w-full sm:w-auto px-8 py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition-all transform hover:-translate-y-0.5 text-lg flex items-center gap-2 justify-center">
                  Tiếp tục học <FiArrowRight />
                </Link>
              )}
            </div>
            
            <div className="mt-10 flex items-center justify-center lg:justify-start gap-6 text-sm font-semibold text-slate-500">
              <div className="flex items-center gap-2"><FiCheckCircle className="text-emerald-500 w-5 h-5" /> 500+ Khóa học</div>
              <div className="flex items-center gap-2"><FiCheckCircle className="text-emerald-500 w-5 h-5" /> Truy cập trọn đời</div>
            </div>
          </div>

          {/* Hero Image */}
          <div className="flex-1 w-full max-w-lg lg:max-w-xl z-10">
            <div className="relative rounded-2xl overflow-hidden border border-slate-100 bg-slate-50 p-1 transform hover:-translate-y-2 transition-transform duration-500">
              <img 
                src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80" 
                alt="Sinh viên đang học tập trực tuyến" 
                className="w-full h-auto rounded-xl object-cover aspect-[4/3]"
              />
              {/* Floating Badge */}
              <div className="absolute -left-4 top-8 bg-white p-3 rounded-xl shadow-sm border border-emerald-50 animate-bounce" style={{ animationDuration: '3s' }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-500"><FiStar className="inline fill-current" /></div>
                  <div>
                    <p className="text-xs text-slate-500 font-medium">Đánh giá trung bình</p>
                    <p className="text-sm font-black text-slate-800">4.8/5.0</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="grid md:grid-cols-3 gap-6 max-w-7xl mx-auto px-4">
        <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm hover:shadow-sm transition-shadow group">
          <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
            <FiBook className="w-6 h-6 text-emerald-600" />
          </div>
          <h3 className="text-xl font-bold text-slate-800 mb-3">Khóa học chất lượng</h3>
          <p className="text-slate-600 leading-relaxed">Được dẫn dắt bởi các chuyên gia trong ngành, bao phủ các công nghệ và kỹ năng đang được săn đón nhất hiện nay.</p>
        </div>
        <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm hover:shadow-sm transition-shadow group">
          <div className="w-14 h-14 bg-teal-50 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
            <FiAward className="w-6 h-6 text-teal-600" />
          </div>
          <h3 className="text-xl font-bold text-slate-800 mb-3">Chứng nhận & Chứng chỉ</h3>
          <p className="text-slate-600 leading-relaxed">Đạt được chứng nhận hoàn thành khóa học và chứng chỉ lộ trình để khẳng định năng lực và thăng tiến trong sự nghiệp của bạn.</p>
        </div>
        <div className="bg-white rounded-2xl p-8 border border-slate-100 shadow-sm hover:shadow-sm transition-shadow group">
          <div className="w-14 h-14 bg-cyan-50 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
            <FiClock className="w-6 h-6 text-cyan-600" />
          </div>
          <h3 className="text-xl font-bold text-slate-800 mb-3">Học theo nhịp độ</h3>
          <p className="text-slate-600 leading-relaxed">Chủ động thời gian học tập với quyền truy cập trọn đời vào video bài giảng và tài liệu thực hành.</p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          PERSONALIZED RECOMMENDATION SECTIONS (Carousel rows)
          ═══════════════════════════════════════════════════════════════════════ */}

      {recsLoading && (
        <section className="max-w-7xl mx-auto px-4 space-y-12">
          {[1, 2, 3].map(i => (
            <div key={i}>
              <div className="h-7 w-60 bg-slate-100 rounded-lg animate-pulse mb-4" />
              <div className="flex gap-6 overflow-hidden">
                {[1, 2, 3, 4].map(j => (
                  <div key={j} className="w-[310px] shrink-0 h-72 bg-slate-50 rounded-2xl animate-pulse border border-slate-100" />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {!recsLoading && recSections.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 space-y-14">
          {recSections.map((section, idx) => (
            <CourseCarousel key={`${section.type}-${idx}`} section={section} />
          ))}
        </div>
      )}

      {/* Fallback: If no recommendations loaded, show default courses */}
      {!recsLoading && recSections.length === 0 && (
        <section className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h2 className="text-3xl font-black text-slate-800 mb-2">Khóa học nổi bật</h2>
              <p className="text-slate-600">Được học viên đánh giá cao và đăng ký nhiều nhất.</p>
            </div>
            <Link to="/courses" className="text-emerald-600 font-bold hover:text-emerald-700 flex items-center gap-1">
              Xem tất cả <FiArrowRight />
            </Link>
          </div>
          
          {loading ? (
            <div className="flex gap-6 overflow-hidden">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="w-[300px] shrink-0 h-80 bg-slate-100 rounded-2xl animate-pulse"></div>
              ))}
            </div>
          ) : (
            <div className="flex overflow-x-auto gap-6 pb-8 hide-scrollbar snap-x snap-mandatory">
              {courses.map((course) => (
                <div key={course.id} className="snap-start shrink-0 w-[300px] md:w-[320px]">
                  <CourseCard course={course} showInstructor />
                </div>
              ))}
              {courses.length === 0 && (
                <div className="w-full text-center py-12 text-slate-500">
                  Chưa có khóa học nào.
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Categories Section */}
      {!loading && categories.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 pt-8">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-black text-slate-800">Lĩnh vực hàng đầu</h2>
          </div>
          <div className="flex overflow-x-auto gap-4 pb-4 hide-scrollbar snap-x snap-mandatory">
            {categories.map((category) => (
              <Link 
                key={category.id}
                to={`/courses?categoryId=${category.id}`}
                className="snap-start shrink-0 group block bg-white border border-slate-100 rounded-2xl p-6 w-64 hover:border-emerald-200 hover:shadow-sm hover:shadow-emerald-50 transition-all cursor-pointer"
              >
                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl font-bold mb-4 group-hover:bg-emerald-100 transition-colors">
                  {category.name.charAt(0)}
                </div>
                <h3 className="font-bold text-slate-800 text-lg mb-1 group-hover:text-emerald-700 transition-colors">{category.name}</h3>
                <p className="text-sm text-slate-500 font-medium">{category._count?.courses || 0} khóa học</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Call to Action */}
      <section className="max-w-5xl mx-auto px-4 py-12">
        <div className="bg-slate-900 rounded-3xl p-10 md:p-14 text-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
          <div className="relative z-10">
            <h2 className="text-3xl md:text-4xl font-black text-white mb-6">Sẵn sàng để bước tiếp?</h2>
            <p className="text-lg text-slate-300 mb-8 max-w-2xl mx-auto">
              Tham gia cùng hàng ngàn học viên khác đã và đang nâng cấp kỹ năng mỗi ngày cùng nền tảng của chúng tôi.
            </p>
            {!isAuthenticated && (
              <Link to="/register" className="inline-block px-8 py-4 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-black rounded-xl transition-colors text-lg">
                Đăng ký tài khoản ngay
              </Link>
            )}
          </div>
        </div>
      </section>

    </div>
  );
}
