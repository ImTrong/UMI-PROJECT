import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import {
  FiGrid,
  FiUsers,
  FiBookOpen,
  FiDollarSign,
  FiList,
  FiShoppingCart,
  FiLogOut
} from 'react-icons/fi';

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export function Sidebar({ isOpen, setIsOpen }: SidebarProps) {
  const { pathname } = useLocation();
  const { logout, user } = useAuth();

  const adminMenu = [
    { name: 'Bảng điều khiển', href: '/admin/dashboard', icon: FiGrid },
    { name: 'Khóa học', href: '/admin/courses', icon: FiBookOpen },
    { name: 'Danh mục', href: '/admin/categories', icon: FiList },
    { name: 'Người dùng', href: '/admin/users', icon: FiUsers },
    { name: 'Đơn hàng', href: '/admin/orders', icon: FiShoppingCart },
    { name: 'Thanh toán', href: '/admin/payments', icon: FiDollarSign },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-gray-900/50 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside 
        className={`fixed inset-y-0 left-0 bg-white border-r border-gray-200 w-64 z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Logo Area */}
        <div className="h-16 flex items-center px-6 border-b border-gray-100 flex-shrink-0">
          <Link to="/admin/dashboard" className="flex items-center gap-2 group">
            <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-600 rounded-lg flex items-center justify-center shadow-sm group-hover:shadow transition-all">
              <span className="text-white font-bold text-xl">U</span>
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
              UMI ADMIN
            </span>
          </Link>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-6 px-4 custom-scrollbar">
          <div className="space-y-1">
            <p className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Quản lý chính
            </p>
            {adminMenu.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group ${
                    isActive 
                      ? 'bg-primary-50 text-primary-600 font-medium' 
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                  onClick={() => setIsOpen(false)}
                >
                  <item.icon size={20} className={isActive ? 'text-primary-600' : 'text-gray-400 group-hover:text-gray-600'} />
                  {item.name}
                </Link>
              );
            })}
          </div>
        </div>

        {/* User / Footer Area */}
        <div className="border-t border-gray-100 p-4 flex-shrink-0">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-10 h-10 rounded-full bg-gradient-to-r from-primary-500 to-primary-600 flex items-center justify-center text-white font-semibold">
              {user?.fullName?.charAt(0).toUpperCase() || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user?.fullName || 'Quản trị viên'}
              </p>
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
            </div>
          </div>
          
          <button
            onClick={() => {
              logout();
              setIsOpen(false);
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-medium"
          >
            <FiLogOut size={18} />
            Đăng xuất
          </button>
        </div>
      </aside>
    </>
  );
}
