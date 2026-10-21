import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import {
  leaderboardService,
  LeaderboardData,
  LeaderboardEntry,
  UserRank,
  AvailableMonth,
  CourseScoreItem,
  UserRewardPoints,
} from '../services/leaderboard.service'
import toast from 'react-hot-toast'

const MONTH_NAMES = [
  '', 'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
  'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
]

export default function Leaderboard() {
  const { isAuthenticated } = useAuth()
  const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null)
  const [myRank, setMyRank] = useState<UserRank | null>(null)
  const [myPoints, setMyPoints] = useState<UserRewardPoints | null>(null)
  const [availableMonths, setAvailableMonths] = useState<AvailableMonth[]>([])
  const [selectedMonth, setSelectedMonth] = useState<{ month: number; year: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [isCurrentMonth, setIsCurrentMonth] = useState(true)

  // Breakdown modal state
  const [selectedBreakdown, setSelectedBreakdown] = useState<{
    userName: string;
    points: number;
    items: CourseScoreItem[];
  } | null>(null)

  // Policy modal state
  const [showPolicyModal, setShowPolicyModal] = useState(false)

  // Redemption modal state
  const [showRedeemModal, setShowRedeemModal] = useState(false)
  const [redeemCourseId, setRedeemCourseId] = useState('')
  const [redeemPoints, setRedeemPoints] = useState(500)
  const [redeemRequestId, setRedeemRequestId] = useState('')
  const [isRedeeming, setIsRedeeming] = useState(false)
  const [redeemError, setRedeemError] = useState<string | null>(null)
  const [redeemSuccess, setRedeemSuccess] = useState<string | null>(null)
  const [canRetrySameKey, setCanRetrySameKey] = useState(false)

  const openRedeemModal = () => {
    const newKey = `redeem_req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    setRedeemRequestId(newKey)
    setRedeemCourseId('')
    setRedeemPoints(500)
    setRedeemError(null)
    setRedeemSuccess(null)
    setCanRetrySameKey(false)
    setShowRedeemModal(true)
  }

  const handleRedeem = async (useExistingKey: boolean = false) => {
    if (isRedeeming) return
    if (!redeemCourseId.trim()) {
      setRedeemError('Vui lòng nhập ID khóa học muốn đổi.')
      return
    }

    const currentKey = useExistingKey && redeemRequestId
      ? redeemRequestId
      : `redeem_req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

    if (!useExistingKey) {
      setRedeemRequestId(currentKey)
    }

    setIsRedeeming(true)
    setRedeemError(null)
    setRedeemSuccess(null)

    try {
      const res = await leaderboardService.redeemCourse(redeemCourseId.trim(), redeemPoints, currentKey)
      if (res.data?.status === 'ALREADY_COMPLETED' || res.data?.isIdempotentReplay) {
        setRedeemSuccess(`Khóa học đã được đổi thành công trước đó (Giao dịch cũ: ${res.data.transaction?.id}). Số dư ví: ${res.data.remainingBalance} điểm.`)
        toast.success('Giao dịch đã hoàn tất trước đó!')
      } else {
        setRedeemSuccess(`Đổi khóa học thành công! Số dư còn lại: ${res.data?.remainingBalance ?? '---'} điểm.`)
        toast.success('Đổi khóa học thành công!')
      }
      setCanRetrySameKey(false)
      leaderboardService.getMyRewardPoints().then(setMyPoints).catch(() => {})
    } catch (err: any) {
      const status = err.response?.status
      const errMsg = err.response?.data?.error || err.message || 'Đổi khóa học thất bại'

      if (status === 409 && err.response?.data?.data?.status === 'ALREADY_REFUNDED') {
        setRedeemError('Yêu cầu đổi điểm này trước đó đã thất bại và số điểm đã được hoàn lại ví. Vui lòng tạo yêu cầu mới nếu muốn thử lại.')
        setCanRetrySameKey(false)
      } else if (status === 409 && errMsg.includes('Xung đột khóa')) {
        setRedeemError(errMsg)
        setCanRetrySameKey(false)
      } else if (!status || status >= 500) {
        setRedeemError(`Lỗi kết nối hoặc phản hồi chậm từ máy chủ (${errMsg}). Bạn có thể nhấn "Thử lại cùng mã" để gửi lại an toàn mà không sợ bị trừ điểm lần 2.`)
        setCanRetrySameKey(true)
      } else {
        setRedeemError(errMsg)
        setCanRetrySameKey(false)
      }
    } finally {
      setIsRedeeming(false)
    }
  }

  const handleStartFreshRequest = () => {
    const newKey = `redeem_req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    setRedeemRequestId(newKey)
    setRedeemError(null)
    setRedeemSuccess(null)
    setCanRetrySameKey(false)
  }

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  const fetchLeaderboard = useCallback(async (month?: number, year?: number) => {
    setLoading(true)
    try {
      let data: LeaderboardData
      if (!month || !year || (month === currentMonth && year === currentYear)) {
        data = await leaderboardService.getCurrentLeaderboard()
        setIsCurrentMonth(true)
      } else {
        data = await leaderboardService.getHistoryLeaderboard(month, year)
        setIsCurrentMonth(false)
      }
      setLeaderboard(data)
    } catch (err: any) {
      toast.error('Không thể tải bảng xếp hạng')
    } finally {
      setLoading(false)
    }
  }, [currentMonth, currentYear])

  useEffect(() => {
    fetchLeaderboard()

    leaderboardService.getAvailableMonths().then(setAvailableMonths).catch(() => {})

    if (isAuthenticated) {
      leaderboardService.getMyRank().then(setMyRank).catch(() => {})
      leaderboardService.getMyRewardPoints().then(setMyPoints).catch(() => {})
    }
  }, [fetchLeaderboard, isAuthenticated])

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    if (val === 'current') {
      setSelectedMonth(null)
      fetchLeaderboard()
    } else {
      const [m, y] = val.split('-').map(Number)
      setSelectedMonth({ month: m, year: y })
      fetchLeaderboard(m, y)
    }
  }

  const top3 = leaderboard?.entries.slice(0, 3) ?? []

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50/30">
      <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold mb-3 shadow-sm">
            <span>✨ Chu kỳ xếp hạng tháng {selectedMonth ? `${selectedMonth.month}/${selectedMonth.year}` : `${currentMonth}/${currentYear}`}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            🏆 Bảng Xếp Hạng Học Viên
          </h1>
          <p className="mt-2 text-slate-500 text-sm sm:text-base max-w-2xl mx-auto">
            Vinh danh thành tích học tập theo khối lượng tri thức và độ khó khóa học. Chốt kết quả vào 00:05 ngày 1 hàng tháng!
          </p>

          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              onClick={() => setShowPolicyModal(true)}
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100/70 px-3 py-1.5 rounded-lg transition-colors border border-emerald-100 flex items-center gap-1.5"
            >
              <span>ℹ️</span> Xem quy tắc tính điểm & phần thưởng
            </button>
          </div>
        </div>

        {/* Month Selector & Status */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
          <label htmlFor="month-select" className="text-sm font-semibold text-slate-600">
            Xem kỳ:
          </label>
          <select
            id="month-select"
            value={selectedMonth ? `${selectedMonth.month}-${selectedMonth.year}` : 'current'}
            onChange={handleMonthChange}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700
                       focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500
                       shadow-sm cursor-pointer transition-all"
          >
            <option value="current">
              {MONTH_NAMES[currentMonth]} {currentYear} (Đang diễn ra)
            </option>
            {availableMonths.map((m) => (
              <option key={`${m.month}-${m.year}`} value={`${m.month}-${m.year}`}>
                {MONTH_NAMES[m.month]} {m.year}
              </option>
            ))}
          </select>
          {leaderboard?.status === 'FINALIZED' ? (
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold border border-emerald-200 shadow-sm">
              ✓ Đã chốt kết quả
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-bold border border-amber-200 shadow-sm animate-pulse">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span> Đang cập nhật trực tiếp
            </span>
          )}
        </div>

        {/* Loading state */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600"></div>
          </div>
        ) : leaderboard && leaderboard.entries.length === 0 ? (
          /* Empty state */
          <div className="text-center py-20 bg-white rounded-2xl border border-slate-100 p-8 shadow-sm">
            <div className="text-6xl mb-4">📭</div>
            <h3 className="text-lg font-bold text-slate-700 mb-2">Chưa có dữ liệu thành tích</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              {isCurrentMonth
                ? 'Chưa có học viên nào hoàn thành khóa học hợp lệ trong tháng này. Hãy là người đầu tiên hoàn thành để dẫn đầu bảng xếp hạng!'
                : 'Không có dữ liệu xếp hạng cho kỳ này.'}
            </p>
          </div>
        ) : (
          <>
            {/* Podium — Top 3 */}
            {top3.length > 0 && (
              <div className="mb-10">
                <div className="flex items-end justify-center gap-3 sm:gap-6">
                  {/* Top 2 */}
                  {top3.length >= 2 && (
                    <PodiumCard
                      entry={top3[1]}
                      position={2}
                      onViewBreakdown={() =>
                        setSelectedBreakdown({
                          userName: top3[1].fullName,
                          points: top3[1].points,
                          items: top3[1].scoreBreakdown || [],
                        })
                      }
                    />
                  )}
                  {/* Top 1 */}
                  <PodiumCard
                    entry={top3[0]}
                    position={1}
                    onViewBreakdown={() =>
                      setSelectedBreakdown({
                        userName: top3[0].fullName,
                        points: top3[0].points,
                        items: top3[0].scoreBreakdown || [],
                      })
                    }
                  />
                  {/* Top 3 */}
                  {top3.length >= 3 && (
                    <PodiumCard
                      entry={top3[2]}
                      position={3}
                      onViewBreakdown={() =>
                        setSelectedBreakdown({
                          userName: top3[2].fullName,
                          points: top3[2].points,
                          items: top3[2].scoreBreakdown || [],
                        })
                      }
                    />
                  )}
                </div>
              </div>
            )}

            {/* Current User Rank & Wallet Card */}
            {isAuthenticated && myRank && (
              <div className="mb-8">
                <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 rounded-2xl p-5 sm:p-6 text-white shadow-xl shadow-emerald-200/50">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur border border-white/30 flex items-center justify-center text-xl font-black shadow-inner">
                        {myRank.rank ? (myRank.isTie ? `=${myRank.rank}` : `#${myRank.rank}`) : '—'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-base sm:text-lg">
                            {myRank.rank ? `Thứ hạng của bạn: #${myRank.rank}` : 'Bạn chưa có thành tích kỳ này'}
                          </p>
                          {myRank.isTie && (
                            <span className="text-[10px] uppercase font-bold bg-amber-400 text-slate-900 px-2 py-0.5 rounded-full">
                              Đồng hạng
                            </span>
                          )}
                        </div>
                        <p className="text-emerald-100 text-xs sm:text-sm mt-0.5">
                          {myRank.totalParticipants} học viên đang có thành tích kỳ này
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-5 text-sm">
                      <div className="text-center sm:text-right">
                        <p className="text-2xl font-black text-amber-300">{myRank.points}</p>
                        <p className="text-emerald-100 text-xs font-medium">Điểm thành tích</p>
                      </div>
                      <div className="text-center sm:text-right">
                        <p className="text-2xl font-black">{myRank.completedCourses}</p>
                        <p className="text-emerald-100 text-xs font-medium">Khóa học</p>
                      </div>
                      {myPoints && (
                        <div className="text-center sm:text-right border-l border-white/20 pl-4">
                          <p className="text-2xl font-black text-yellow-300">💎 {myPoints.balance}</p>
                          <p className="text-emerald-100 text-xs font-medium">Ví điểm thưởng</p>
                        </div>
                      )}
                      {myPoints && (
                        <button
                          onClick={openRedeemModal}
                          className="px-3.5 py-2 bg-amber-400 hover:bg-amber-300 text-slate-900 rounded-xl text-xs font-extrabold shadow transition-all hover:scale-105 flex items-center gap-1.5"
                        >
                          <span>🎁</span> Đổi khóa học
                        </button>
                      )}
                      {myRank.completedCourses > 0 && (
                        <button
                          onClick={() =>
                            setSelectedBreakdown({
                              userName: 'Bạn',
                              points: myRank.points,
                              items: myRank.scoreBreakdown,
                            })
                          }
                          className="px-3.5 py-2 bg-white text-emerald-800 hover:bg-emerald-50 rounded-xl text-xs font-bold shadow transition-all hover:scale-105"
                        >
                          Xem chi tiết điểm
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Full Ranking Table */}
            {leaderboard && leaderboard.entries.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="font-bold text-slate-800 text-base sm:text-lg">
                    Bảng xếp hạng chi tiết ({leaderboard.entries.length} học viên)
                  </h2>
                  <span className="text-xs text-slate-400">
                    Sắp xếp: Điểm thành tích ↓ · Số khóa ↓ · Điểm quiz ↓
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50/80 text-slate-500 text-xs uppercase tracking-wider">
                        <th className="text-center px-4 py-3 font-semibold w-16">Hạng</th>
                        <th className="text-left px-4 py-3 font-semibold">Học viên</th>
                        <th className="text-center px-4 py-3 font-semibold">Điểm thành tích</th>
                        <th className="text-center px-4 py-3 font-semibold">Khóa học</th>
                        <th className="text-center px-4 py-3 font-semibold">Điểm Quiz TB</th>
                        <th className="text-center px-4 py-3 font-semibold hidden sm:table-cell">Phần thưởng</th>
                        <th className="text-center px-4 py-3 font-semibold w-24">Chi tiết</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {leaderboard.entries.map((entry) => (
                        <RankRow
                          key={entry.userId}
                          entry={entry}
                          onViewBreakdown={() =>
                            setSelectedBreakdown({
                              userName: entry.fullName,
                              points: entry.points,
                              items: entry.scoreBreakdown || [],
                            })
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* Modal: Points Breakdown */}
        {selectedBreakdown && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div>
                  <h3 className="font-extrabold text-slate-900 text-lg">
                    Chi tiết điểm thành tích — {selectedBreakdown.userName}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Tổng điểm thành tích: <span className="font-bold text-emerald-600 text-sm">{selectedBreakdown.points} điểm</span>
                  </p>
                </div>
                <button
                  onClick={() => setSelectedBreakdown(null)}
                  className="w-8 h-8 rounded-full bg-slate-200/70 hover:bg-slate-300 text-slate-600 flex items-center justify-center text-sm font-bold transition-colors"
                >
                  ✕
                </button>
              </div>

              <div className="p-5 overflow-y-auto space-y-3">
                {selectedBreakdown.items.length === 0 ? (
                  <p className="text-center text-sm text-slate-400 py-8">Chưa có chi tiết khóa học cho bản ghi này.</p>
                ) : (
                  selectedBreakdown.items.map((item, idx) => (
                    <div key={idx} className="p-4 rounded-xl border border-slate-100 bg-slate-50/40 hover:bg-slate-50 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-slate-800 text-sm truncate">{item.courseTitle}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-slate-500">
                            <span className="px-2 py-0.5 rounded bg-slate-200/80 font-medium text-slate-700">
                              ⏱️ {item.durationHours} giờ
                            </span>
                            <span className={`px-2 py-0.5 rounded font-bold ${
                              item.level === 'ADVANCED' ? 'bg-purple-100 text-purple-700' :
                              item.level === 'INTERMEDIATE' ? 'bg-blue-100 text-blue-700' :
                              'bg-emerald-100 text-emerald-700'
                            }`}>
                              {item.level} (x{item.levelMultiplier})
                            </span>
                            {item.hasQuiz && item.averageQuizScore != null ? (
                              <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
                                📝 Quiz: {item.averageQuizScore}%
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-500">
                                Không có Quiz
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="text-right flex-shrink-0">
                          <span className="text-lg font-black text-emerald-600">+{item.achievementPoints}</span>
                          <p className="text-[10px] text-slate-400">
                            {item.basePoints}đ × {item.levelMultiplier}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
                <button
                  onClick={() => setSelectedBreakdown(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition-colors"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Policy & Rewards Explainer */}
        {showPolicyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="font-extrabold text-slate-900 text-lg">
                  📖 Quy Tắc Xếp Hạng & Phần Thưởng Hàng Tháng
                </h3>
                <button
                  onClick={() => setShowPolicyModal(false)}
                  className="w-8 h-8 rounded-full bg-slate-200/70 hover:bg-slate-300 text-slate-600 flex items-center justify-center text-sm font-bold transition-colors"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-6 text-sm text-slate-600">
                <div>
                  <h4 className="font-bold text-slate-900 text-base mb-2">1. Điểm cơ sở theo thời lượng khóa học</h4>
                  <p className="text-xs text-slate-500 mb-3">Tính bằng tổng thời lượng các bài học hợp lệ trong khóa:</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl border border-slate-100 bg-slate-50 text-center">
                      <p className="text-slate-500">Dưới 30 phút</p>
                      <p className="text-base font-bold text-emerald-600">2 điểm</p>
                    </div>
                    <div className="p-2.5 rounded-xl border border-slate-100 bg-slate-50 text-center">
                      <p className="text-slate-500">30p đến dưới 2h</p>
                      <p className="text-base font-bold text-emerald-600">5 điểm</p>
                    </div>
                    <div className="p-2.5 rounded-xl border border-slate-100 bg-slate-50 text-center">
                      <p className="text-slate-500">2h đến dưới 5h</p>
                      <p className="text-base font-bold text-emerald-600">10 điểm</p>
                    </div>
                    <div className="p-2.5 rounded-xl border border-slate-100 bg-slate-50 text-center">
                      <p className="text-slate-500">5h đến dưới 10h</p>
                      <p className="text-base font-bold text-emerald-600">20 điểm</p>
                    </div>
                    <div className="p-2.5 rounded-xl border border-slate-100 bg-slate-50 text-center">
                      <p className="text-slate-500">10h đến dưới 20h</p>
                      <p className="text-base font-bold text-emerald-600">30 điểm</p>
                    </div>
                    <div className="p-2.5 rounded-xl border border-slate-100 bg-slate-50 text-center">
                      <p className="text-slate-500">Từ 20h trở lên</p>
                      <p className="text-base font-bold text-emerald-600">40 điểm</p>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="font-bold text-slate-900 text-base mb-2">2. Hệ số cấp độ khóa học (Level Multiplier)</h4>
                  <p className="text-xs text-slate-500 mb-2">
                    <code>Điểm khóa học = Điểm cơ sở × Hệ số cấp độ</code>
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-xs">
                    <li><strong className="text-slate-800">Cơ bản (BEGINNER):</strong> Hệ số 1.0</li>
                    <li><strong className="text-slate-800">Trung cấp (INTERMEDIATE):</strong> Hệ số 1.1</li>
                    <li><strong className="text-slate-800">Nâng cao (ADVANCED):</strong> Hệ số 1.2</li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-bold text-slate-900 text-base mb-2">3. Tiêu chí phân định thứ hạng</h4>
                  <ol className="list-decimal pl-5 space-y-1.5 text-xs">
                    <li><strong>Tổng điểm thành tích tháng:</strong> Giảm dần (tiêu chí ưu tiên số 1).</li>
                    <li><strong>Số khóa học hoàn thành:</strong> Giảm dần nếu bằng điểm.</li>
                    <li><strong>Điểm Quiz trung bình:</strong> Giảm dần đối với các khóa có bài thi (không tính khóa không có quiz).</li>
                    <li><strong>Thời gian hoàn thành:</strong> Người hoàn thành khóa cuối sớm hơn xếp trên.</li>
                    <li><strong>Đồng hạng:</strong> Nếu cả 4 tiêu chí bằng nhau, áp dụng chia sẻ thứ hạng và cùng nhận phần thưởng đầy đủ.</li>
                  </ol>
                </div>

                <div>
                  <h4 className="font-bold text-slate-900 text-base mb-2">4. Cơ cấu phần thưởng tháng</h4>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                      <span className="font-bold text-amber-900">🥇 Hạng 1: Nhà vô địch tháng</span>
                      <span className="font-extrabold text-amber-700">+1.000 điểm thưởng + Huy hiệu vàng</span>
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-100 border border-slate-200">
                      <span className="font-bold text-slate-800">🥈 Hạng 2: Á quân tháng</span>
                      <span className="font-extrabold text-slate-700">+700 điểm thưởng + Huy hiệu bạc</span>
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-orange-50 border border-orange-200">
                      <span className="font-bold text-orange-900">🥉 Hạng 3: Top 3 tháng</span>
                      <span className="font-extrabold text-orange-700">+500 điểm thưởng + Huy hiệu đồng</span>
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                      <span className="font-bold text-emerald-900">🎖️ Hạng 4 - 10: Top 10 tháng</span>
                      <span className="font-extrabold text-emerald-700">+200 điểm thưởng/người + Huy hiệu Top 10</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
                <button
                  onClick={() => setShowPolicyModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition-colors"
                >
                  Đã hiểu
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Redeem Course with Reward Points */}
        {showRedeemModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white rounded-2xl max-w-lg w-full flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-amber-50 to-orange-50">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">🎁</span>
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-base sm:text-lg">
                      Đổi Điểm Lấy Khóa Học
                    </h3>
                    <p className="text-xs text-slate-500">
                      Ví của bạn: <strong className="text-amber-600">💎 {myPoints?.balance ?? 0} điểm</strong>
                    </p>
                  </div>
                </div>
                <button
                  disabled={isRedeeming}
                  onClick={() => setShowRedeemModal(false)}
                  className="w-8 h-8 rounded-full bg-slate-200/70 hover:bg-slate-300 text-slate-600 flex items-center justify-center text-sm font-bold transition-colors disabled:opacity-50"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 space-y-4 text-sm text-slate-600">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Mã khóa học (Course ID):
                  </label>
                  <input
                    type="text"
                    disabled={isRedeeming}
                    value={redeemCourseId}
                    onChange={(e) => setRedeemCourseId(e.target.value)}
                    placeholder="Nhập mã ObjectId khóa học..."
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono"
                  />
                </div>

                <div className="flex items-center justify-between text-xs p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-slate-500 font-medium">Chi phí đổi:</span>
                  <span className="font-black text-amber-600 text-sm">{redeemPoints} điểm thưởng</span>
                </div>

                {/* Idempotency Key Status Display */}
                <div className="text-[11px] p-2.5 bg-slate-100 rounded-lg text-slate-500 font-mono break-all">
                  <span className="font-bold text-slate-600">ClientRequestId: </span>
                  {redeemRequestId || '(chưa tạo)'}
                </div>

                {/* Status Messages */}
                {redeemError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                    <p className="font-bold">⚠️ Có lỗi xảy ra:</p>
                    <p className="mt-1">{redeemError}</p>
                  </div>
                )}

                {redeemSuccess && (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
                    <p className="font-bold">🎉 Thành công:</p>
                    <p className="mt-1">{redeemSuccess}</p>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-end gap-2">
                {canRetrySameKey ? (
                  <button
                    disabled={isRedeeming}
                    onClick={() => handleRedeem(true)}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-all shadow disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {isRedeeming ? '🔄 Đang thử lại...' : '🔁 Thử lại cùng mã (An toàn)'}
                  </button>
                ) : (
                  <button
                    disabled={isRedeeming || !redeemCourseId.trim()}
                    onClick={() => handleRedeem(false)}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-all shadow disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {isRedeeming ? '🔄 Đang xử lý giao dịch...' : 'Xác nhận đổi điểm'}
                  </button>
                )}

                {redeemError && !canRetrySameKey && (
                  <button
                    disabled={isRedeeming}
                    onClick={handleStartFreshRequest}
                    className="px-3.5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-xl transition-colors"
                  >
                    Tạo mã mới
                  </button>
                )}

                <button
                  disabled={isRedeeming}
                  onClick={() => setShowRedeemModal(false)}
                  className="px-3.5 py-2 bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-bold rounded-xl transition-colors"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function PodiumCard({
  entry,
  position,
  onViewBreakdown,
}: {
  entry: LeaderboardEntry;
  position: 1 | 2 | 3;
  onViewBreakdown: () => void;
}) {
  const config = {
    1: {
      medal: '🥇',
      height: 'h-48 sm:h-56',
      bg: 'bg-gradient-to-b from-yellow-50 to-amber-50 border-amber-300',
      ring: 'ring-4 ring-amber-300/30',
      label: 'Top 1',
      labelBg: 'bg-amber-500',
      avatarSize: 'w-16 h-16 sm:w-20 sm:h-20',
      textSize: 'text-base sm:text-lg',
    },
    2: {
      medal: '🥈',
      height: 'h-40 sm:h-48',
      bg: 'bg-gradient-to-b from-slate-50 to-slate-100 border-slate-300',
      ring: 'ring-4 ring-slate-300/30',
      label: 'Top 2',
      labelBg: 'bg-slate-400',
      avatarSize: 'w-14 h-14 sm:w-16 sm:h-16',
      textSize: 'text-sm sm:text-base',
    },
    3: {
      medal: '🥉',
      height: 'h-36 sm:h-44',
      bg: 'bg-gradient-to-b from-orange-50 to-amber-50/50 border-orange-300',
      ring: 'ring-4 ring-orange-300/20',
      label: 'Top 3',
      labelBg: 'bg-orange-400',
      avatarSize: 'w-12 h-12 sm:w-14 sm:h-14',
      textSize: 'text-sm',
    },
  }

  const c = config[position]

  return (
    <div
      onClick={onViewBreakdown}
      className={`relative flex flex-col items-center justify-end ${c.height} w-32 sm:w-44 rounded-2xl border ${c.bg} ${c.ring} p-3 transition-all hover:scale-[1.03] cursor-pointer shadow-sm`}
    >
      {/* Medal */}
      <div className="text-3xl sm:text-4xl mb-1">{c.medal}</div>

      {/* Avatar */}
      <div className={`${c.avatarSize} rounded-full bg-slate-200 overflow-hidden border-2 border-white shadow-md mb-2`}>
        {entry.avatar ? (
          <img src={entry.avatar} alt={entry.fullName} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-emerald-400 to-teal-500 text-white font-bold text-lg">
            {entry.fullName?.charAt(0)?.toUpperCase() ?? '?'}
          </div>
        )}
      </div>

      {/* Name */}
      <p className={`${c.textSize} font-bold text-slate-800 text-center leading-tight line-clamp-1`}>
        {entry.fullName}
      </p>

      {/* Points */}
      <p className="text-sm sm:text-base font-extrabold text-emerald-700 mt-0.5">
        {entry.points} <span className="text-[10px] font-semibold text-slate-500">điểm</span>
      </p>

      {/* Stats */}
      <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500">
        <span>{entry.completedCourses} khóa</span>
        {entry.averageScore != null && (
          <>
            <span>·</span>
            <span>{entry.averageScore}%</span>
          </>
        )}
      </div>

      {/* Label badge */}
      <div className={`absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 ${c.labelBg} text-white text-[11px] font-bold rounded-full shadow flex items-center gap-1`}>
        {c.label} {entry.isTie && '(=)'}
      </div>
    </div>
  )
}

function RankRow({
  entry,
  onViewBreakdown,
}: {
  entry: LeaderboardEntry;
  onViewBreakdown: () => void;
}) {
  const isTop3 = entry.rank <= 3
  const rankDisplay = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `#${entry.rank}`

  return (
    <tr className={`hover:bg-slate-50/80 transition-colors ${isTop3 ? 'bg-amber-50/20' : ''}`}>
      <td className="text-center px-4 py-3.5">
        <div className="flex items-center justify-center gap-1">
          <span className={`text-lg ${isTop3 ? '' : 'text-slate-600 text-sm font-bold'}`}>
            {rankDisplay}
          </span>
          {entry.isTie && (
            <span className="text-[9px] font-extrabold bg-slate-200 text-slate-600 px-1 py-0.2 rounded">
              TIE
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-slate-200 overflow-hidden flex-shrink-0">
            {entry.avatar ? (
              <img src={entry.avatar} alt={entry.fullName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-emerald-400 to-teal-500 text-white font-bold text-xs">
                {entry.fullName?.charAt(0)?.toUpperCase() ?? '?'}
              </div>
            )}
          </div>
          <span className={`font-semibold ${isTop3 ? 'text-slate-900 font-bold' : 'text-slate-700'} text-sm`}>
            {entry.fullName}
          </span>
        </div>
      </td>
      <td className="text-center px-4 py-3.5">
        <span className="inline-flex items-center justify-center px-2.5 py-1 bg-emerald-50 text-emerald-800 rounded-lg font-black text-sm border border-emerald-200/60 shadow-xs">
          {entry.points}
        </span>
      </td>
      <td className="text-center px-4 py-3.5 font-medium text-slate-600">
        {entry.completedCourses}
      </td>
      <td className="text-center px-4 py-3.5 font-medium text-slate-600">
        {entry.averageScore != null ? (
          <span className="font-semibold text-slate-800">{entry.averageScore}%</span>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
      <td className="text-center px-4 py-3.5 hidden sm:table-cell">
        {entry.rewardPoints && entry.rewardPoints > 0 ? (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-50 text-amber-800 rounded-full text-xs font-bold border border-amber-200">
            +{entry.rewardPoints} điểm
          </span>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
      <td className="text-center px-4 py-3.5">
        <button
          onClick={onViewBreakdown}
          className="text-xs text-emerald-600 hover:text-emerald-800 font-semibold hover:underline"
        >
          Xem điểm
        </button>
      </td>
    </tr>
  )
}
