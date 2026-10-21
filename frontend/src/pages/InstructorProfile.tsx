import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { courseService, Course, Review } from '../services/course.service';
import { userService, InstructorPublicProfile } from '../services/user.service';
import { CourseCard } from '../components/course/CourseCard';
import { ReviewCard } from '../components/course/ReviewCard';
import { RatingStars } from '../components/course/RatingStars';
import { FiUsers, FiStar, FiBookOpen, FiMessageSquare, FiMapPin, FiBriefcase, FiChevronDown, FiChevronUp, FiBook } from 'react-icons/fi';

interface InstructorStats {
  totalCourses: number;
  totalStudents: number;
  totalReviews: number;
  averageRating: number;
}

export default function InstructorProfile() {
  const { instructorId } = useParams<{ instructorId: string }>();
  const [profile, setProfile] = useState<InstructorPublicProfile | null>(null);
  const [stats, setStats] = useState<InstructorStats | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [reviews, setReviews] = useState<(Review & { course?: { title: string; slug: string } })[]>([]);
  const [ratingDistribution, setRatingDistribution] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewPagination, setReviewPagination] = useState<any>(null);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      if (!instructorId) return;
      setLoading(true);
      setError(null);

      try {
        const [profileData, statsData, coursesData, reviewsData, distData] = await Promise.all([
          userService.getPublicProfile(instructorId),
          courseService.getInstructorStats(instructorId),
          courseService.getInstructorPublicCourses(instructorId, 1, 20),
          courseService.getInstructorReviews(instructorId, 1, 10),
          courseService.getInstructorRatingDistribution(instructorId),
        ]);

        setProfile(profileData);
        setStats(statsData);
        setCourses(coursesData.courses);
        setReviews(reviewsData.reviews);
        setReviewPagination(reviewsData.pagination);
        setRatingDistribution(distData);
      } catch (err: any) {
        console.error('Failed to load instructor profile:', err);
        setError('Không thể tải thông tin giảng viên');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [instructorId]);

  const loadMoreReviews = async () => {
    if (!instructorId || reviewsLoading) return;
    setReviewsLoading(true);
    try {
      const nextPage = reviewPage + 1;
      const data = await courseService.getInstructorReviews(instructorId, nextPage, 10);
      setReviews(prev => [...prev, ...data.reviews]);
      setReviewPagination(data.pagination);
      setReviewPage(nextPage);
    } catch {
      // ignore
    } finally {
      setReviewsLoading(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[500px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-slate-500 text-sm">Đang tải thông tin giảng viên...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !profile) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <FiUsers className="w-8 h-8 text-slate-400" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">Không tìm thấy giảng viên</h2>
        <p className="text-slate-500 mb-6">{error || 'Giảng viên này không tồn tại hoặc đã bị xóa.'}</p>
        <Link to="/courses" className="btn-primary">
          Khám phá khóa học
        </Link>
      </div>
    );
  }

  const currentJob = profile.work?.find(w => w.current) || profile.work?.[0];
  const totalRatings = Object.values(ratingDistribution).reduce((a, b) => a + b, 0);
  const bioIsLong = profile.bio && profile.bio.length > 300;

  return (
    <div className="min-h-screen bg-slate-50/50">
      {/* Hero Header */}
      <div className="relative bg-gradient-to-br from-slate-900 via-slate-800 to-primary-900 overflow-hidden">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 right-0 w-96 h-96 bg-primary-400 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl"></div>
          <div className="absolute bottom-0 left-0 w-72 h-72 bg-primary-500 rounded-full translate-y-1/2 -translate-x-1/3 blur-3xl"></div>
        </div>

        <div className="relative max-w-6xl mx-auto px-4 py-12 md:py-16">
          <div className="flex flex-col md:flex-row items-center md:items-end gap-6 md:gap-8">
            {/* Avatar */}
            <div className="shrink-0">
              {profile.avatar ? (
                <img
                  src={profile.avatar}
                  alt={profile.fullName}
                  className="w-28 h-28 md:w-36 md:h-36 rounded-2xl object-cover border-4 border-white/20 shadow-2xl"
                />
              ) : (
                <div className="w-28 h-28 md:w-36 md:h-36 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-4xl md:text-5xl border-4 border-white/20 shadow-2xl">
                  {profile.fullName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="text-center md:text-left flex-1 pb-1">
              <div className="inline-flex items-center gap-1.5 bg-primary-500/20 text-primary-300 px-3 py-1 rounded-full text-xs font-semibold mb-3 border border-primary-500/20">
                <FiBriefcase size={12} />
                Giảng viên
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">{profile.fullName}</h1>
              {currentJob && (
                <p className="text-primary-200 text-lg font-medium">
                  {currentJob.position}
                  {currentJob.company && <span className="text-primary-300"> tại {currentJob.company}</span>}
                </p>
              )}
              {currentJob?.location && (
                <p className="text-slate-400 text-sm mt-1 flex items-center justify-center md:justify-start gap-1">
                  <FiMapPin size={14} />
                  {currentJob.location}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="bg-white border-b border-slate-100 shadow-sm">
          <div className="max-w-6xl mx-auto px-4">
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-slate-100">
              <div className="py-5 md:py-6 text-center">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <FiUsers className="text-primary-500" size={18} />
                  <span className="text-2xl font-bold text-slate-900">{stats.totalStudents.toLocaleString()}</span>
                </div>
                <span className="text-xs text-slate-500 font-medium">Tổng học viên</span>
              </div>
              <div className="py-5 md:py-6 text-center">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <FiMessageSquare className="text-amber-500" size={18} />
                  <span className="text-2xl font-bold text-slate-900">{stats.totalReviews.toLocaleString()}</span>
                </div>
                <span className="text-xs text-slate-500 font-medium">Đánh giá</span>
              </div>
              <div className="py-5 md:py-6 text-center">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <FiStar className="text-yellow-400 fill-yellow-400" size={18} />
                  <span className="text-2xl font-bold text-slate-900">{stats.averageRating.toFixed(1)}</span>
                </div>
                <span className="text-xs text-slate-500 font-medium">Rating trung bình</span>
              </div>
              <div className="py-5 md:py-6 text-center">
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <FiBookOpen className="text-emerald-500" size={18} />
                  <span className="text-2xl font-bold text-slate-900">{stats.totalCourses}</span>
                </div>
                <span className="text-xs text-slate-500 font-medium">Khóa học</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-8 md:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Bio & Education */}
          <div className="lg:col-span-1 space-y-6">
            {/* About */}
            {profile.bio && (
              <div className="card">
                <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
                  <FiBook size={18} className="text-primary-500" />
                  Giới thiệu về tôi
                </h2>
                <div className={`text-sm text-slate-600 leading-relaxed whitespace-pre-line ${!bioExpanded && bioIsLong ? 'line-clamp-6' : ''}`}>
                  {profile.bio}
                </div>
                {bioIsLong && (
                  <button
                    onClick={() => setBioExpanded(!bioExpanded)}
                    className="mt-2 text-primary-600 text-sm font-medium flex items-center gap-1 hover:text-primary-700 transition-colors"
                  >
                    {bioExpanded ? (
                      <>Thu gọn <FiChevronUp size={14} /></>
                    ) : (
                      <>Xem thêm <FiChevronDown size={14} /></>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Education */}
            {profile.education && profile.education.length > 0 && (
              <div className="card">
                <h2 className="text-lg font-bold text-slate-900 mb-3">Học vấn</h2>
                <div className="space-y-3">
                  {profile.education.map(edu => (
                    <div key={edu.id} className="flex gap-3">
                      <div className="w-2 h-2 bg-primary-400 rounded-full mt-2 shrink-0"></div>
                      <div>
                        <p className="font-semibold text-slate-900 text-sm">{edu.degree} — {edu.fieldOfStudy}</p>
                        <p className="text-xs text-slate-500">{edu.institution}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {new Date(edu.startDate).getFullYear()} — {edu.endDate ? new Date(edu.endDate).getFullYear() : 'Hiện tại'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Work Experience */}
            {profile.work && profile.work.length > 0 && (
              <div className="card">
                <h2 className="text-lg font-bold text-slate-900 mb-3">Kinh nghiệm</h2>
                <div className="space-y-3">
                  {profile.work.map(job => (
                    <div key={job.id} className="flex gap-3">
                      <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${job.current ? 'bg-emerald-400' : 'bg-slate-300'}`}></div>
                      <div>
                        <p className="font-semibold text-slate-900 text-sm">{job.position}</p>
                        <p className="text-xs text-slate-500">
                          {job.company}
                          {job.location && <span> · {job.location}</span>}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {new Date(job.startDate).getFullYear()} — {job.current ? 'Hiện tại' : job.endDate ? new Date(job.endDate).getFullYear() : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Courses & Reviews */}
          <div className="lg:col-span-2 space-y-8">
            {/* Courses */}
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                <FiBookOpen size={20} className="text-primary-500" />
                Các khóa học ({courses.length})
              </h2>
              {courses.length === 0 ? (
                <div className="card text-center py-10">
                  <FiBookOpen className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500">Giảng viên chưa có khóa học nào</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {courses.map(course => (
                    <CourseCard key={course.id} course={course} />
                  ))}
                </div>
              )}
            </div>

            {/* Reviews Section */}
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                <FiStar size={20} className="text-amber-500" />
                Đánh giá tổng hợp
              </h2>

              {/* Rating Summary */}
              {stats && stats.totalReviews > 0 && (
                <div className="card mb-6">
                  <div className="flex flex-col sm:flex-row items-start gap-6">
                    <div className="text-center sm:text-left shrink-0">
                      <div className="text-5xl font-bold text-primary-600">{stats.averageRating.toFixed(1)}</div>
                      <RatingStars rating={stats.averageRating} size={22} />
                      <div className="text-sm text-slate-500 mt-1">{stats.totalReviews} đánh giá</div>
                      <div className="text-xs text-slate-400 mt-0.5">từ {stats.totalCourses} khóa học</div>
                    </div>
                    <div className="flex-1 space-y-1.5 w-full">
                      {[5, 4, 3, 2, 1].map((star) => {
                        const count = ratingDistribution[star] || 0;
                        const pct = totalRatings > 0 ? (count / totalRatings) * 100 : 0;
                        return (
                          <div key={star} className="flex items-center gap-2">
                            <span className="text-sm w-8 text-right font-medium text-slate-600">{star} ★</span>
                            <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-yellow-400 to-amber-400 rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-sm text-slate-500 w-10 text-right">{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Reviews List */}
              {reviews.length === 0 ? (
                <div className="card text-center py-10">
                  <FiMessageSquare className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500">Chưa có đánh giá nào</p>
                </div>
              ) : (
                <div className="card">
                  <div className="divide-y divide-slate-50">
                    {reviews.map(review => (
                      <ReviewCard
                        key={review.id}
                        review={review}
                        showCourseName
                      />
                    ))}
                  </div>

                  {/* Load More */}
                  {reviewPagination && reviewPagination.page < reviewPagination.totalPages && (
                    <div className="mt-4 text-center">
                      <button
                        onClick={loadMoreReviews}
                        disabled={reviewsLoading}
                        className="btn-secondary text-sm"
                      >
                        {reviewsLoading ? 'Đang tải...' : 'Xem thêm đánh giá'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
