import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { courseService, Course, Lesson, Review } from '../services/course.service';
import { RatingStars } from '../components/course/RatingStars';
import { ReviewCard } from '../components/course/ReviewCard';
import { useAuth } from '../hooks/useAuth';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '../store';
import { addToCart } from '../store/cartSlice';
import toast from 'react-hot-toast';
import { FiPlay, FiUsers, FiStar, FiBookOpen, FiShoppingCart } from 'react-icons/fi';

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
  const [isEnrolled] = useState(false);
  const [cartLoading, setCartLoading] = useState(false);

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
          const userReviewData = await courseService.getUserReview(courseData.id);
          setUserReview(userReviewData);
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
              <span className="text-3xl font-bold">${course.price}</span>
            </div>
            {isEnrolled ? (
              <button className="mt-4 btn-primary bg-white text-primary-600 hover:bg-gray-100">
                Tiếp tục học
              </button>
            ) : (
              <button
                onClick={handleAddToCart}
                disabled={cartLoading}
                className="mt-4 btn-primary bg-white text-primary-600 hover:bg-gray-100 flex items-center space-x-2"
              >
                <FiShoppingCart size={18} />
                <span>{cartLoading ? 'Đang thêm...' : 'Thêm vào giỏ'}</span>
              </button>
            )}
          </div>
          <div className="hidden md:block">
            {course.thumbnail ? (
              <img src={course.thumbnail} alt={course.title} className="rounded-lg shadow-lg" />
            ) : (
              <div className="bg-gray-700 rounded-lg h-48 flex items-center justify-center text-white">
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
              <p className="text-gray-700">{course.whatYouWillLearn}</p>
            </div>
          )}

          {/* Course Content */}
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Nội dung khóa học</h2>
            <div className="space-y-2">
              {lessons.map((lesson) => (
                <div key={lesson.id} className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg">
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
                    <span className="text-sm text-gray-500">
                      {Math.floor(lesson.duration / 60)}:{(lesson.duration % 60).toString().padStart(2, '0')}
                    </span>
                    {lesson.isPreview && (
                      <button className="text-primary-600 text-sm hover:underline">
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
                  <li key={index} className="text-gray-700">{req}</li>
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
                  <li key={index} className="text-gray-700">{audience}</li>
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
                <div className="text-sm text-gray-500 mt-1">{course.totalReviews} lượt đánh giá</div>
              </div>
              <div className="flex-1 space-y-1">
                {[5, 4, 3, 2, 1].map((star) => (
                  <div key={star} className="flex items-center space-x-2">
                    <span className="text-sm w-8">{star} ★</span>
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-yellow-400 rounded-full"
                        style={{
                          width: `${totalRatings > 0 ? (ratingDistribution[star] || 0) / totalRatings * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm text-gray-500 w-12">
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
              <form onSubmit={handleReviewSubmit} className="mb-6 p-4 bg-gray-50 rounded-lg">
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
                <p className="text-gray-500 text-center py-4">Chưa có đánh giá nào. Hãy là người đầu tiên đánh giá!</p>
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
                <p className="text-sm text-gray-500">Mã giảng viên: {course.instructorId}</p>
              </div>
            </div>
          </div>

          {/* Course Features */}
          <div className="card">
            <h3 className="font-semibold mb-3">Đặc điểm khóa học</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Trình độ</span>
                <span className="font-medium">
                  {course.level === 'BEGINNER' ? 'Người mới' : 
                   course.level === 'INTERMEDIATE' ? 'Trung cấp' : 'Nâng cao'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Ngôn ngữ</span>
                <span className="font-medium">
                  {course.language === 'English' ? 'Tiếng Anh' : 
                   course.language === 'Vietnamese' ? 'Tiếng Việt' : course.language}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Số bài học</span>
                <span className="font-medium">{lessons.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Thời lượng</span>
                <span className="font-medium">
                  {Math.floor(lessons.reduce((sum, l) => sum + l.duration, 0) / 3600)} giờ
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
