import { Link } from 'react-router-dom';
import { StudyReminder } from '../../services/analytics.service';
import { FiArrowRight, FiBell } from 'react-icons/fi';

interface Props {
  reminders: StudyReminder[];
}

const urgencyStyles: Record<string, { border: string; bg: string; pulse: boolean }> = {
  CRITICAL: { border: 'border-l-red-500', bg: 'bg-red-50/50', pulse: true },
  HIGH: { border: 'border-l-orange-500', bg: 'bg-orange-50/30', pulse: false },
  MEDIUM: { border: 'border-l-amber-400', bg: 'bg-amber-50/30', pulse: false },
  LOW: { border: 'border-l-slate-300', bg: 'bg-slate-50/30', pulse: false },
};

const urgencyBadge: Record<string, { label: string; color: string }> = {
  CRITICAL: { label: 'Khẩn cấp', color: 'bg-red-100 text-red-700 animate-pulse' },
  HIGH: { label: 'Quan trọng', color: 'bg-orange-100 text-orange-700' },
  MEDIUM: { label: 'Nhắc nhở', color: 'bg-amber-100 text-amber-700' },
  LOW: { label: 'Gợi ý', color: 'bg-slate-100 text-slate-600' },
};

export default function StudyReminders({ reminders }: Props) {
  if (reminders.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
          <FiBell className="text-emerald-500" />
          Nhắc nhở học tập
        </h3>
        <div className="text-center py-8">
          <p className="text-4xl mb-3">🎉</p>
          <p className="text-sm text-slate-500 font-medium">
            Tuyệt vời! Không có nhắc nhở nào. Hãy tiếp tục giữ vững phong độ!
          </p>
        </div>
      </div>
    );
  }

  const criticalCount = reminders.filter((r) => r.urgency === 'CRITICAL').length;
  const highCount = reminders.filter((r) => r.urgency === 'HIGH').length;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <FiBell className={`text-emerald-500 ${criticalCount > 0 ? 'animate-bounce' : ''}`} />
          Nhắc nhở học tập
          <span className="text-[10px] bg-emerald-100 text-emerald-600 font-bold px-2 py-0.5 rounded-full">
            {reminders.length}
          </span>
        </h3>

        {(criticalCount > 0 || highCount > 0) && (
          <div className="flex gap-1.5">
            {criticalCount > 0 && (
              <span className="text-[9px] bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full animate-pulse">
                {criticalCount} khẩn cấp
              </span>
            )}
            {highCount > 0 && (
              <span className="text-[9px] bg-orange-100 text-orange-700 font-bold px-2 py-0.5 rounded-full">
                {highCount} quan trọng
              </span>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2.5 max-h-[400px] overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        {reminders.map((reminder) => {
          const style = urgencyStyles[reminder.urgency];
          const badge = urgencyBadge[reminder.urgency];

          const content = (
            <div
              className={`border-l-[3px] ${style.border} ${style.bg} rounded-xl p-4 transition-all duration-200 hover:shadow-sm hover:scale-[1.005] group ${
                style.pulse ? 'animate-[pulse_3s_ease-in-out_infinite]' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-xl flex-shrink-0 mt-0.5">{reminder.icon}</span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-bold text-slate-900 group-hover:text-emerald-600 transition-colors">
                      {reminder.title}
                    </h4>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full flex-shrink-0 ${badge.color}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {reminder.description}
                  </p>

                  {/* Progress bar for course reminders */}
                  {reminder.metadata?.progressPercentage !== undefined && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 bg-slate-200/60 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-500"
                          style={{ width: `${reminder.metadata.progressPercentage}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-slate-500">
                        {Math.round(reminder.metadata.progressPercentage)}%
                      </span>
                    </div>
                  )}
                </div>

                {reminder.actionUrl && (
                  <FiArrowRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" />
                )}
              </div>
            </div>
          );

          return reminder.actionUrl ? (
            <Link key={reminder.id} to={reminder.actionUrl} className="block">
              {content}
            </Link>
          ) : (
            <div key={reminder.id}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}
