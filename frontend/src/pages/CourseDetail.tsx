import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { courseService, Course, Lesson, Review } from '../services/course.service';
import { RatingStars } from '../components/course/RatingStars';
import { ReviewCard } from '../components/course/ReviewCard';
import { useAuth } from '../hooks/useAuth';
import { useFileProtection } from '../hooks/useFileProtection';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '../store';
import { addToCart } from '../store/cartSlice';
import toast from 'react-hot-toast';
import { FiPlay, FiUsers, FiStar, FiBookOpen, FiShoppingCart, FiMessageCircle, FiCreditCard } from 'react-icons/fi';
import { formatVND } from '../utils/currency';
import { orderService } from '../services/order.service';
import { learningService } from '../services/learning.service';

export default function CourseDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const { isAuthenticated, user } = useAuth();
  const [course, setCourse] = useState<Course | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewForm, setReviewForm] = useState({ rating: 0, comment: '' });
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [editingReview, setEditingReview] = useState<Review | null>(null);
  const [ratingDistribution, setRatingDistribution] = useState<Record<number, number>>({});
  const [userReview, setUserReview] = useState<Review | null>(null);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [cartLoading, setCartLoading] = useState(false);
  const [buyNowLoading, setBuyNowLoading] = useState(false);
  const [previewLesson, setPreviewLesson] = useState<Lesson | null>(null);
  const [pdfHeight, setPdfHeight] = useState(2500);

  // Kích hoạt tính năng bảo mật chuột phải, phím tắt và kéo thả khi đang xem thử bài giảng
  const { isDevToolsOpen } = useFileProtection(Boolean(previewLesson));

  const handleAddToCart = async () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    setCartLoading(true);
    try {
      await dispatch(addToCart(course?.id!)).unwrap();
    } catch (error) {
      toast.error('Thêm vào giỏ hàng thất bại');
    } finally {
      setCartLoading(false);
    }
  };

  const handleBuyNow = async () => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    if (!course) return;

    setBuyNowLoading(true);
    try {
      const result = await orderService.createOrder({
        items: [{
          courseId: course.id,
          courseTitle: course.title,
          price: course.price,
        }],
      });
      toast.success('Đang chuyển đến trang thanh toán...');
      navigate(`/checkout/${result.order.id}`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Không thể tiến hành mua ngay');
    } finally {
      setBuyNowLoading(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      if (!slug) return;
      setLoading(true);
      try {
        const courseData = await courseService.getCourseBySlug(slug);
        setCourse(courseData);
        
        const lessonsData = await courseService.getCourseLessons(courseData.id);
        setLessons(lessonsData);
        
        const reviewsData = await courseService.getCourseReviews(courseData.id);
        setReviews(reviewsData.reviews);
        
        const distribution = await courseService.getRatingDistribution(courseData.id);
        setRatingDistribution(distribution);
        
        if (isAuthenticated) {
          try {
            const userReviewData = await courseService.getUserReview(courseData.id);
            setUserReview(userReviewData);
          } catch {
            // Chưa có đánh giá - bỏ qua
          }
          
          try {
            const progress = await learningService.getCourseProgress(courseData.id);
            // Backend trả về 200 với data: null nếu chưa đăng ký
            setIsEnrolled(progress !== null && progress !== undefined);
          } catch {
            setIsEnrolled(false);
          }
        }
      } catch (error) {
        console.error('Lỗi khi tải khóa học:', error);
        toast.error('Không tìm thấy khóa học');
        navigate('/courses');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [slug, isAuthenticated, navigate]);

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      toast.error('Vui lòng đăng nhập để đánh giá');
      navigate('/login');
      return;
    }
    
    try {
      if (editingReview) {
        const updated = await courseService.updateReview(editingReview.id, reviewForm);
        setReviews(reviews.map(r => r.id === updated.id ? updated : r));
        toast.success('Đã cập nhật đánh giá');
      } else {
        const newReview = await courseService.createReview(course!.id, reviewForm);
        setReviews([newReview, ...reviews]);
        toast.success('Gửi đánh giá thành công');
      }
      setReviewForm({ rating: 0, comment: '' });
      setShowReviewForm(false);
      setEditingReview(null);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Không thể gửi đánh giá');
    }
  };

  const handleEditReview = (review: Review) => {
    setEditingReview(review);
    setReviewForm({ rating: review.rating, comment: review.comment || '' });
    setShowReviewForm(true);
  };

  const handleDeleteReview = async (reviewId: string) => {
    if (confirm('Bạn có chắc chắn muốn xóa đánh giá này không?')) {
      try {
        await courseService.deleteReview(reviewId);
        setReviews(reviews.filter(r => r.id !== reviewId));
        toast.success('Đã xóa đánh giá');
      } catch (error) {
        toast.error('Không thể xóa đánh giá');
      }
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!course) return null;

  const totalRatings = Object.values(ratingDistribution).reduce((a, b) => a + b, 0);
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Course Header */}
      <div className="bg-gradient-to-r from-primary-600 to-primary-800 rounded-2xl p-8 text-white mb-8">
        <div className="grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2">
            <h1 className="text-3xl md:text-4xl font-bold mb-4">{course.title}</h1>
            <p className="text-primary-100 mb-4">{course.description}</p>
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center">
                <RatingStars rating={course.rating} size={16} />
                <span className="ml-2">{course.rating.toFixed(1)} ({course.totalReviews} đánh giá)</span>
              </div>
              <div className="flex items-center">
                <FiUsers className="mr-1" />
                <span>{course.enrolledCount} học viên</span>
              </div>
              <div className="flex items-center">
                <FiBookOpen className="mr-1" />
                <span>{lessons.length} bài học</span>
              </div>
            </div>
            <div className="mt-6">
              <span className="text-3xl font-bold">{formatVND(course.price)}</span>
            </div>
            {isEnrolled ? (
              <button 
                onClick={() => navigate(`/learning/${course.id}`)}
                className="mt-4 btn-primary bg-white text-primary-600 hover:bg-slate-100"
              >
                Tiếp tục học
              </button>
            ) : (
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  onClick={handleBuyNow}
                  disabled={buyNowLoading || cartLoading}
                  className="btn-primary bg-white text-primary-600 hover:bg-slate-100 flex items-center space-x-2 border-transparent shadow-md"
                >
                  <FiCreditCard size={18} />
                  <span>{buyNowLoading ? 'Đang xử lý...' : 'Mua ngay'}</span>
                </button>
                <button
                  onClick={handleAddToCart}
                  disabled={cartLoading || buyNowLoading}
                  className="btn-secondary bg-primary-700 text-white hover:bg-primary-800 border-primary-500 flex items-center space-x-2"
                >
                  <FiShoppingCart size={18} />
                  <span>{cartLoading ? 'Đang thêm...' : 'Thêm vào giỏ'}</span>
                </button>
              </div>
            )}
          </div>
          <div className="hidden md:block">
            {course.thumbnail ? (
              <img src={course.thumbnail} alt={course.title} className="rounded-xl shadow-sm" />
            ) : (
              <div className="bg-slate-700 rounded-xl h-48 flex items-center justify-center text-white">
                Ảnh bìa khóa học
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="md:col-span-2 space-y-8">
          {course.whatYouWillLearn && (
            <div className="card">
              <h2 className="text-xl font-semibold mb-4">Bạn sẽ học được gì</h2>
              <p className="text-slate-700">{course.whatYouWillLearn}</p>
            </div>
          )}

          {/* Course Content */}
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Nội dung khóa học</h2>
            <div className="space-y-2">
              {lessons.map((lesson) => (
                <div key={lesson.id} className="flex items-center justify-between p-3 hover:bg-slate-50 rounded-xl">
                  <div className="flex items-center space-x-3">
                    <FiPlay className="text-primary-500" />
                    <div>
                      <p className="font-medium">{lesson.title}</p>
                      {lesson.isPreview && (
                        <span className="text-xs text-primary-600">Xem trước</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <span className="text-sm text-slate-500">
                      {Math.ceil(lesson.duration / 60)} phút
                    </span>
                    {lesson.isPreview && (
                      <button
                        onClick={() => setPreviewLesson(lesson)}
                        className="text-primary-600 text-sm hover:underline"
                      >
                        Xem trước
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Requirements */}
          {course.requirements.length > 0 && (
            <div className="card">
              <h2 className="text-xl font-semibold mb-4">Yêu cầu</h2>
              <ul className="list-disc list-inside space-y-1">
                {course.requirements.map((req, index) => (
                  <li key={index} className="text-slate-700">{req}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Target Audience */}
          {course.targetAudience.length > 0 && (
            <div className="card">
              <h2 className="text-xl font-semibold mb-4">Đối tượng phù hợp</h2>
              <ul className="list-disc list-inside space-y-1">
                {course.targetAudience.map((audience, index) => (
                  <li key={index} className="text-slate-700">{audience}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Reviews Section */}
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Đánh giá từ học viên</h2>
            
            {/* Rating Summary */}
            <div className="flex items-start space-x-8 mb-6">
              <div className="text-center">
                <div className="text-4xl font-bold text-primary-600">{course.rating.toFixed(1)}</div>
                <RatingStars rating={course.rating} size={20} />
                <div className="text-sm text-slate-500 mt-1">{course.totalReviews} lượt đánh giá</div>
              </div>
              <div className="flex-1 space-y-1">
                {[5, 4, 3, 2, 1].map((star) => (
                  <div key={star} className="flex items-center space-x-2">
                    <span className="text-sm w-8">{star} ★</span>
                    <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-yellow-400 rounded-full"
                        style={{
                          width: `${totalRatings > 0 ? (ratingDistribution[star] || 0) / totalRatings * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm text-slate-500 w-12">
                      {ratingDistribution[star] || 0}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Write Review Button */}
            {isAuthenticated && !userReview && !showReviewForm && (
              <button
                onClick={() => setShowReviewForm(true)}
                className="mb-4 btn-primary"
              >
                Viết đánh giá
              </button>
            )}

            {/* Review Form */}
            {(showReviewForm || editingReview) && (
              <form onSubmit={handleReviewSubmit} className="mb-6 p-4 bg-slate-50 rounded-xl">
                <h3 className="font-semibold mb-3">
                  {editingReview ? 'Chỉnh sửa đánh giá' : 'Viết đánh giá của bạn'}
                </h3>
                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">Mức đánh giá</label>
                  <RatingStars
                    rating={reviewForm.rating}
                    size={24}
                    interactive
                    onChange={(rating) => setReviewForm({ ...reviewForm, rating })}
                  />
                </div>
                <div className="mb-3">
                  <label className="block text-sm font-medium mb-1">Bình luận</label>
                  <textarea
                    value={reviewForm.comment}
                    onChange={(e) => setReviewForm({ ...reviewForm, comment: e.target.value })}
                    rows={3}
                    className="input-field"
                    placeholder="Chia sẻ suy nghĩ của bạn về khóa học..."
                  />
                </div>
                <div className="flex space-x-2">
                  <button type="submit" className="btn-primary">
                    {editingReview ? 'Cập nhật' : 'Gửi đánh giá'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowReviewForm(false);
                      setEditingReview(null);
                      setReviewForm({ rating: 0, comment: '' });
                    }}
                    className="btn-secondary"
                  >
                    Hủy
                  </button>
                </div>
              </form>
            )}

            {/* Reviews List */}
            <div className="space-y-4">
              {reviews.length === 0 ? (
                <p className="text-slate-500 text-center py-4">Chưa có đánh giá nào. Hãy là người đầu tiên đánh giá!</p>
              ) : (
                reviews.map((review) => (
                  <ReviewCard
                    key={review.id}
                    review={review}
                    isOwner={user?.id === review.userId}
                    onEdit={() => handleEditReview(review)}
                    onDelete={() => handleDeleteReview(review.id)}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Instructor Info */}
          <div className="card">
            <h3 className="font-semibold mb-3">Giảng viên</h3>
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                <FiStar className="text-primary-600" />
              </div>
              <div>
                <p className="font-medium">Giảng viên phụ trách</p>
                <p className="text-sm text-slate-500">Mã giảng viên: {course.instructorId}</p>
              </div>
            </div>
            {user?.id !== course.instructorId && (
              <button
                onClick={() => {
                  if (!isAuthenticated) {
                    navigate('/login');
                    return;
                  }
                  const event = new CustomEvent('open-chat-session', {
                    detail: {
                      participantId: course.instructorId,
                      courseId: course.id,
                      courseTitle: course.title
                    }
                  });
                  window.dispatchEvent(event);
                }}
                className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2 border border-primary-600 text-primary-600 bg-white hover:bg-primary-50 rounded-xl font-semibold text-sm transition-all shadow-sm cursor-pointer"
              >
                <FiMessageCircle size={16} />
                <span>Nhắn tin cho giảng viên</span>
              </button>
            )}
          </div>

          {/* Course Features */}
          <div className="card">
            <h3 className="font-semibold mb-3">Đặc điểm khóa học</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-600">Trình độ</span>
                <span className="font-medium">
                  {course.level === 'BEGINNER' ? 'Người mới' : 
                   course.level === 'INTERMEDIATE' ? 'Trung cấp' : 'Nâng cao'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Ngôn ngữ</span>
                <span className="font-medium">
                  {course.language === 'English' ? 'Tiếng Anh' : 
                   course.language === 'Vietnamese' ? 'Tiếng Việt' : course.language}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Số bài học</span>
                <span className="font-medium">{lessons.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Thời lượng</span>
                <span className="font-medium">
                  {(() => {
                    const totalSeconds = lessons.reduce((sum, l) => sum + l.duration, 0);
                    const hours = Math.floor(totalSeconds / 3600);
                    const minutes = Math.ceil((totalSeconds % 3600) / 60);
                    if (hours > 0 && minutes > 0) return `${hours} giờ ${minutes} phút`;
                    if (hours > 0) return `${hours} giờ`;
                    return `${minutes} phút`;
                  })()}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {previewLesson && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-4xl overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <p className="text-xs text-primary-600 font-semibold uppercase">Video học thử</p>
                <h3 className="font-semibold text-slate-900">{previewLesson.title}</h3>
              </div>
              <button
                onClick={() => setPreviewLesson(null)}
                className="text-slate-500 hover:text-slate-700 text-sm font-medium"
              >
                Đóng
              </button>
            </div>

            <div className="bg-black relative select-none flex items-center justify-center min-h-[50vh]">
              {isDevToolsOpen ? (
                <div className="p-8 text-center max-w-md w-full bg-slate-900 border border-red-900/30 rounded-2xl shadow-sm mx-4 my-8">
                  <div className="w-12 h-12 bg-red-950/40 text-red-500 rounded-xl flex items-center justify-center mx-auto mb-4 border border-red-500/20 shadow-inner">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2 tracking-tight">Học thử đã bị khóa</h3>
                  <p className="text-slate-400 text-xs leading-relaxed mb-6">
                    Để xem trước tài nguyên học thử bài giảng, bạn cần đóng Developer Tools (phím inspect) trước khi tiếp tục.
                  </p>
                  <button 
                    onClick={() => setPreviewLesson(null)}
                    className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition duration-200"
                  >
                    Đóng xem thử
                  </button>
                </div>
              ) : previewLesson.videoUrl.toLowerCase().endsWith('.pdf') ? (
                <div className="flex flex-col bg-white w-full">
                  <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b select-none">
                    <span className="text-xs text-slate-500 font-medium">Bảo mật tài liệu (Cuộn chuột để xem)</span>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setPdfHeight(Math.max(1000, pdfHeight - 1000))} 
                        disabled={pdfHeight <= 1000}
                        className="px-2 py-1 text-xs bg-white border border-slate-100 rounded hover:bg-slate-100 disabled:opacity-50 font-medium text-slate-700 transition"
                      >
                        Thu nhỏ
                      </button>
                      <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded">
                        Chiều cao: {pdfHeight}px
                      </span>
                      <button 
                        onClick={() => setPdfHeight(Math.min(8000, pdfHeight + 1000))}
                        disabled={pdfHeight >= 8000}
                        className="px-2 py-1 text-xs bg-white border border-slate-100 rounded hover:bg-slate-100 disabled:opacity-50 font-medium text-slate-700 transition"
                      >
                        Mở rộng
                      </button>
                    </div>
                  </div>
                  <div className="w-full h-[65vh] overflow-y-auto bg-slate-100 relative">
                    <iframe
                      src={`${previewLesson.videoUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                      title={previewLesson.title}
                      className="w-full block"
                      style={{ pointerEvents: 'none', height: `${pdfHeight}px`, border: 'none' }}
                    />
                  </div>
                </div>
              ) : (
                <video
                  src={previewLesson.videoUrl}
                  controls
                  controlsList="nodownload nofullscreen"
                  onContextMenu={(e) => e.preventDefault()}
                  onDragStart={(e) => e.preventDefault()}
                  autoPlay
                  className="w-full max-h-[70vh]"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
