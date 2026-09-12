import { FiArrowRight, FiTarget } from 'react-icons/fi';
import type { RecommendedAction, SectionStatus } from './learner-analytics.types';

interface NextRecommendedActionProps {
  recommendations: RecommendedAction[];
  status: SectionStatus;
  onRetry?: () => void;
}

// ── Priority colors ──
const PRIORITY_ACCENT: Record<string, { border: string; bg: string; text: string }> = {
  HIGH: { border: 'border-l-indigo-500', bg: 'bg-indigo-50/50', text: 'text-indigo-700' },
  MEDIUM: { border: 'border-l-amber-400', bg: 'bg-amber-50/30', text: 'text-amber-700' },
  LOW: { border: 'border-l-slate-300', bg: 'bg-slate-50', text: 'text-slate-600' },
};

export default function NextRecommendedAction({
  recommendations,
  status,
  onRetry,
}: NextRecommendedActionProps) {
  // Show the top recommendation prominently
  const primary = recommendations[0];
  const secondary = recommendations.slice(1, 3);

  return (
    <div
      className="rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
      style={{
        background:
          'linear-gradient(135deg, #eef2ff 0%, #f5f3ff 40%, #faf5ff 100%)',
      }}
    >
      <div className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
            <FiTarget className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              Hành động đề xuất tiếp theo
            </h2>
            <p className="text-xs text-slate-400 font-medium">
              Dựa trên phân tích dữ liệu học tập
            </p>
          </div>
        </div>

        {status === 'loading' && (
          <div className="animate-pulse">
            <div className="h-24 bg-white/60 rounded-xl mb-3" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-16 bg-white/40 rounded-xl" />
              <div className="h-16 bg-white/40 rounded-xl" />
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center py-6 bg-white/60 rounded-xl">
            <p className="text-xs text-red-500 font-semibold mb-1">
              Không thể tạo đề xuất
            </p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="text-[10px] font-bold text-indigo-600 hover:underline cursor-pointer"
              >
                Thử lại
              </button>
            )}
          </div>
        )}

        {status === 'empty' && (
          <div className="text-center py-8 bg-white/60 rounded-xl">
            <FiTarget className="w-8 h-8 text-slate-200 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-500 mb-1">
              Chưa có đề xuất
            </p>
            <p className="text-xs text-slate-400">
              Hoàn thành thêm nội dung để nhận đề xuất cá nhân hóa.
            </p>
          </div>
        )}

        {status === 'ready' && recommendations.length === 0 && (
          <div className="text-center py-8 bg-white/60 rounded-xl">
            <p className="text-xs text-emerald-600 font-semibold">
              🎯 Bạn đang đi đúng hướng! Tiếp tục nhé.
            </p>
          </div>
        )}

        {status === 'ready' && primary && (
          <div>
            {/* Primary recommendation — Problem → Reason → Action */}
            <div className="bg-white rounded-xl border border-slate-100 border-l-4 border-l-indigo-500 p-5 mb-4 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-base font-bold text-slate-800">
                  {primary.target}
                </h3>
                {primary.confidence !== undefined && (
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 rounded">
                    Độ tin cậy: {Math.round(primary.confidence * 100)}%
                  </span>
                )}
              </div>
              
              {primary.problem && (
                <div className="mb-3">
                   <p className="text-sm font-semibold text-slate-700">{primary.problem}</p>
                </div>
              )}

              {/* Why? */}
              <div className="mb-4 bg-slate-50 p-3 rounded-lg">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Phân tích
                </p>
                <p className="text-sm text-slate-600 leading-relaxed mb-2">
                  {primary.reason}
                </p>
                {primary.evidence && primary.evidence.length > 0 && (
                   <ul className="list-disc pl-4 text-xs text-slate-500 space-y-0.5">
                     {primary.evidence.map((ev, i) => <li key={i}>{ev}</li>)}
                   </ul>
                )}
              </div>

              {/* Action */}
              {primary.actionUrl ? (
                <a
                  href={primary.actionUrl}
                  className="inline-flex items-center gap-2 bg-indigo-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl hover:bg-indigo-700 transition-colors shadow-sm"
                >
                  {primary.actionLabel || primary.action}
                  <FiArrowRight className="w-4 h-4" />
                </a>
              ) : (
                <p className="text-sm font-semibold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-lg inline-block">
                  {primary.action}
                </p>
              )}
            </div>

            {/* Secondary recommendations */}
            {secondary.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {secondary.map((rec, idx) => {
                  const accent = PRIORITY_ACCENT[rec.priority] || PRIORITY_ACCENT.LOW;
                  return (
                    <div
                      key={idx}
                      className={`bg-white rounded-xl border border-slate-100 ${accent.border} border-l-4 p-3.5`}
                    >
                      <p className="text-xs font-bold text-slate-700 mb-1">
                        {rec.target}
                      </p>
                      {rec.problem && (
                         <p className="text-xs font-semibold text-slate-600 mb-1">{rec.problem}</p>
                      )}
                      <p className="text-[10px] text-slate-500 mb-3 line-clamp-2">
                        {rec.reason}
                      </p>
                      {rec.actionUrl ? (
                        <a
                          href={rec.actionUrl}
                          className={`text-[10px] font-bold ${accent.text} hover:underline flex items-center gap-1`}
                        >
                          {rec.actionLabel || rec.action}
                          <FiArrowRight className="w-3 h-3" />
                        </a>
                      ) : (
                        <p className={`text-[10px] font-bold ${accent.text}`}>
                          {rec.action}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
