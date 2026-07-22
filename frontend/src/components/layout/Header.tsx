import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import NotificationBell from '../realtime/NotificationBell';
import { useAuth } from '../../hooks/useAuth';
import { RootState } from '../../store';
import {
  FiShoppingCart,
  FiUser,
  FiLogOut,
  FiMenu,
  FiBookOpen,
  FiAward,
  FiActivity,
  FiHome,
  FiGrid,
  FiSearch,
  FiX,
  FiChevronDown,
  FiCheckSquare,
  FiList,
  FiBarChart2,
  FiMessageSquare
} from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';

export default function Header() {
  const { user, logout, isAuthenticated } = useAuth();
  const { profile } = useSelector((state: RootState) => state.user);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const cartItems = useSelector((state: RootState) => state.cart.items);
  const navigate = useNavigate();

  const displayAvatar = profile?.avatar || user?.avatar;
  const displayName = profile?.fullName || user?.fullName;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/courses?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
      setIsMenuOpen(false);
      setIsSearchOpen(false);
    }
  };

  // Menu groups
  const mainMenu = [
    { name: 'Trang chủ', href: '/', icon: FiHome },
    { name: 'Khóa học', href: '/courses', icon: FiBookOpen },
  ];

  const studentMenu = [
    { name: 'Khóa học đã mua', href: '/purchased-courses', icon: FiBookOpen },
    { name: 'Lộ trình học tập', href: '/learning-paths', icon: FiActivity },
    { name: 'Lịch sử đơn hàng', href: '/orders', icon: FiList },
    { name: 'Bài tập & Trắc nghiệm', href: '/tasks', icon: FiCheckSquare },
    { name: 'Tiến độ học tập', href: '/my-learning', icon: FiActivity },
    { name: 'Phân tích học tập', href: '/learning-analytics', icon: FiBarChart2 },
    { name: 'Chứng nhận', href: '/certificates', icon: FiAward },
    { name: 'Huy chương', href: '/badges', icon: FiAward },
    { name: 'Hoạt động', href: '/activity', icon: FiActivity },
    { name: 'AI Assistant', href: '/ai-assistant', icon: FiMessageSquare },
  ];

  const instructorMenu = [
    { name: 'Khóa học của tôi', href: '/my-courses', icon: FiBookOpen },
    { name: 'Bảng điều khiển', href: '/dashboard', icon: FiGrid },
  ];

  const visibleStudentMenu = isAuthenticated ? studentMenu : [];
  const visibleInstructorMenu = isAuthenticated && (user?.role === 'INSTRUCTOR' || user?.role === 'ADMIN') ? instructorMenu : [];

  const allNavItems = [...mainMenu, ...visibleStudentMenu, ...visibleInstructorMenu];

  return (
    <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-50">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link to="/" className="flex-shrink-0 flex items-center group">
            <span className="text-2xl font-bold bg-gradient-to-r from-primary-600 to-primary-400 bg-clip-text text-transparent">
              UMI
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center space-x-1">
            {mainMenu.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className="px-4 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-all duration-200 text-sm font-medium"
              >
                {item.name}
              </Link>
            ))}

            {visibleStudentMenu.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setOpenDropdown(openDropdown === 'student' ? null : 'student')}
                  className="flex items-center gap-1 px-4 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-all duration-200 text-sm font-medium"
                >
                  Học viên
                  <FiChevronDown className={`w-4 h-4 transition-transform duration-200 ${openDropdown === 'student' ? 'rotate-180' : ''}`} />
                </button>
                {openDropdown === 'student' && (
                  <div className="absolute top-full left-0 mt-2 w-48 bg-white rounded-xl shadow-sm border border-slate-100 py-2 animate-fadeIn">
                    {studentMenu.map((item) => (
                      <Link
                        key={item.href}
                        to={item.href}
                        className="flex items-center gap-3 px-4 py-2.5 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors text-sm"
                        onClick={() => setOpenDropdown(null)}
                      >
                        <item.icon className="w-4 h-4" />
                        {item.name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {visibleInstructorMenu.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setOpenDropdown(openDropdown === 'instructor' ? null : 'instructor')}
                  className="flex items-center gap-1 px-4 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-all duration-200 text-sm font-medium"
                >
                  Giảng viên
                  <FiChevronDown className={`w-4 h-4 transition-transform duration-200 ${openDropdown === 'instructor' ? 'rotate-180' : ''}`} />
                </button>
                {openDropdown === 'instructor' && (
                  <div className="absolute top-full left-0 mt-2 w-52 bg-white rounded-xl shadow-sm border border-slate-100 py-2 animate-fadeIn">
                    {instructorMenu.map((item) => (
                      <Link
                        key={item.href}
                        to={item.href}
                        className="flex items-center gap-3 px-4 py-2.5 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors text-sm"
                        onClick={() => setOpenDropdown(null)}
                      >
                        <item.icon className="w-4 h-4" />
                        {item.name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
            {isAuthenticated && user?.role === 'STUDENT' && (
              <Link
                to="/become-instructor"
                className="px-4 py-2 text-slate-900 hover:bg-slate-50 rounded-xl transition-all duration-200 text-sm font-bold border border-slate-100 ml-2"
              >
                Trở thành giảng viên
              </Link>
            )}
          </div>

          {/* Desktop Right Actions */}
          <div className="hidden lg:flex items-center gap-3">
            {/* Search Toggle */}
            <button
              onClick={() => setIsSearchOpen(!isSearchOpen)}
              className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-all"
            >
              <FiSearch size={20} />
            </button>

            {/* Notifications */}
            {isAuthenticated && <NotificationBell />}

            {/* Cart */}
            <Link to="/cart" className="relative p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-all">
              <FiShoppingCart size={20} />
              {cartItems.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-gradient-to-r from-red-500 to-red-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shadow-sm">
                  {cartItems.length > 99 ? '99+' : cartItems.length}
                </span>
              )}
            </Link>

            {/* Auth Section */}
            {isAuthenticated ? (
              <div className="relative">
                <button
                  onClick={() => setOpenDropdown(openDropdown === 'user' ? null : 'user')}
                  className="flex items-center gap-2 px-3 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-all"
                >
                  {displayAvatar ? (
                    <img src={displayAvatar} alt="Avatar" className="w-8 h-8 rounded-full object-cover shadow-sm border border-slate-200" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-white text-sm font-semibold shadow-sm">
                      {displayName?.charAt(0).toUpperCase() || 'U'}
                    </div>
                  )}
                  <span className="text-sm font-medium max-w-[120px] truncate">{displayName}</span>
                  <FiChevronDown className={`w-4 h-4 transition-transform duration-200 ${openDropdown === 'user' ? 'rotate-180' : ''}`} />
                </button>
                {openDropdown === 'user' && (
                  <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-sm border border-slate-100 py-2 animate-fadeIn">
                    <Link
                      to="/profile"
                      className="flex items-center gap-3 px-4 py-2.5 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors text-sm"
                      onClick={() => setOpenDropdown(null)}
                    >
                      <FiUser className="w-4 h-4" />
                      Hồ sơ của tôi
                    </Link>
                    <button
                      onClick={() => {
                        logout();
                        setOpenDropdown(null);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-red-600 hover:bg-red-50 transition-colors text-sm"
                    >
                      <FiLogOut className="w-4 h-4" />
                      Đăng xuất
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  to="/login"
                  className="px-4 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-all text-sm font-medium"
                >
                  Đăng nhập
                </Link>
                <Link
                  to="/register"
                  className="px-5 py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all text-sm font-bold shadow-sm active:scale-95"
                >
                  Đăng ký
                </Link>
              </div>
            )}
          </div>

          {/* Mobile Buttons */}
          <div className="flex lg:hidden items-center gap-2">
            <button
              onClick={() => setIsSearchOpen(!isSearchOpen)}
              className="p-2 text-slate-500 hover:text-slate-900 rounded-xl transition-all"
            >
              <FiSearch size={20} />
            </button>
            {isAuthenticated && <NotificationBell />}
            <Link to="/cart" className="relative p-2 text-slate-500 hover:text-slate-900 rounded-xl transition-all">
              <FiShoppingCart size={20} />
              {cartItems.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-gradient-to-r from-red-500 to-red-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {cartItems.length > 99 ? '99+' : cartItems.length}
                </span>
              )}
            </Link>
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-2 text-slate-500 hover:text-slate-900 rounded-xl transition-all"
            >
              {isMenuOpen ? <FiX size={22} /> : <FiMenu size={22} />}
            </button>
          </div>
        </div>

        {/* Desktop Search Bar */}
        {isSearchOpen && (
          <div className="hidden lg:block py-4 border-t border-slate-100 animate-slideDown">
            <form onSubmit={handleSearchSubmit} className="relative max-w-2xl mx-auto">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <FiSearch className="text-slate-400" />
              </div>
              <input
                type="text"
                className="w-full pl-12 pr-20 py-3 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500 focus:bg-white transition-all placeholder:text-slate-400"
                placeholder="Tìm kiếm khóa học, chủ đề, kỹ năng..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              <button
                type="submit"
                className="absolute inset-y-0 right-2 my-1.5 px-4 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-800 transition-colors"
              >
                Tìm
              </button>
            </form>
          </div>
        )}

        {/* Mobile Search Bar */}
        {isSearchOpen && (
          <div className="lg:hidden py-3 border-t border-slate-100 animate-slideDown">
            <form onSubmit={handleSearchSubmit} className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <FiSearch className="text-slate-400" size={18} />
              </div>
              <input
                type="text"
                className="w-full pl-10 pr-16 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                placeholder="Tìm kiếm khóa học..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              <button
                type="submit"
                className="absolute inset-y-0 right-1 my-1 px-3 bg-slate-900 text-white text-xs font-bold rounded-xl hover:bg-slate-800 transition-colors"
              >
                Tìm
              </button>
            </form>
          </div>
        )}

        {/* Mobile Menu */}
        {isMenuOpen && (
          <div className="lg:hidden py-4 border-t border-slate-100 animate-slideDown">
            <div className="space-y-1">
              {allNavItems.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  className="flex items-center gap-3 px-4 py-3 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-all"
                  onClick={() => setIsMenuOpen(false)}
                >
                  <item.icon size={20} />
                  <span className="text-base font-medium">{item.name}</span>
                </Link>
              ))}

              {isAuthenticated ? (
                <>
                  <div className="h-px bg-slate-100 my-2" />
                  <Link
                    to="/profile"
                    className="flex items-center gap-3 px-4 py-3 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-all"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    <FiUser size={20} />
                    <span className="text-base font-medium">Hồ sơ của tôi</span>
                  </Link>
                  <button
                    onClick={() => {
                      logout();
                      setIsMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 rounded-xl transition-all"
                  >
                    <FiLogOut size={20} />
                    <span className="text-base font-medium">Đăng xuất</span>
                  </button>
                </>
              ) : (
                <div className="pt-3 space-y-2">
                  <Link
                    to="/login"
                    className="block text-center px-4 py-2.5 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-all text-base font-medium"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Đăng nhập
                  </Link>
                  <Link
                    to="/register"
                    className="block text-center px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:from-primary-700 hover:to-primary-600 transition-all text-base font-medium"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Đăng ký
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </nav>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .animate-fadeIn {
          animation: fadeIn 0.2s ease-out;
        }
        
        .animate-slideDown {
          animation: slideDown 0.25s ease-out;
        }
      `}</style>
    </header>
  );
}