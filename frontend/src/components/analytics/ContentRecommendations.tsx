import { Link } from 'react-router-dom';
import { ContentRecommendation } from '../../services/analytics.service';
import { FiArrowRight, FiStar, FiZap } from 'react-icons/fi';

interface Props {
  recommendations: ContentRecommendation[];
}

const typeStyles: Record<string, { bg: string; text: string; label: string }> = {
  REVIEW_NEEDED: { bg: 'bg-amber-50 border-amber-100', text: 'text-amber-700', label: 'Cần ôn lại' },
  SKILL_UP: { bg: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-700', label: 'Nâng cao kỹ năng' },
  TRENDING_MATCH: { bg: 'bg-rose-50 border-rose-100', text: 'text-rose-700', label: 'Phù hợp với bạn' },
  PATH_NEXT: { bg: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-700', label: 'Bước tiếp theo' },
};

function ConfidenceMeter({ value }: { value: number }) {
  const width = Math.min(value, 100);
  let color = 'from-slate-400 to-slate-300';
  if (value >= 80) color = 'from-emerald-500 to-emerald-400';
  else if (value >= 60) color = 'from-emerald-500 to-emerald-400';
  else if (value >= 40) color = 'from-amber-500 to-amber-400';

  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 bg-slate-100 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-700`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="text-[9px] font-bold text-slate-400">{value}%</span>
    </div>
  );
}

export default function ContentRecommendations({ recommendations }: Props) {
  if (recommendations.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
          <FiStar className="text-amber-500" />
          Đề xuất nội dung
        </h3>
        <div className="text-center py-8">
          <p className="text-4xl mb-3">📖</p>
          <p className="text-sm text-slate-500 font-medium">
            Hãy học thêm để hệ thống phân tích và đề xuất nội dung phù hợp cho bạn.
          </p>
        </div>
      </div>
    );
  }

  // Group by type
  const grouped: Record<string, ContentRecommendation[]> = {};
  recommendations.forEach((r) => {
    if (!grouped[r.type]) grouped[r.type] = [];
    grouped[r.type].push(r);
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <FiStar className="text-amber-500" />
          Đề xuất nội dung phù hợp
          <span className="text-[10px] bg-amber-100 text-amber-600 font-bold px-2 py-0.5 rounded-full">
            AI
          </span>
        </h3>
      </div>

      {/* Type Tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {Object.keys(grouped).map((type) => {
          const style = typeStyles[type] || typeStyles['REVIEW_NEEDED'];
          return (
            <span key={type} className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${style.bg} ${style.text}`}>
              {style.label} ({grouped[type].length})
            </span>
          );
        })}
      </div>

      {/* Recommendation Cards */}
      <div className="space-y-3">
        {recommendations.map((rec) => {
          const style = typeStyles[rec.type] || typeStyles['REVIEW_NEEDED'];

          return (
            <Link
              key={rec.id}
              to={rec.actionUrl}
              className={`block border rounded-xl p-4 transition-all duration-200 hover:shadow-sm hover:scale-[1.005] group ${style.bg}`}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">{rec.icon}</span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-bold text-slate-900 group-hover:text-emerald-600 transition-colors truncate">
                      {rec.title}
                    </h4>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full ${style.text} bg-white/60`}>
                      {style.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-2">
                    {rec.description}
                  </p>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-[10px] text-slate-400 italic line-clamp-1">
                      <FiZap className="inline mr-1" /> {rec.reason}
                    </p>
                    <ConfidenceMeter value={rec.confidence} />
                  </div>
                </div>

                <FiArrowRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
