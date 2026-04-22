import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  FiUser,
  FiLogOut,
  FiMenu,
  FiChevronDown,
  FiBell,
  FiSearch
} from 'react-icons/fi';

interface HeaderProps {
  onMenuClick?: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { user, logout, isAuthenticated } = useAuth();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  return (
    <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-30 h-16 flex items-center">
      <div className="w-full px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        
        {/* Left Section: Mobile Menu Toggle & Search */}
        <div className="flex items-center gap-4 flex-1">
          <button
            onClick={onMenuClick}
            className="p-2 -ml-2 text-gray-500 hover:text-primary-600 rounded-lg transition-all lg:hidden"
          >
            <FiMenu size={24} />
          </button>
          
          <div className="hidden md:flex items-center relative max-w-md w-full">
            <FiSearch className="absolute left-3 text-gray-400" />
            <input 
              type="text" 
              placeholder="Tìm kiếm nhanh..." 
              className="w-full pl-10 pr-4 py-2 border-none bg-gray-100/50 focus:bg-white focus:ring-2 focus:ring-primary-500 rounded-lg text-sm transition-all"
            />
          </div>
        </div>

        {/* Right Section: Actions & Profile */}
        <div className="flex items-center gap-3 lg:gap-4">
          {/* Notifications */}
          <button className="relative p-2 text-gray-400 hover:text-primary-600 rounded-full hover:bg-primary-50 transition-colors">
            <FiBell size={20} />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
          </button>

          <div className="hidden sm:block w-px h-6 bg-gray-200 mx-1"></div>

          {/* Profile Dropdown */}
          {isAuthenticated ? (
            <div className="relative">
              <button
                onClick={() => setOpenDropdown(openDropdown === 'user' ? null : 'user')}
                className="flex items-center gap-2 pl-2 pr-1 py-1 text-gray-600 hover:bg-gray-50 rounded-full transition-all border border-transparent hover:border-gray-200"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-r from-primary-500 to-primary-600 flex items-center justify-center text-white text-sm font-semibold shadow-sm">
                  {user?.fullName?.charAt(0).toUpperCase() || 'A'}
                </div>
                <span className="text-sm font-medium hidden sm:block max-w-[120px] truncate">{user?.fullName || 'Admin'}</span>
                <FiChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 hidden sm:block ${openDropdown === 'user' ? 'rotate-180' : ''}`} />
              </button>
              
              {openDropdown === 'user' && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)}></div>
                  <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-100 py-2 animate-fadeIn z-50">
                    <div className="px-4 py-3 border-b border-gray-50 mb-2">
                      <p className="text-sm text-gray-900 font-medium truncate">{user?.fullName}</p>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{user?.email}</p>
                    </div>
                    
                    <Link
                      to="/profile"
                      className="flex items-center gap-3 px-4 py-2.5 text-gray-600 hover:text-primary-600 hover:bg-primary-50 transition-colors text-sm"
                      onClick={() => setOpenDropdown(null)}
                    >
                      <FiUser className="w-4 h-4" />
                      Hồ sơ của tôi / Đổi mật khẩu
                    </Link>
                    
                    <div className="h-px bg-gray-50 my-2"></div>
                    
                    <button
                      onClick={() => {
                        logout();
                        setOpenDropdown(null);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-red-600 hover:bg-red-50 transition-colors text-sm font-medium"
                    >
                      <FiLogOut className="w-4 h-4" />
                      Đăng xuất
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
             <Link
               to="/login"
               className="text-sm font-medium text-primary-600 hover:text-primary-700"
             >
               Đăng nhập
             </Link>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.15s ease-out forwards;
        }
      `}</style>
    </header>
  );
}