import React, { useState, useEffect, useCallback, useRef } from 'react'
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
import {
  LeaderboardLoadError,
  MyStatusCard,
  RewardHistoryPanel,
  ScoringPolicyContent,
} from '../components/leaderboard/LeaderboardPanels'
import { RewardColumnMode, RewardHistoryItem, readApiError, rewardColumnMode } from '../utils/leaderboard-view'

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
  const [redeemRequestId, setRedeemRequestId] = useState('')
  const [isRedeeming, setIsRedeeming] = useState(false)
  const [redeemError, setRedeemError] = useState<string | null>(null)
  const [redeemSuccess, setRedeemSuccess] = useState<string | null>(null)
  const [canRetrySameKey, setCanRetrySameKey] = useState(false)

  const openRedeemModal = () => {
    const newKey = `redeem_req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    setRedeemRequestId(newKey)
    setRedeemCourseId('')
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
      const res = await leaderboardService.redeemCourse(redeemCourseId.trim(), currentKey)
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

  // The running period is the one the backend reports (Asia/Ho_Chi_Minh), never the browser clock
  const [currentPeriod, setCurrentPeriod] = useState<{ month: number; year: number } | null>(null)
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null)
  const leaderboardRequest = useRef(0)

  // The learner's own status (rank of the running period + wallet), loaded independently of the ranking table
  const [rankError, setRankError] = useState<string | null>(null)
  const [pointsError, setPointsError] = useState<string | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)

  // Reward point history (loaded when the dialog is opened)
  const [showHistory, setShowHistory] = useState(false)
  const [historyItems, setHistoryItems] = useState<RewardHistoryItem[] | null>(null)
  const [historySummary, setHistorySummary] = useState<{ balance: number | null; totalEarned: number | null; totalSpent: number | null } | null>(null)
  const [historyPage, setHistoryPage] = useState<{ page: number; totalPages: number | null }>({ page: 0, totalPages: null })
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  /** null = the running period (/current); otherwise a finalized month from the history list (/history) */
  const fetchLeaderboard = useCallback(async (period: { month: number; year: number } | null) => {
    const request = ++leaderboardRequest.current
    setLoading(true)
    setLeaderboardError(null)
    try {
      const data: LeaderboardData = period
        ? await leaderboardService.getHistoryLeaderboard(period.month, period.year)
        : await leaderboardService.getCurrentLeaderboard()
      if (request !== leaderboardRequest.current) return
      if (!period) setCurrentPeriod({ month: data.month, year: data.year })
      setIsCurrentMonth(!period)
      setLeaderboard(data)
    } catch (err: any) {
      if (request !== leaderboardRequest.current) return
      setLeaderboard(null)
      setLeaderboardError(readApiError(err, 'Không thể tải bảng xếp hạng. Vui lòng thử lại.'))
    } finally {
      if (request === leaderboardRequest.current) setLoading(false)
    }
  }, [])

  const loadMyStatus = useCallback(async () => {
    setStatusLoading(true)
    setRankError(null)
    setPointsError(null)
    await Promise.all([
      leaderboardService.getMyRank().then(setMyRank).catch((err) => { setMyRank(null); setRankError(readApiError(err, 'Vui lòng thử lại.')) }),
      leaderboardService.getMyRewardPoints().then(setMyPoints).catch((err) => { setMyPoints(null); setPointsError(readApiError(err, 'Vui lòng thử lại.')) }),
    ])
    setStatusLoading(false)
  }, [])

  const loadHistory = useCallback(async (page: number) => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const res = await leaderboardService.getRewardTransactions(page, 20)
      setHistoryItems((prev) => (page === 1 || !prev ? res.transactions : [...prev, ...res.transactions]))
      setHistorySummary({ balance: res.balance, totalEarned: res.totalEarned, totalSpent: res.totalSpent })
      setHistoryPage({ page, totalPages: res.totalPages })
    } catch (err: any) {
      setHistoryError(readApiError(err, 'Vui lòng thử lại.'))
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const openHistory = () => {
    setShowHistory(true)
    loadHistory(1)
  }

  useEffect(() => {
    fetchLeaderboard(null)
    leaderboardService.getAvailableMonths().then(setAvailableMonths).catch(() => {})
  }, [fetchLeaderboard])

  useEffect(() => {
    if (isAuthenticated) loadMyStatus()
  }, [isAuthenticated, loadMyStatus])

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    if (val === 'current') {
      setSelectedMonth(null)
      fetchLeaderboard(null)
    } else {
      const [m, y] = val.split('-').map(Number)
      setSelectedMonth({ month: m, year: y })
      fetchLeaderboard({ month: m, year: y })
    }
  }

  const retryLeaderboard = () => fetchLeaderboard(selectedMonth)
  const rewardMode = rewardColumnMode(leaderboard?.status)
  // A finalized month equal to the running one would otherwise be listed twice
  const historyOptions = availableMonths.filter(
    (m) => !(currentPeriod && m.month === currentPeriod.month && m.year === currentPeriod.year)
  )

  const top3 = leaderboard?.entries.slice(0, 3) ?? []

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50/30">
      <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold mb-3 shadow-sm">
            <span>✨ Chu kỳ xếp hạng {selectedMonth ? `tháng ${selectedMonth.month}/${selectedMonth.year}` : currentPeriod ? `tháng ${currentPeriod.month}/${currentPeriod.year}` : 'hiện tại'}</span>
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
              {currentPeriod ? `${MONTH_NAMES[currentPeriod.month]} ${currentPeriod.year}` : 'Kỳ hiện tại'} (Đang diễn ra)
            </option>
            {historyOptions.map((m) => (
              <option key={`${m.month}-${m.year}`} value={`${m.month}-${m.year}`}>
                {MONTH_NAMES[m.month]} {m.year}
              </option>
            ))}
          </select>
          {!leaderboard ? null : leaderboard.status === 'FINALIZED' ? (
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold border border-emerald-200 shadow-sm">
              ✓ Đã chốt kết quả
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-bold border border-amber-200 shadow-sm animate-pulse">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span> Đang cập nhật trực tiếp
            </span>
          )}
        </div>

        {/* The learner's own status: shown whatever happens to the ranking table (wallet and rank have their own requests) */}
        {isAuthenticated && (
          <div className="mb-8">
            <MyStatusCard
              myRank={myRank}
              rankError={rankError}
              myPoints={myPoints}
              pointsError={pointsError}
              loading={statusLoading}
              onRetry={loadMyStatus}
              onRedeem={openRedeemModal}
              onShowHistory={openHistory}
              onShowBreakdown={() =>
                myRank &&
                setSelectedBreakdown({
                  userName: 'Bạn',
                  points: myRank.points,
                  items: myRank.scoreBreakdown,
                })
              }
            />
          </div>
        )}

        {/* Loading state */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600"></div>
          </div>
        ) : leaderboardError || !leaderboard ? (
          /* Error state: a failed request is never shown as an empty ranking */
          <LeaderboardLoadError
            message={leaderboardError ?? 'Không thể tải bảng xếp hạng. Vui lòng thử lại.'}
            onRetry={retryLeaderboard}
            retrying={loading}
          />
        ) : leaderboard.entries.length === 0 ? (
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

            {/* Full Ranking Table */}
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-bold text-slate-800 text-base sm:text-lg">
                  Bảng xếp hạng chi tiết ({leaderboard.entries.length} học viên)
                </h2>
                <span className="text-xs text-slate-400">
                  Sắp xếp: Điểm thành tích ↓ · Số khóa ↓ · Điểm quiz ↓ · Hoàn thành sớm hơn ↑
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
                      <th className="text-center px-4 py-3 font-semibold hidden sm:table-cell">
                        {rewardMode === 'AWARDED' ? 'Thưởng đã trao' : 'Thưởng dự kiến'}
                      </th>
                      <th className="text-center px-4 py-3 font-semibold w-24">Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {leaderboard.entries.map((entry) => (
                      <RankRow
                        key={entry.userId}
                        entry={entry}
                        rewardMode={rewardMode}
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
              <p className="px-5 py-3 border-t border-slate-100 text-xs text-slate-500">
                {rewardMode === 'AWARDED'
                  ? 'Kỳ đã chốt: phần thưởng đã được ghi nhận vào ví học viên khi chốt kỳ.'
                  : 'Kỳ đang diễn ra: phần thưởng là mức dự kiến theo thứ hạng hiện tại, chỉ được cộng vào ví sau khi kỳ được chốt.'}
              </p>
            </div>
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

              <div className="p-6 overflow-y-auto">
                <ScoringPolicyContent serverPolicyVersion={leaderboard?.policyVersion} />
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

        {/* Modal: Reward point history */}
        {showHistory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="font-extrabold text-slate-900 text-lg">💎 Lịch sử điểm thưởng</h3>
                <button
                  onClick={() => setShowHistory(false)}
                  className="w-8 h-8 rounded-full bg-slate-200/70 hover:bg-slate-300 text-slate-600 flex items-center justify-center text-sm font-bold transition-colors"
                >
                  ✕
                </button>
              </div>
              <div className="p-5 overflow-y-auto">
                <RewardHistoryPanel
                  items={historyItems}
                  summary={historySummary}
                  loading={historyLoading}
                  error={historyError}
                  canLoadMore={historyPage.totalPages !== null && historyPage.page < historyPage.totalPages}
                  onRetry={() => loadHistory(historyItems === null ? 1 : historyPage.page + 1)}
                  onLoadMore={() => loadHistory(historyPage.page + 1)}
                />
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
                  <span className="font-black text-amber-600 text-sm">{myPoints?.courseRedemptionPoints ?? '---'} điểm thưởng</span>
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
  rewardMode,
  onViewBreakdown,
}: {
  entry: LeaderboardEntry;
  rewardMode: RewardColumnMode;
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
          rewardMode === 'AWARDED' ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-50 text-amber-800 rounded-full text-xs font-bold border border-amber-200">
              +{entry.rewardPoints} điểm
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-white text-slate-500 rounded-full text-xs font-semibold border border-dashed border-slate-300"
              title="Dự kiến theo thứ hạng hiện tại; chỉ cộng vào ví sau khi chốt kỳ"
            >
              ~{entry.rewardPoints} điểm
            </span>
          )
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
