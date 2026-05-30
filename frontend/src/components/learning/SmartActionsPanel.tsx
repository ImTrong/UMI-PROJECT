import { Link } from 'react-router-dom';
import { FiArrowRight, FiZap } from 'react-icons/fi';
import { SmartAction } from '../../services/recommendation.service';


const priorityStyles: Record<string, string> = {
  HIGH: 'border-l-rose-500 bg-rose-50/30',
  MEDIUM: 'border-l-amber-500 bg-amber-50/30',
  LOW: 'border-l-slate-300 bg-slate-50/30',
};

const priorityBadge: Record<string, { label: string; color: string }> = {
  HIGH: { label: 'Ưu tiên cao', color: 'bg-rose-100 text-rose-700' },
  MEDIUM: { label: 'Trung bình', color: 'bg-amber-100 text-amber-700' },
  LOW: { label: 'Gợi ý', color: 'bg-slate-100 text-slate-600' },
};

export interface Props {
  actions: SmartAction[];
  onActionClick?: (action: SmartAction, e: React.MouseEvent) => void;
}

export default function SmartActionsPanel({ actions, onActionClick }: Props) {
  if (actions.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
          <FiZap className="text-amber-500" />
          Gợi ý hành động
        </h3>
        <div className="text-center py-6">
          <p className="text-4xl mb-3">🎯</p>
          <p className="text-sm text-slate-500 font-medium">
            Chưa có gợi ý nào. Hãy đăng ký khóa học để bắt đầu!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6">
      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
        <FiZap className="text-amber-500 animate-pulse" />
        Gợi ý hành động thông minh
        <span className="text-[10px] bg-emerald-100 text-emerald-600 font-bold px-2 py-0.5 rounded-full">
          {actions.length}
        </span>
      </h3>

      <div className="space-y-2.5">
        {actions.map((action) => {
          const badge = priorityBadge[action.priority];
          const style = priorityStyles[action.priority];

          return (
            <Link
              key={action.id}
              to={action.actionUrl}
              onClick={(e) => onActionClick && onActionClick(action, e)}
              className={`block border-l-[3px] rounded-xl p-3.5 transition-all duration-200 hover:shadow-sm hover:scale-[1.01] group ${style}`}
            >
              <div className="flex items-start gap-3">
                {/* Icon */}
                <span className="text-xl flex-shrink-0 mt-0.5">{action.icon}</span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-bold text-slate-900 group-hover:text-emerald-600 transition-colors truncate">
                      {action.title}
                    </h4>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full flex-shrink-0 ${badge.color}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed line-clamp-2">
                    {action.description}
                  </p>

                  {/* Progress bar for applicable actions */}
                  {action.metadata?.progressPercentage !== undefined && action.metadata.progressPercentage > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 bg-slate-200/60 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-500"
                          style={{ width: `${action.metadata.progressPercentage}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-slate-500">
                        {Math.round(action.metadata.progressPercentage)}%
                      </span>
                    </div>
                  )}
                </div>

                {/* Arrow */}
                <FiArrowRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
