import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { AppDispatch } from './store'
import { fetchProfile } from './store/userSlice'
import Header from './components/layout/Header'
import { Footer } from './components/layout/Footer'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import { SocketProvider } from './contexts/SocketContext'
import ChatWidget from './components/realtime/ChatWidget'
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import VerifyEmail from './pages/VerifyEmail'
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import HealthDashboard from './pages/HealthDashboard'
import SearchCourses from './pages/SearchCourses'
import CourseDetail from './pages/CourseDetail'
import CreateCourse from './pages/CreateCourse'
import MyCourses from './pages/MyCourses'
import Cart from './pages/Cart'
import Orders from './pages/Orders'
import OrderDetail from './pages/OrderDetail'
import Checkout from './pages/Checkout'
import CheckoutSuccess from './pages/CheckoutSuccess'
import BecomeInstructor from './pages/BecomeInstructor'
import Payments from './pages/Payments'
import EditCourse from './pages/EditCourse'
import Learning from './pages/Learning'
import MyLearning from './pages/MyLearning'
import PurchasedCourses from './pages/PurchasedCourses'
import Certificates from './pages/Certificates'
import CertificateDetail from './pages/CertificateDetail'
import CertificateVerify from './pages/CertificateVerify'
import Badges from './pages/Badges'
import Activity from './pages/Activity'
import MyTasks from './pages/MyTasks'
import QuizPage from './pages/QuizPage'
import AssignmentPage from './pages/AssignmentPage'
import AssignmentSubmissions from './pages/instructor/AssignmentSubmissions'
import CourseStudents from './pages/instructor/CourseStudents'
import CourseStudentDetail from './pages/instructor/CourseStudentDetail'
import LearningPaths from './pages/LearningPaths'
import LearningAnalytics from './pages/LearningAnalytics'
import AIAssistant from './pages/AIAssistant'

function App() {
  const { isAuthenticated, loading } = useAuth()
  const dispatch = useDispatch<AppDispatch>()

  useEffect(() => {
    if (isAuthenticated) {
      dispatch(fetchProfile())
    }
  }, [isAuthenticated, dispatch])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <SocketProvider>
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-grow">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={
            isAuthenticated ? <Navigate to="/dashboard" /> : <Login />
          } />
          <Route path="/register" element={
            isAuthenticated ? <Navigate to="/dashboard" /> : <Register />
          } />
          <Route path="/forgot-password" element={
            isAuthenticated ? <Navigate to="/dashboard" /> : <ForgotPassword />
          } />
          <Route path="/reset-password" element={
            isAuthenticated ? <Navigate to="/dashboard" /> : <ResetPassword />
          } />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } />
          <Route path="/profile" element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          } />
          <Route path="/become-instructor" element={
            <ProtectedRoute>
              <BecomeInstructor />
            </ProtectedRoute>
          } />
          <Route path="/health" element={<HealthDashboard />} />
          
          {/* Course Routes */}
          <Route path="/courses" element={<SearchCourses />} />
          <Route path="/courses/:slug" element={<CourseDetail />} />
          <Route path="/courses/create" element={
            <ProtectedRoute>
              <CreateCourse />
            </ProtectedRoute>
          } />
          <Route path="/my-courses" element={
            <ProtectedRoute>
              <MyCourses />
            </ProtectedRoute>
          } />
          
          {/* Order Routes */}
          <Route path="/cart" element={
            <ProtectedRoute>
              <Cart />
            </ProtectedRoute>
          } />
          <Route path="/orders" element={
            <ProtectedRoute>
              <Orders />
            </ProtectedRoute>
          } />
          <Route path="/orders/:id" element={
            <ProtectedRoute>
              <OrderDetail />
            </ProtectedRoute>
          } />
          
          {/* Payment Routes */}
          <Route path="/checkout/:orderId" element={
            <ProtectedRoute>
              <Checkout />
            </ProtectedRoute>
          } />
          <Route path="/checkout/success/:orderId" element={
            <ProtectedRoute>
              <CheckoutSuccess />
            </ProtectedRoute>
          } />
          <Route path="/payments" element={
            <ProtectedRoute>
              <Payments />
            </ProtectedRoute>
          } />
          <Route path="/courses/:slug/edit" element={
            <ProtectedRoute>
              <EditCourse />
            </ProtectedRoute>
          } />

          {/* Learning Routes */}
          <Route path="/learning/:courseId" element={
            <ProtectedRoute>
              <Learning />
            </ProtectedRoute>
          } />
          <Route path="/my-learning" element={
            <ProtectedRoute>
              <MyLearning />
            </ProtectedRoute>
          } />
          <Route path="/learning-paths" element={
            <ProtectedRoute>
              <LearningPaths />
            </ProtectedRoute>
          } />
          <Route path="/learning-analytics" element={
            <ProtectedRoute>
              <LearningAnalytics />
            </ProtectedRoute>
          } />
          <Route path="/ai-assistant" element={
            <ProtectedRoute>
              <AIAssistant />
            </ProtectedRoute>
          } />
          <Route path="/purchased-courses" element={
            <ProtectedRoute>
              <PurchasedCourses />
            </ProtectedRoute>
          } />
          <Route path="/certificates" element={
            <ProtectedRoute>
              <Certificates />
            </ProtectedRoute>
          } />
          <Route path="/certificates/:certificateId" element={
            <ProtectedRoute>
              <CertificateDetail />
            </ProtectedRoute>
          } />
          <Route path="/verify-certificate" element={<CertificateVerify />} />
          <Route path="/verify-certificate/:certificateNumber" element={<CertificateVerify />} />
          <Route path="/badges" element={
            <ProtectedRoute>
              <Badges />
            </ProtectedRoute>
          } />
          <Route path="/activity" element={
            <ProtectedRoute>
              <Activity />
            </ProtectedRoute>
          } />
          <Route path="/tasks" element={
            <ProtectedRoute>
              <MyTasks />
            </ProtectedRoute>
          } />
          <Route path="/tasks/:taskId/quiz" element={
            <ProtectedRoute>
              <QuizPage />
            </ProtectedRoute>
          } />
          <Route path="/tasks/:taskId/assignment" element={
            <ProtectedRoute>
              <AssignmentPage />
            </ProtectedRoute>
          } />
          
          {/* Instructor Routes */}
          <Route path="/instructor/assignments/:assignmentId/submissions" element={
            <ProtectedRoute requiredRole="INSTRUCTOR">
              <AssignmentSubmissions />
            </ProtectedRoute>
          } />
          <Route path="/instructor/course/:courseId/students" element={
            <ProtectedRoute requiredRole="INSTRUCTOR">
              <CourseStudents />
            </ProtectedRoute>
          } />
          <Route path="/instructor/course/:courseId/students/:studentId" element={
            <ProtectedRoute requiredRole="INSTRUCTOR">
              <CourseStudentDetail />
            </ProtectedRoute>
          } />

        </Routes>
      </main>
      <Footer />
      {isAuthenticated && <ChatWidget />}
    </div>
    </SocketProvider>
  )
}

export default App
