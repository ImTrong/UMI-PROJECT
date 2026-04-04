import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Home() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <section className="text-center py-12">
        <h1 className="text-5xl font-bold text-gray-900 mb-4">
          Học bất cứ điều gì, <span className="text-primary-600">bất kỳ lúc nào</span>
        </h1>
        <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
          Tiếp cận các khóa học chất lượng hàng đầu, học hỏi từ các chuyên gia và phát triển sự nghiệp với nền tảng giáo dục điện tử toàn diện của chúng tôi.
        </p>
        {!isAuthenticated && (
          <Link to="/register" className="btn-primary text-lg px-8 py-3">
            Bắt đầu miễn phí
          </Link>
        )}
      </section>

      {/* Features Section */}
      <section className="grid md:grid-cols-3 gap-8">
        <div className="card text-center">
          <div className="text-4xl mb-4">📚</div>
          <h3 className="text-xl font-semibold mb-2">Khóa học chất lượng</h3>
          <p className="text-gray-600">Các khóa học được dẫn dắt bởi chuyên gia, bao phủ các công nghệ và kỹ năng mới nhất.</p>
        </div>
        <div className="card text-center">
          <div className="text-4xl mb-4">🎓</div>
          <h3 className="text-xl font-semibold mb-2">Chứng chỉ uy tín</h3>
          <p className="text-gray-600">Đạt được chứng chỉ sau khi hoàn thành khóa học để chứng minh năng lực của bạn.</p>
        </div>
        <div className="card text-center">
          <div className="text-4xl mb-4">💡</div>
          <h3 className="text-xl font-semibold mb-2">Học theo nhịp độ của bạn</h3>
          <p className="text-gray-600">Linh hoạt học tập tự định hướng với quyền truy cập trọn đời vào tài liệu ôn tập.</p>
        </div>
      </section>

      {/* Stats Section */}
      <section className="bg-primary-50 rounded-2xl p-8">
        <div className="grid md:grid-cols-3 gap-8 text-center">
          <div>
            <div className="text-3xl font-bold text-primary-600">100+</div>
            <div className="text-gray-600 mt-1">Chuyên gia giảng dạy</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-primary-600">500+</div>
            <div className="text-gray-600 mt-1">Khóa học phong phú</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-primary-600">10,000+</div>
            <div className="text-gray-600 mt-1">Học viên hoạt động</div>
          </div>
        </div>
      </section>
    </div>
  );
}
