import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { userService } from '../services/user.service';
import { updateUser } from '../store/authSlice';
import toast from 'react-hot-toast';
import {
  FiBriefcase,
  FiUser,
  FiCheckCircle,
  FiInfo,
  FiAward,
  FiBookOpen,
  FiPhone,
  FiMapPin,
  FiFileText,
  FiStar,
  FiArrowRight,
  FiArrowLeft,
  FiShield,
} from 'react-icons/fi';

const STEPS = [
  { id: 'INTRO', title: 'Giới thiệu', icon: FiInfo },
  { id: 'INFO', title: 'Thông tin', icon: FiUser },
  { id: 'CONFIRM', title: 'Xác nhận', icon: FiShield },
  { id: 'SUCCESS', title: 'Hoàn tất', icon: FiCheckCircle },
];

export default function BecomeInstructor() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const user = useSelector((state: any) => state.auth.user);

  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({
    bio: '',
    phoneNumber: '',
    address: '',
    expertise: '',
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // If already instructor, redirect
  if (user?.role === 'INSTRUCTOR') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-white to-teal-50 py-16 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <div className="bg-white rounded-3xl shadow-sm p-12">
            <div className="bg-green-100 text-green-600 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
              <FiCheckCircle size={40} />
            </div>
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Bạn đã là Giảng viên!</h2>
            <p className="text-slate-600 mb-8">
              Tài khoản của bạn đã có quyền giảng viên. Hãy bắt đầu tạo khóa học ngay.
            </p>
            <button
              onClick={() => navigate('/instructor/courses')}
              className="btn-primary px-8 py-3 rounded-xl text-lg font-semibold"
            >
              Truy cập Quản lý Khóa học
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleNextStep = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.bio.trim()) {
      newErrors.bio = 'Vui lòng nhập giới thiệu bản thân';
    } else if (formData.bio.trim().length < 20) {
      newErrors.bio = 'Giới thiệu phải có ít nhất 20 ký tự';
    }

    if (!formData.phoneNumber.trim()) {
      newErrors.phoneNumber = 'Vui lòng nhập số điện thoại';
    }

    if (!formData.expertise.trim()) {
      newErrors.expertise = 'Vui lòng nhập lĩnh vực chuyên môn';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInfoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      handleNextStep();
    }
  };

  const handleConfirmSubmit = async () => {
    setLoading(true);
    try {
      const response = await userService.becomeInstructor({
        bio: formData.bio,
        phoneNumber: formData.phoneNumber,
        address: formData.address,
        expertise: formData.expertise,
      });

      if (response?.data) {
        dispatch(updateUser({ role: 'INSTRUCTOR' }));
        setCurrentStep(3); // Success step
        toast.success('Xin chúc mừng! Bạn đã trở thành Giảng viên.');
      }
    } catch (error: any) {
      const errorMsg =
        error.response?.data?.error || 'Có lỗi xảy ra. Vui lòng thử lại sau.';
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      // ========== STEP 0: GIỚI THIỆU ==========
      case 0:
        return (
          <div className="space-y-8 animate-fadeIn">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-primary-500 to-teal-600 rounded-2xl text-white mb-6 shadow-sm">
                <FiAward size={36} />
              </div>
              <h2 className="text-3xl font-extrabold text-slate-900 mb-3">
                Chia sẻ kiến thức, Xây dựng tương lai
              </h2>
              <p className="text-slate-500 text-lg max-w-2xl mx-auto">
                Trở thành giảng viên của UMI và giúp hàng ngàn người thay đổi cuộc sống thông qua giáo dục trực tuyến.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-5">
              {[
                {
                  icon: FiBookOpen,
                  title: 'Giảng dạy theo cách của bạn',
                  desc: 'Tự do sáng tạo nội dung và lịch trình giảng dạy phù hợp với phong cách của bạn.',
                  color: 'from-cyan-500 to-cyan-500',
                  bg: 'bg-cyan-50',
                  border: 'border-cyan-100',
                },
                {
                  icon: FiBriefcase,
                  title: 'Tăng thêm thu nhập',
                  desc: 'Kiếm tiền từ mỗi học viên đăng ký khóa học. Thu nhập không giới hạn.',
                  color: 'from-green-500 to-emerald-500',
                  bg: 'bg-green-50',
                  border: 'border-green-100',
                },
                {
                  icon: FiStar,
                  title: 'Xây dựng thương hiệu cá nhân',
                  desc: 'Trở thành chuyên gia được công nhận trong lĩnh vực của bạn.',
                  color: 'from-amber-500 to-orange-500',
                  bg: 'bg-amber-50',
                  border: 'border-amber-100',
                },
                {
                  icon: FiShield,
                  title: 'Hỗ trợ kỹ thuật toàn diện',
                  desc: 'Đội ngũ UMI luôn sẵn sàng hỗ trợ bạn về mặt kỹ thuật và vận hành.',
                  color: 'from-teal-500 to-pink-500',
                  bg: 'bg-teal-50',
                  border: 'border-teal-100',
                },
              ].map((item, idx) => (
                <div
                  key={idx}
                  className={`flex items-start space-x-4 p-5 rounded-2xl ${item.bg} border ${item.border} hover:shadow-sm transition-all duration-300 hover:-translate-y-0.5`}
                >
                  <div className={`bg-gradient-to-br ${item.color} p-3 rounded-xl text-white flex-shrink-0 shadow-sm`}>
                    <item.icon size={22} />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-lg mb-1">{item.title}</h3>
                    <p className="text-slate-600 text-sm leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="text-center pt-4">
              <button
                onClick={handleNextStep}
                className="btn-primary px-10 py-4 text-lg rounded-2xl shadow-sm hover:shadow-sm transition-all duration-300 inline-flex items-center space-x-2 font-bold"
              >
                <span>Bắt đầu đăng ký</span>
                <FiArrowRight size={20} />
              </button>
            </div>
          </div>
        );

      // ========== STEP 1: THÔNG TIN CÁ NHÂN ==========
      case 1:
        return (
          <form onSubmit={handleInfoSubmit} className="space-y-6 animate-fadeIn">
            <div className="text-center mb-2">
              <h3 className="text-2xl font-bold text-slate-900 flex items-center justify-center">
                <FiUser className="mr-2 text-primary-600" /> Thông tin của bạn
              </h3>
              <p className="text-slate-500 mt-1">Vui lòng cung cấp thông tin để hoàn tất đăng ký</p>
            </div>

            <div className="space-y-5">
              {/* Bio */}
              <div>
                <label className="flex items-center text-sm font-semibold text-slate-700 mb-2">
                  <FiFileText className="mr-2 text-primary-500" />
                  Giới thiệu bản thân <span className="text-red-500 ml-1">*</span>
                </label>
                <textarea
                  rows={4}
                  className={`w-full input resize-none ${errors.bio ? 'border-red-400 focus:ring-red-300' : ''}`}
                  placeholder="Giới thiệu về bản thân, kinh nghiệm giảng dạy, và những gì bạn muốn chia sẻ..."
                  value={formData.bio}
                  onChange={(e) => {
                    setFormData({ ...formData, bio: e.target.value });
                    if (errors.bio) setErrors({ ...errors, bio: '' });
                  }}
                />
                {errors.bio && (
                  <p className="text-red-500 text-sm mt-1 flex items-center">
                    <span className="w-1 h-1 bg-red-500 rounded-full mr-2"></span>
                    {errors.bio}
                  </p>
                )}
                <p className="text-xs text-slate-400 mt-1">
                  {formData.bio.length}/20 ký tự tối thiểu
                </p>
              </div>

              {/* Phone + Expertise */}
              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <label className="flex items-center text-sm font-semibold text-slate-700 mb-2">
                    <FiPhone className="mr-2 text-primary-500" />
                    Số điện thoại <span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    type="tel"
                    className={`w-full input ${errors.phoneNumber ? 'border-red-400 focus:ring-red-300' : ''}`}
                    placeholder="0123 456 789"
                    value={formData.phoneNumber}
                    onChange={(e) => {
                      setFormData({ ...formData, phoneNumber: e.target.value });
                      if (errors.phoneNumber) setErrors({ ...errors, phoneNumber: '' });
                    }}
                  />
                  {errors.phoneNumber && (
                    <p className="text-red-500 text-sm mt-1 flex items-center">
                      <span className="w-1 h-1 bg-red-500 rounded-full mr-2"></span>
                      {errors.phoneNumber}
                    </p>
                  )}
                </div>
                <div>
                  <label className="flex items-center text-sm font-semibold text-slate-700 mb-2">
                    <FiStar className="mr-2 text-primary-500" />
                    Lĩnh vực chuyên môn <span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    type="text"
                    className={`w-full input ${errors.expertise ? 'border-red-400 focus:ring-red-300' : ''}`}
                    placeholder="VD: Lập trình Web, Thiết kế, Marketing..."
                    value={formData.expertise}
                    onChange={(e) => {
                      setFormData({ ...formData, expertise: e.target.value });
                      if (errors.expertise) setErrors({ ...errors, expertise: '' });
                    }}
                  />
                  {errors.expertise && (
                    <p className="text-red-500 text-sm mt-1 flex items-center">
                      <span className="w-1 h-1 bg-red-500 rounded-full mr-2"></span>
                      {errors.expertise}
                    </p>
                  )}
                </div>
              </div>

              {/* Address */}
              <div>
                <label className="flex items-center text-sm font-semibold text-slate-700 mb-2">
                  <FiMapPin className="mr-2 text-primary-500" />
                  Địa chỉ <span className="text-slate-400 text-xs ml-1">(không bắt buộc)</span>
                </label>
                <input
                  type="text"
                  className="w-full input"
                  placeholder="Thành phố, Quốc gia"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>
            </div>

            <div className="flex justify-between items-center pt-4">
              <button
                type="button"
                onClick={handlePrevStep}
                className="inline-flex items-center space-x-2 px-6 py-3 rounded-xl border-2 border-slate-100 text-slate-600 hover:bg-slate-50 hover:border-slate-200 transition-all font-medium"
              >
                <FiArrowLeft size={18} />
                <span>Quay lại</span>
              </button>
              <button
                type="submit"
                className="btn-primary px-8 py-3 rounded-xl inline-flex items-center space-x-2 font-semibold shadow-sm hover:shadow-sm transition-all"
              >
                <span>Tiếp tục</span>
                <FiArrowRight size={18} />
              </button>
            </div>
          </form>
        );

      // ========== STEP 2: XÁC NHẬN ==========
      case 2:
        return (
          <div className="space-y-6 animate-fadeIn">
            <div className="text-center mb-2">
              <h3 className="text-2xl font-bold text-slate-900 flex items-center justify-center">
                <FiShield className="mr-2 text-primary-600" /> Xác nhận thông tin
              </h3>
              <p className="text-slate-500 mt-1">Vui lòng kiểm tra lại thông tin trước khi hoàn tất đăng ký</p>
            </div>

            {/* Review Card */}
            <div className="bg-gradient-to-br from-gray-50 to-cyan-50 rounded-2xl border border-slate-100 overflow-hidden">
              <div className="bg-gradient-to-r from-primary-600 to-teal-600 px-6 py-4">
                <h4 className="text-white font-bold text-lg">Thông tin đăng ký giảng viên</h4>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex items-start">
                  <div className="w-36 flex-shrink-0 flex items-center text-slate-500 text-sm font-medium">
                    <FiFileText className="mr-2" /> Giới thiệu:
                  </div>
                  <p className="text-slate-900 leading-relaxed">{formData.bio}</p>
                </div>
                <hr className="border-slate-100" />
                <div className="flex items-center">
                  <div className="w-36 flex-shrink-0 flex items-center text-slate-500 text-sm font-medium">
                    <FiPhone className="mr-2" /> Số điện thoại:
                  </div>
                  <p className="text-slate-900 font-medium">{formData.phoneNumber}</p>
                </div>
                <hr className="border-slate-100" />
                <div className="flex items-center">
                  <div className="w-36 flex-shrink-0 flex items-center text-slate-500 text-sm font-medium">
                    <FiStar className="mr-2" /> Chuyên môn:
                  </div>
                  <p className="text-slate-900 font-medium">{formData.expertise}</p>
                </div>
                {formData.address && (
                  <>
                    <hr className="border-slate-100" />
                    <div className="flex items-center">
                      <div className="w-36 flex-shrink-0 flex items-center text-slate-500 text-sm font-medium">
                        <FiMapPin className="mr-2" /> Địa chỉ:
                      </div>
                      <p className="text-slate-900">{formData.address}</p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Notice */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start space-x-3">
              <FiInfo className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
              <div className="text-sm text-amber-800">
                <p className="font-semibold mb-1">Lưu ý quan trọng</p>
                <p>Sau khi xác nhận, tài khoản của bạn sẽ được nâng cấp lên quyền <strong>Giảng viên</strong>. Bạn có thể bắt đầu tạo và quản lý khóa học ngay lập tức.</p>
              </div>
            </div>

            <div className="flex justify-between items-center pt-4">
              <button
                type="button"
                onClick={handlePrevStep}
                disabled={loading}
                className="inline-flex items-center space-x-2 px-6 py-3 rounded-xl border-2 border-slate-100 text-slate-600 hover:bg-slate-50 hover:border-slate-200 transition-all font-medium disabled:opacity-50"
              >
                <FiArrowLeft size={18} />
                <span>Chỉnh sửa</span>
              </button>
              <button
                onClick={handleConfirmSubmit}
                disabled={loading}
                className="btn-primary px-10 py-3 rounded-xl inline-flex items-center space-x-2 font-bold text-lg shadow-sm hover:shadow-sm transition-all disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Đang xử lý...</span>
                  </>
                ) : (
                  <>
                    <FiCheckCircle size={20} />
                    <span>Xác nhận đăng ký</span>
                  </>
                )}
              </button>
            </div>
          </div>
        );

      // ========== STEP 3: HOÀN TẤT ==========
      case 3:
        return (
          <div className="text-center py-8 space-y-8 animate-fadeIn">
            <div className="flex justify-center">
              <div className="relative">
                <div className="bg-gradient-to-br from-green-400 to-emerald-500 text-white p-7 rounded-full shadow-sm">
                  <FiCheckCircle size={64} />
                </div>
                <div className="absolute -top-1 -right-1 bg-yellow-400 text-yellow-900 w-8 h-8 rounded-full flex items-center justify-center shadow-sm">
                  <FiStar size={16} />
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-4xl font-extrabold text-slate-900 mb-3">
                🎉 Xin chúc mừng!
              </h2>
              <p className="text-xl text-slate-600 max-w-lg mx-auto leading-relaxed">
                Bạn đã chính thức trở thành <strong className="text-primary-700">Giảng viên UMI</strong>.
                Hãy bắt đầu tạo khóa học đầu tiên và chia sẻ kiến thức của bạn với cộng đồng!
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <button
                onClick={() => navigate('/instructor/courses')}
                className="btn-primary px-8 py-4 text-lg rounded-2xl shadow-sm hover:shadow-sm transition-all inline-flex items-center justify-center space-x-2 font-bold"
              >
                <FiBookOpen size={22} />
                <span>Quản lý Khóa học</span>
              </button>
              <button
                onClick={() => navigate('/profile')}
                className="px-8 py-4 text-lg rounded-2xl border-2 border-slate-100 text-slate-700 hover:bg-slate-50 hover:border-slate-200 transition-all inline-flex items-center justify-center space-x-2 font-medium"
              >
                <FiUser size={22} />
                <span>Xem Hồ sơ</span>
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-white to-teal-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-extrabold text-slate-900 mb-2">Đăng ký trở thành Giảng viên</h1>
          <p className="text-slate-500 text-lg">Hành trình chia sẻ kiến thức bắt đầu từ đây</p>
        </div>

        {/* Progress Tracker */}
        <div className="mb-10">
          <div className="flex justify-between relative">
            {/* Background line */}
            <div className="absolute top-6 left-0 w-full h-0.5 bg-slate-200 z-0"></div>
            {/* Active line */}
            <div
              className="absolute top-6 left-0 h-0.5 bg-gradient-to-r from-primary-500 to-teal-500 z-0 transition-all duration-700 ease-out"
              style={{ width: `${(currentStep / (STEPS.length - 1)) * 100}%` }}
            ></div>

            {STEPS.map((step, index) => {
              const Icon = step.icon;
              const isCompleted = index < currentStep;
              const isCurrent = index === currentStep;
              const isActive = index <= currentStep;

              return (
                <div key={step.id} className="relative z-10 flex flex-col items-center">
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-500 
                      ${isCompleted
                        ? 'bg-gradient-to-br from-green-400 to-emerald-500 text-white shadow-sm'
                        : isCurrent
                          ? 'bg-gradient-to-br from-primary-500 to-teal-600 text-white shadow-sm scale-110 ring-4 ring-primary-100'
                          : 'bg-white text-slate-400 border-2 border-slate-100'
                      }`}
                  >
                    {isCompleted ? <FiCheckCircle size={20} /> : <Icon size={20} />}
                  </div>
                  <span
                    className={`mt-2 text-xs font-bold transition-colors duration-300 ${
                      isActive ? 'text-primary-700' : 'text-slate-400'
                    }`}
                  >
                    {step.title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Content Card */}
        <div className="bg-white rounded-3xl shadow-sm p-8 md:p-12 relative overflow-hidden">
          {/* Decorative gradient corner */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-primary-50 to-transparent rounded-bl-full opacity-60"></div>

          {/* Loading overlay */}
          {loading && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex items-center justify-center rounded-3xl">
              <div className="flex flex-col items-center">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-primary-200 border-t-primary-600 mb-4"></div>
                <p className="text-primary-800 font-bold text-lg">Đang hoàn tất đăng ký...</p>
                <p className="text-slate-500 text-sm mt-1">Vui lòng đợi trong giây lát</p>
              </div>
            </div>
          )}

          <div className="relative z-10">{renderStep()}</div>
        </div>

        {/* Footer note */}
        {currentStep < 3 && (
          <div className="mt-8 text-center text-slate-400 text-sm">
            Tham gia cùng cộng đồng giảng viên trên toàn quốc tại UMI
          </div>
        )}
      </div>
    </div>
  );
}
