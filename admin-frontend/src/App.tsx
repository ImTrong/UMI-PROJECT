import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { AdminLayout } from './components/layout/AdminLayout';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import Login from './pages/Login';
import Profile from './pages/Profile';
import AdminDashboard from './pages/AdminDashboard';
import AdminPayments from './pages/AdminPayments';
import AdminOrders from './pages/AdminOrders';
import AdminUsers from './pages/AdminUsers';
import AdminCategories from './pages/AdminCategories';
import AdminCourses from './pages/AdminCourses';

function App() {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <Routes>
      <Route 
        path="/login" 
        element={isAuthenticated && user?.role === 'ADMIN' ? <Navigate to="/admin/dashboard" /> : <Login />} 
      />
      
      <Route 
        path="/" 
        element={<Navigate to={isAuthenticated && user?.role === 'ADMIN' ? "/admin/dashboard" : "/login"} />} 
      />

      <Route element={<AdminLayout />}>
        <Route path="/profile" element={
          <ProtectedRoute requiredRole="ADMIN">
            <Profile />
          </ProtectedRoute>
        } />
        
        <Route path="/admin/dashboard" element={
          <ProtectedRoute requiredRole="ADMIN">
             <AdminDashboard />
          </ProtectedRoute>
        } />
        
        <Route path="/admin/payments" element={
          <ProtectedRoute requiredRole="ADMIN">
            <AdminPayments />
          </ProtectedRoute>
        } />

        <Route path="/admin/orders" element={
          <ProtectedRoute requiredRole="ADMIN">
            <AdminOrders />
          </ProtectedRoute>
        } />
        
        <Route path="/admin/users" element={
          <ProtectedRoute requiredRole="ADMIN">
            <AdminUsers />
          </ProtectedRoute>
        } />
        
        <Route path="/admin/categories" element={
          <ProtectedRoute requiredRole="ADMIN">
            <AdminCategories />
          </ProtectedRoute>
        } />
        
        <Route path="/admin/courses" element={
          <ProtectedRoute requiredRole="ADMIN">
            <AdminCourses />
          </ProtectedRoute>
        } />
      </Route>

      <Route path="*" element={<Navigate to="/admin/dashboard" />} />
    </Routes>
  );
}

export default App;
