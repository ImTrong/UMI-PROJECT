import { FiBarChart2 } from 'react-icons/fi';

interface DashboardHeaderProps {
  userName?: string;
}

export default function DashboardHeader({ userName }: DashboardHeaderProps) {
  return (
    <div
      className="relative overflow-hidden rounded-3xl p-8 mb-8 shadow-lg"
      style={{
        background:
          'linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #4338ca 70%, #6366f1 100%)',
      }}
    >
      {/* Decorative elements */}
      <div className="absolute top-0 right-0 w-72 h-72 bg-white/[0.04] rounded-full -translate-y-1/2 translate-x-1/4" />
      <div className="absolute bottom-0 left-0 w-56 h-56 bg-white/[0.03] rounded-full translate-y-1/2 -translate-x-1/4" />
      <div className="absolute top-8 right-1/3 w-2 h-2 bg-indigo-300/40 rounded-full animate-pulse" />
      <div className="absolute bottom-8 right-1/4 w-1.5 h-1.5 bg-purple-300/30 rounded-full animate-pulse delay-700" />

      <div className="relative z-10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-white/10 backdrop-blur-sm rounded-2xl flex items-center justify-center border border-white/10">
            <FiBarChart2 className="w-6 h-6 text-indigo-200" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight">
              Phân tích học tập
            </h1>
            <p className="text-indigo-300/80 text-sm font-medium mt-0.5">
              {userName
                ? `Xin chào, ${userName} — theo dõi hành trình phát triển của bạn`
                : 'Theo dõi hành trình phát triển và mức độ thành thạo kỹ năng'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
