import { useState, useEffect } from 'react';
import { OptimalSchedule, OptimalScheduleSlot } from '../../services/analytics.service';
import { FiCalendar, FiCheck, FiEdit2, FiTrash2, FiPlus, FiSave, FiX, FiBook, FiRefreshCw, FiEdit3, FiMonitor, FiCpu } from 'react-icons/fi';

interface Props {
  schedule: OptimalSchedule;
  isSaved: boolean;
  onSave: (schedule: OptimalSchedule) => void;
}

const activityColors: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  NEW_LESSON: { bg: 'bg-emerald-100 border-emerald-200', text: 'text-emerald-700', icon: <FiBook className="w-4 h-4" /> },
  REVIEW: { bg: 'bg-teal-100 border-teal-200', text: 'text-teal-700', icon: <FiRefreshCw className="w-4 h-4" /> },
  QUIZ: { bg: 'bg-amber-100 border-amber-200', text: 'text-amber-700', icon: <FiEdit3 className="w-4 h-4" /> },
  PRACTICE: { bg: 'bg-cyan-100 border-cyan-200', text: 'text-cyan-700', icon: <FiMonitor className="w-4 h-4" /> },
};

const activityLabels: Record<string, string> = {
  NEW_LESSON: 'Học bài mới',
  REVIEW: 'Ôn tập',
  QUIZ: 'Làm bài kiểm tra',
  PRACTICE: 'Thực hành',
};

const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const FULL_DAY_LABELS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

