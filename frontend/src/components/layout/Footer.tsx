import {
  FaFacebookF,
  FaTwitter,
  FaLinkedinIn,
  FaYoutube,
  FaInstagram,
  FaGithub
} from 'react-icons/fa';
import { FiMail, FiPhone, FiMapPin, FiSend } from 'react-icons/fi';
import { Link } from 'react-router-dom';

export const Footer = () => {
  const currentYear = new Date().getFullYear();

  const quickLinks = [
    { name: 'Trang chủ', href: '/' },
    { name: 'Khóa học', href: '/courses' },
    { name: 'Giảng viên', href: '/instructors' },
    { name: 'Blog', href: '/blog' },
    { name: 'Giới thiệu', href: '/about' },
  ];

  const supportLinks = [
    { name: 'Trung tâm trợ giúp', href: '/help' },
    { name: 'Câu hỏi thường gặp', href: '/faq' },
    { name: 'Liên hệ', href: '/contact' },
    { name: 'Chính sách bảo mật', href: '/privacy' },
    { name: 'Điều khoản sử dụng', href: '/terms' },
  ];

  const socialLinks = [
    { name: 'Facebook', icon: FaFacebookF, href: 'https://facebook.com', color: 'hover:bg-[#1877f2]' },
    { name: 'Twitter', icon: FaTwitter, href: 'https://twitter.com', color: 'hover:bg-[#1da1f2]' },
    { name: 'LinkedIn', icon: FaLinkedinIn, href: 'https://linkedin.com', color: 'hover:bg-[#0a66c2]' },
    { name: 'YouTube', icon: FaYoutube, href: 'https://youtube.com', color: 'hover:bg-[#ff0000]' },
    { name: 'Instagram', icon: FaInstagram, href: 'https://instagram.com', color: 'hover:bg-[#e4405f]' },
    { name: 'GitHub', icon: FaGithub, href: 'https://github.com', color: 'hover:bg-[#333]' },
  ];

  const contactInfo = [
    { icon: FiMapPin, text: '123 Đường Công Nghệ, Quận 1, TP.HCM' },
    { icon: FiMail, text: 'support@umi.edu.vn' },
    { icon: FiPhone, text: '1900 1234' },
  ];

  return (
    <footer className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white mt-auto">
      {/* Newsletter Section */}
      <div className="border-b border-slate-700/50">
        <div className="container mx-auto px-4 py-12">
          <div className="max-w-4xl mx-auto text-center">
            <h3 className="text-2xl md:text-3xl font-bold mb-3 bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
              Đăng ký nhận tin
            </h3>
            <p className="text-slate-400 mb-6">
              Nhận thông tin về khóa học mới và ưu đãi đặc biệt
            </p>
            <form className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
              <input
                type="email"
                placeholder="Email của bạn"
                className="flex-1 px-5 py-3 bg-slate-800/50 border border-slate-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
              />
              <button
                type="submit"
                className="px-6 py-3 bg-emerald-600 text-white rounded-xl hover:from-primary-700 hover:to-primary-600 transition-all duration-300 font-medium flex items-center justify-center gap-2 group"
              >
                <span>Đăng ký</span>
                <FiSend className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Main Footer Content */}
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {/* Brand Section */}
          <div className="space-y-4">
            <Link to="/" className="inline-block">
              <span className="text-3xl font-bold bg-gradient-to-r from-primary-400 to-primary-300 bg-clip-text text-transparent">
                UMI
              </span>
            </Link>
            <p className="text-slate-400 text-sm leading-relaxed">
              Hệ thống học tập trực tuyến tiên tiến, xây dựng trên kiến trúc microservices, 
              mang đến trải nghiệm học tập tốt nhất cho học viên.
            </p>
            <div className="flex space-x-3">
              {socialLinks.map((social, index) => (
                <a
                  key={index}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-all duration-300 ${social.color}`}
                >
                  <social.icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-lg font-semibold mb-5 relative inline-block">
              Liên kết nhanh
              <span className="absolute -bottom-2 left-0 w-8 h-0.5 bg-slate-1000 rounded-full"></span>
            </h4>
            <ul className="space-y-3">
              {quickLinks.map((link, index) => (
                <li key={index}>
                  <Link
                    to={link.href}
                    className="text-slate-400 hover:text-primary-400 transition-colors duration-200 text-sm flex items-center gap-2 group"
                  >
                    <span className="w-1 h-1 bg-slate-1000 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></span>
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Support */}
          <div>
            <h4 className="text-lg font-semibold mb-5 relative inline-block">
              Hỗ trợ
              <span className="absolute -bottom-2 left-0 w-8 h-0.5 bg-slate-1000 rounded-full"></span>
            </h4>
            <ul className="space-y-3">
              {supportLinks.map((link, index) => (
                <li key={index}>
                  <Link
                    to={link.href}
                    className="text-slate-400 hover:text-primary-400 transition-colors duration-200 text-sm flex items-center gap-2 group"
                  >
                    <span className="w-1 h-1 bg-slate-1000 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></span>
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact Info */}
          <div>
            <h4 className="text-lg font-semibold mb-5 relative inline-block">
              Thông tin liên hệ
              <span className="absolute -bottom-2 left-0 w-8 h-0.5 bg-slate-1000 rounded-full"></span>
            </h4>
            <ul className="space-y-4">
              {contactInfo.map((item, index) => (
                <li key={index} className="flex items-start gap-3 text-slate-400 text-sm">
                  <item.icon className="w-5 h-5 text-primary-400 mt-0.5 flex-shrink-0" />
                  <span className="leading-relaxed">{item.text}</span>
                </li>
              ))}
            </ul>
            {/* Trust Badge */}
            <div className="mt-6 pt-4 border-t border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-1000/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Được chứng nhận bởi</p>
                  <p className="text-sm font-semibold text-slate-300">Bộ Giáo dục & Đào tạo</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-slate-800/50">
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-center md:text-left">
            <p className="text-slate-400 text-sm">
              © {currentYear} Nền tảng E-Learning UMI. Tất cả các quyền được bảo lưu.
            </p>
            <div className="flex flex-wrap justify-center gap-4 text-xs">
              <Link to="/privacy" className="text-slate-400 hover:text-slate-400 transition-colors">
                Chính sách bảo mật
              </Link>
              <span className="text-slate-700">|</span>
              <Link to="/terms" className="text-slate-400 hover:text-slate-400 transition-colors">
                Điều khoản sử dụng
              </Link>
              <span className="text-slate-700">|</span>
              <Link to="/cookies" className="text-slate-400 hover:text-slate-400 transition-colors">
                Chính sách Cookie
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};