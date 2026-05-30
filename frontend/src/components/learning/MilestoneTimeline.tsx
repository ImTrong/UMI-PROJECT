import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FiCheckCircle, FiPlayCircle, FiCircle,
  FiArrowRight, FiClock, FiBookOpen, FiLock
} from 'react-icons/fi';
import { Milestone } from '../../services/recommendation.service';
import { formatVND } from '../../utils/currency';

interface Props {
  milestones: Milestone[];
  isLoading?: boolean;
}

const statusConfig = {
  COMPLETED: {
    nodeClasses: 'border-emerald-500 text-emerald-500 shadow-[0_0_14px_rgba(16,185,129,0.4)]',
    boxClasses: 'bg-emerald-50/30 border-emerald-100/80',
    labelColor: 'text-emerald-600',
    icon: FiCheckCircle,
    label: '✓ Hoàn thành',
  },
  IN_PROGRESS: {
    nodeClasses: 'border-emerald-600 text-emerald-600 shadow-[0_0_14px_rgba(79,70,229,0.4)] animate-pulse',
    boxClasses: 'bg-emerald-50/30 border-emerald-100/80 ring-1 ring-emerald-500/10',
    labelColor: 'text-emerald-600',
    icon: FiPlayCircle,
    label: '⚡ Đang học',
  },
  NOT_STARTED: {
    nodeClasses: 'border-slate-100 text-slate-300',
    boxClasses: 'bg-white border-slate-100',
    labelColor: 'text-slate-400',
    icon: FiCircle,
    label: 'Chưa mở khóa',
  },
};

export default function MilestoneTimeline({ milestones, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-24">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600" />
      </div>
    );
  }

  if (milestones.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <FiBookOpen className="w-12 h-12 mb-3 opacity-30 text-emerald-500" />
        <p className="text-sm font-semibold">Chưa có khóa học cấu hình trong lộ trình này</p>
      </div>
    );
  }

  return (
    <div className="relative pl-6 md:pl-8 border-l-2 border-emerald-100 ml-4 py-2 space-y-10">
      {milestones.map((m, index) => (
        <MilestoneItem key={m.courseId} milestone={m} index={index} />
      ))}
    </div>
  );
}

function MilestoneItem({ milestone: m, index }: { milestone: Milestone; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const config = statusConfig[m.status];
  const Icon = m.isLocked ? FiLock : config.icon;
  const isCompleted = m.status === 'COMPLETED';
  const isInProgress = m.status === 'IN_PROGRESS';
  const nodeClasses = m.isLocked ? 'border-amber-200 text-amber-400 bg-amber-50' : config.nodeClasses;
  const boxClasses = m.isLocked ? 'bg-amber-50/20 border-amber-100/50 grayscale-[30%] opacity-80' : config.boxClasses;

  return (
    <div
      ref={ref}
      className={`relative group transition-all duration-500 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      }`}
      style={{ transitionDelay: `${index * 80}ms` }}
    >
      {/* Subway Node */}
      <div
        className={`absolute -left-[39px] md:-left-[47px] top-1.5 w-7 h-7 md:w-8 md:h-8 rounded-full border-4 flex items-center justify-center transition-all duration-300 z-10 bg-white ${nodeClasses}`}
      >
        <Icon className="w-4 h-4 md:w-5 md:h-5" />
      </div>

      {/* Milestone Card */}
      <div
        className={`ml-8 md:ml-10 rounded-2xl border p-5 md:p-6 transition-all duration-300 hover:shadow-sm ${boxClasses}`}
      >
        <div className="flex flex-col md:flex-row gap-4">
          {/* Thumbnail */}
          {m.thumbnail && (
            <div className="w-full md:w-32 h-20 md:h-auto rounded-xl overflow-hidden flex-shrink-0 bg-slate-100">
              <img
                src={m.thumbnail}
                alt={m.title}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
          )}

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="inline-block mb-1.5 px-2.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-black tracking-wider">
                  CHẶNG {index + 1}
                </div>
                <h4 className="font-bold text-slate-900 group-hover:text-emerald-600 transition-colors text-base leading-snug">
                  {m.title}
                </h4>

                {/* Description */}
                {m.description && (
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-2">
                    {m.description}
                  </p>
                )}

                {/* Meta Info */}
                <div className="flex flex-wrap items-center gap-3 mt-2.5 text-xs">
                  {/* Status */}
                  <span className={`font-semibold flex items-center gap-1 ${m.isLocked ? 'text-amber-600' : config.labelColor}`}>
                    {m.isLocked ? '🔒 Đã khóa' : config.label}
                    {isInProgress && !m.isLocked && ` (${Math.round(m.progressPercentage)}%)`}
                  </span>

                  {/* Lessons */}
                  {m.totalLessons > 0 && (
                    <span className="text-slate-400 flex items-center gap-1">
                      <FiBookOpen className="w-3 h-3" />
                      {isCompleted || isInProgress
                        ? `${m.completedLessons}/${m.totalLessons} bài`
                        : `${m.totalLessons} bài học`
                      }
                    </span>
                  )}

                  {/* Estimated Time */}
                  {m.estimatedHours > 0 && (
                    <span className="text-slate-400 flex items-center gap-1">
                      <FiClock className="w-3 h-3" />
                      ~{m.estimatedHours}h
                    </span>
                  )}
                </div>
              </div>

              {/* Action Button */}
              <div className="flex-shrink-0 flex items-center gap-3">
                {m.isLocked ? (
                  <div className="px-4 py-2.5 bg-amber-100/50 text-amber-700 font-bold rounded-xl text-[11px] border border-amber-200/50 flex flex-col items-center justify-center text-center max-w-[150px]">
                    <FiLock className="w-4 h-4 mb-1" />
                    {m.lockedReason || 'Khóa học tiên quyết'}
                  </div>
                ) : isCompleted || isInProgress ? (
                  <Link
                    to={`/learning/${m.courseId}`}
                    className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold rounded-xl text-xs shadow-sm hover:shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center gap-1.5"
                  >
                    {isCompleted ? 'Xem lại' : 'Tiếp tục'} <FiArrowRight className="w-3.5 h-3.5" />
                  </Link>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-slate-800 bg-slate-100 px-3 py-2 rounded-xl">
                      {m.price > 0 ? formatVND(m.price) : 'Miễn phí'}
                    </span>
                    <Link
                      to={`/courses/${m.slug}`}
                      className="px-5 py-2.5 border border-emerald-600 text-emerald-600 font-bold rounded-xl text-xs hover:bg-emerald-50 transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center gap-1.5"
                    >
                      Đăng ký <FiArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Progress Bar */}
            {isInProgress && (
              <div className="mt-4">
                <div className="w-full bg-slate-100 rounded-full h-1.5">
                  <div
                    className="h-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${m.progressPercentage}%` }}
                  />
                </div>
              </div>
            )}

            {/* Completion badge */}
            {isCompleted && (
              <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-xl text-[11px] font-bold">
                <FiCheckCircle className="w-3.5 h-3.5" />
                Đã hoàn thành chặng này
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