export default function OptimalScheduleView({ schedule, isSaved, onSave }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editableSchedule, setEditableSchedule] = useState<OptimalSchedule>(schedule);
  const [addingSlotDay, setAddingSlotDay] = useState<number | null>(null);

  const [newSlotStart, setNewSlotStart] = useState('19:00');
  const [newSlotEnd, setNewSlotEnd] = useState('20:00');
  const [newSlotType, setNewSlotType] = useState<OptimalScheduleSlot['activityType']>('NEW_LESSON');

  useEffect(() => {
    setEditableSchedule(schedule);
  }, [schedule]);

  const handleSave = () => {
    onSave(editableSchedule);
    setIsEditing(false);
    setAddingSlotDay(null);
  };

  const handleCancel = () => {
    setEditableSchedule(schedule);
    setIsEditing(false);
    setAddingSlotDay(null);
  };

  const handleDeleteSlot = (dayOfWeek: number, index: number) => {
    const newSlots = [...editableSchedule.slots];
    const daySlots = newSlots.filter(s => s.dayOfWeek === dayOfWeek).sort((a, b) => a.startHour - b.startHour);
    const slotToDelete = daySlots[index];
    const flatIndex = newSlots.findIndex(s => s === slotToDelete);
    if (flatIndex > -1) {
      newSlots.splice(flatIndex, 1);
      setEditableSchedule({ ...editableSchedule, slots: newSlots });
    }
  };

  const handleAddSlot = (dayOfWeek: number) => {
    const [startHour, startMinute] = newSlotStart.split(':').map(Number);
    const [endHour, endMinute] = newSlotEnd.split(':').map(Number);
    
    const startValue = startHour * 60 + startMinute;
    const endValue = endHour * 60 + endMinute;

    if (startValue >= endValue) {
      alert('Giờ bắt đầu phải nhỏ hơn giờ kết thúc');
      return;
    }
    
    const newSlot: OptimalScheduleSlot = {
      dayOfWeek,
      dayLabel: FULL_DAY_LABELS[dayOfWeek],
      startHour,
      startMinute,
      endHour,
      endMinute,
      activityType: newSlotType,
      activityLabel: activityLabels[newSlotType],
      confidence: 100,
    };
    
    setEditableSchedule({
      ...editableSchedule,
      slots: [...editableSchedule.slots, newSlot]
    });
    setAddingSlotDay(null);
  };

  const slotsByDay: Record<number, OptimalScheduleSlot[]> = {};
  for (let d = 0; d < 7; d++) slotsByDay[d] = [];
  editableSchedule.slots.forEach((slot) => {
    if (!slotsByDay[slot.dayOfWeek]) slotsByDay[slot.dayOfWeek] = [];
    slotsByDay[slot.dayOfWeek].push(slot);
  });
  Object.values(slotsByDay).forEach((slots) => {
    slots.sort((a, b) => {
      const aStart = a.startHour * 60 + (a.startMinute || 0);
      const bStart = b.startHour * 60 + (b.startMinute || 0);
      return aStart - bStart;
    });
  });

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <FiCalendar className="text-emerald-500" />
            Lịch học tối ưu
          </h3>
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl text-slate-500 hover:bg-slate-100 transition-all"
                >
                  <FiX /> Hủy
                </button>
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition-all"
                >
                  <FiSave /> Lưu lịch
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-all"
                >
                  <FiEdit2 /> Tùy chỉnh
                </button>
                {!isSaved && (
                  <button
                    onClick={() => onSave(editableSchedule)}
                    className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition-all"
                  >
                    Áp dụng lịch này
                  </button>
                )}
                {isSaved && (
                  <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-700">
                    <FiCheck /> Đang áp dụng
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {!isEditing && (
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl p-4 mb-5 border border-emerald-100">
            <p className="text-xs text-emerald-700 leading-relaxed flex items-start gap-1.5">
              <FiCpu className="w-4 h-4 flex-shrink-0 mt-0.5" /> 
              <span><span className="font-bold">AI phân tích:</span> {schedule.reasoning}</span>
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-slate-50 rounded-xl p-3 text-center">
            <p className="text-xl font-black text-slate-900">{editableSchedule.weeklyTargetHours}h</p>
            <p className="text-[10px] text-slate-500 font-medium">Mục tiêu/tuần</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-3 text-center">
            <p className="text-xl font-black text-slate-900">{editableSchedule.dailyTargetMinutes}p</p>
            <p className="text-[10px] text-slate-500 font-medium">Mục tiêu/ngày</p>
          </div>
        </div>

        <div className="space-y-2">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const daySlots = slotsByDay[d] || [];
            const isToday = new Date().getDay() === d;

            return (
              <div
                key={d}
                className={`flex flex-col gap-2 p-3 rounded-xl transition-all duration-200 ${
                  isToday
                    ? 'bg-emerald-50/50 border border-emerald-100 ring-1 ring-emerald-200'
                    : 'bg-slate-50/50 border border-transparent hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-12 flex-shrink-0 text-center pt-0.5">
                    <p className={`text-xs font-bold ${isToday ? 'text-emerald-600' : 'text-slate-600'}`}>
                      {DAY_LABELS[d]}
                    </p>
                    {isToday && (
                      <span className="text-[8px] bg-emerald-600 text-white font-bold px-1.5 py-0.5 rounded-full inline-block mt-1">
                        Hôm nay
                      </span>
                    )}
                  </div>

                  <div className="flex-1 flex flex-wrap gap-2 items-center">
                    {daySlots.length === 0 && !isEditing ? (
                      <span className="text-[11px] text-slate-400 italic py-1">Nghỉ ngơi</span>
                    ) : (
                      daySlots.map((slot, idx) => {
                        const colors = activityColors[slot.activityType] || activityColors['NEW_LESSON'];
                        return (
                          <div
                            key={idx}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${colors.bg} transition-all duration-200 hover:shadow-sm relative group`}
                          >
                            <span className="flex items-center justify-center w-6 h-6">{colors.icon}</span>
                            <div>
                              <p className={`text-[11px] font-bold ${colors.text}`}>
                                {slot.startHour}:{String(slot.startMinute || 0).padStart(2, '0')} — {slot.endHour}:{String(slot.endMinute || 0).padStart(2, '0')}
                              </p>
                              <p className="text-[10px] text-slate-500">{slot.activityLabel}</p>
                            </div>
                            
                            {isEditing && (
                              <button 
                                onClick={() => handleDeleteSlot(d, idx)}
                                className="absolute -top-1.5 -right-1.5 bg-white border border-red-200 text-red-500 rounded-full p-1 opacity-0 group-hover:opacity-100 hover:bg-red-50 transition-all shadow-sm"
                              >
                                <FiTrash2 size={10} />
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                    
                    {isEditing && addingSlotDay !== d && (
                      <button 
                        onClick={() => setAddingSlotDay(d)}
                        className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-bold text-slate-500 bg-white border border-slate-100 hover:border-emerald-300 hover:text-emerald-600 rounded-xl transition-all border-dashed"
                      >
                        <FiPlus /> Thêm giờ
                      </button>
                    )}
                  </div>
                </div>

                {/* Add new slot form */}
                {isEditing && addingSlotDay === d && (
                  <div className="ml-15 mt-2 flex items-center gap-2 bg-white p-2 rounded-xl border border-slate-100 shadow-sm animate-fadeIn">
                    <input 
                      type="time"
                      value={newSlotStart} 
                      onChange={e => setNewSlotStart(e.target.value)}
                      className="text-xs border-slate-100 rounded p-1"
                    />
                    <span className="text-slate-400 text-xs">-</span>
                    <input 
                      type="time"
                      value={newSlotEnd} 
                      onChange={e => setNewSlotEnd(e.target.value)}
                      className="text-xs border-slate-100 rounded p-1"
                    />
                    <select 
                      value={newSlotType} 
                      onChange={e => setNewSlotType(e.target.value as any)}
                      className="text-xs border-slate-100 rounded p-1 max-w-[120px]"
                    >
                      {Object.entries(activityLabels).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                    
                    <div className="flex gap-1 ml-auto">
                      <button onClick={() => setAddingSlotDay(null)} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors">
                        <FiX size={14} />
                      </button>
                      <button onClick={() => handleAddSlot(d)} className="p-1.5 text-emerald-600 hover:text-emerald-800 transition-colors bg-emerald-50 rounded">
                        <FiCheck size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
        <h4 className="text-xs font-bold text-slate-700 mb-3">Chú thích</h4>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(activityColors).map(([type, colors]) => (
            <div key={type} className="flex items-center gap-2">
              <span className="flex items-center justify-center w-4 h-4">{colors.icon}</span>
              <span className={`text-[11px] font-semibold ${colors.text}`}>{activityLabels[type]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
