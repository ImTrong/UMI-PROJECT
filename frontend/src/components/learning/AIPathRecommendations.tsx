import { FiZap, FiMap, FiArrowRight } from 'react-icons/fi';

interface AIRecommendation {
  reason: string;
  score: number;
}

interface RecommendedPath {
  id: string;
  title: string;
  description: string;
  slug: string;
  imageUrl?: string;
  difficulty: string;
  aiRecommendation?: AIRecommendation;
}

interface AIPathRecommendationsProps {
  paths: RecommendedPath[];
  loading: boolean;
  onSelectPath: (pathId: string) => void;
}

export default function AIPathRecommendations({ paths, loading, onSelectPath }: AIPathRecommendationsProps) {
  if (loading) {
    return (
      <section className="mb-12 animate-pulse">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2 mb-6">
          <FiZap className="text-amber-500" />
          AI Đang tính toán lộ trình tối ưu...
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          {[1, 2].map(i => (
            <div key={i} className="h-48 bg-slate-100 rounded-2xl border border-slate-200"></div>
          ))}
        </div>
      </section>
    );
  }

  if (!paths || paths.length === 0) {
    return null; // Don't show if no recommendations
  }

  return (
    <section className="mb-12 relative">
      {/* Decorative background glow */}
      <div className="absolute -inset-4 bg-gradient-to-r from-emerald-50 via-teal-50 to-cyan-50 rounded-3xl opacity-50 -z-10 blur-xl"></div>
      
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 flex items-center justify-center text-white shadow-md">
            <FiZap className="w-4 h-4" />
          </div>
          Đề xuất thông minh từ AI
        </h2>
        <span className="text-xs font-semibold text-emerald-600 bg-emerald-100 px-3 py-1 rounded-full border border-emerald-200">
          Cá nhân hóa cho bạn
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {paths.map((path) => (
          <div 
            key={path.id}
            onClick={() => onSelectPath(path.id)}
            className="group cursor-pointer relative overflow-hidden bg-white rounded-2xl border border-emerald-100 shadow-sm hover:shadow-xl hover:border-emerald-300 transition-all duration-500 flex flex-col h-full"
          >
            {/* Top highlight bar */}
            <div className="h-1 w-full bg-gradient-to-r from-emerald-400 to-teal-500"></div>
            
            <div className="p-6 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-2">
                  {path.imageUrl ? (
                    <img src={path.imageUrl} alt={path.title} className="w-12 h-12 rounded-lg object-cover shadow-sm" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-emerald-50 text-emerald-500 flex items-center justify-center">
                      <FiMap className="w-6 h-6" />
                    </div>
                  )}
                  <div>
                    <h3 className="font-bold text-slate-900 leading-tight group-hover:text-emerald-600 transition-colors">{path.title}</h3>
                    <span className="text-[11px] font-medium text-slate-500 mt-1 block">
                      Độ khó: {path.difficulty}
                    </span>
                  </div>
                </div>
                {path.aiRecommendation?.score && (
                  <div className="flex flex-col items-center justify-center bg-slate-50 w-12 h-12 rounded-full border border-slate-100 group-hover:bg-emerald-50 group-hover:border-emerald-200 transition-colors">
                    <span className="text-[10px] text-slate-400 font-bold leading-none mb-0.5">MATCH</span>
                    <span className="text-sm font-black text-emerald-600 leading-none">{path.aiRecommendation.score}%</span>
                  </div>
                )}
              </div>

              {/* AI Reason box */}
              <div className="bg-gradient-to-br from-slate-50 to-emerald-50/30 rounded-xl p-4 mt-auto border border-slate-100 group-hover:border-emerald-100/50 transition-colors relative">
                <div className="absolute -top-3 left-4 bg-white px-2 text-[10px] font-bold text-emerald-600 flex items-center gap-1 border border-emerald-100 rounded-full shadow-sm">
                  <FiZap className="w-3 h-3" /> Lời khuyên từ AI
                </div>
                <p className="text-sm text-slate-600 leading-relaxed italic mt-1">
                  "{path.aiRecommendation?.reason}"
                </p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-50 bg-slate-50/50 flex items-center justify-between group-hover:bg-emerald-50/30 transition-colors">
              <span className="text-xs font-bold text-emerald-600">Xem chi tiết lộ trình</span>
              <div className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center group-hover:bg-emerald-500 group-hover:text-white transition-all text-slate-400">
                <FiArrowRight className="w-4 h-4" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
