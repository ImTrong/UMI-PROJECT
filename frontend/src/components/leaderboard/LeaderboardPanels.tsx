/**
 * Presentational parts of the learner leaderboard page (FIX DEMO RANKING 02C.2): the scoring policy, the learner's own status
 * card (rank + wallet, independent of the ranking table), the reward point history and the load-error panel.
 */
import type { UserRank, UserRewardPoints } from '../../services/leaderboard.service'
import {
  BASE_POINTS_CAP,
  DESCRIBED_POLICY_VERSION,
  LEVEL_MULTIPLIERS,
  REWARD_TIERS,
  RewardHistoryItem,
  courseAchievementPoints,
  describeTransactionType,
  transactionDirection,
} from '../../utils/leaderboard-view'

const fmt = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString('vi-VN') : '—')

// ─── Scoring policy ─────────────────────────────────────────────────────────────────────────────────────────────────────

const EXAMPLES: Array<{ label: string; seconds: number; level: string }> = [
  { label: 'Khóa 45 phút, Cơ bản', seconds: 2700, level: 'BEGINNER' },
  { label: 'Khóa 3 giờ, Trung cấp', seconds: 10800, level: 'INTERMEDIATE' },
  { label: 'Khóa 25 giờ, Nâng cao', seconds: 90000, level: 'ADVANCED' },
]

export function ScoringPolicyContent({ serverPolicyVersion }: { serverPolicyVersion?: string | null }) {
  return (
    <div className="space-y-6 text-sm text-slate-600">
      {serverPolicyVersion && serverPolicyVersion !== DESCRIBED_POLICY_VERSION && (
        <p className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
          Nội dung dưới đây mô tả chính sách v{DESCRIBED_POLICY_VERSION}; kỳ đang xem được tính theo chính sách v{serverPolicyVersion}.
        </p>
      )}

      <div>
        <h4 className="font-bold text-slate-900 text-base mb-2">1. Điểm cơ sở theo thời lượng khóa học</h4>
        <p className="text-xs text-slate-500 mb-2">
          Tính liên tục theo tổng thời lượng bài học của khóa: <strong>1 điểm cho mỗi 30 phút</strong> (2 điểm mỗi giờ), tối đa{' '}
          <strong>{BASE_POINTS_CAP} điểm</strong> (từ 20 giờ trở lên), làm tròn 2 chữ số thập phân.
        </p>
        <p className="text-xs">
          <code>Điểm cơ sở = min({BASE_POINTS_CAP}, thời lượng (giây) ÷ 1800)</code>
        </p>
        <p className="text-xs text-slate-500 mt-2">
          Khóa không có thời lượng hợp lệ không được tính điểm (bản ghi được chuyển cho quản trị viên rà soát).
        </p>
      </div>

      <div>
        <h4 className="font-bold text-slate-900 text-base mb-2">2. Hệ số cấp độ khóa học</h4>
        <p className="text-xs text-slate-500 mb-2">
          <code>Điểm khóa học = Điểm cơ sở × Hệ số cấp độ</code> (làm tròn 2 chữ số). Khóa chưa được duyệt hoặc chưa xác định cấp độ
          dùng hệ số 1.0.
        </p>
        <ul className="list-disc pl-5 space-y-1 text-xs">
          {LEVEL_MULTIPLIERS.map((l) => (
            <li key={l.level}>
              <strong className="text-slate-800">{l.label} ({l.level}):</strong> hệ số {l.multiplier.toFixed(1)}
            </li>
          ))}
        </ul>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          {EXAMPLES.map((ex) => {
            const r = courseAchievementPoints(ex.seconds, ex.level)
            return (
              <div key={ex.label} className="p-2.5 rounded-xl border border-slate-100 bg-slate-50">
                <p className="text-slate-500">{ex.label}</p>
                <p className="font-bold text-emerald-700">
                  {r.basePoints} × {r.multiplier.toFixed(1)} = {r.achievementPoints} điểm
                </p>
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <h4 className="font-bold text-slate-900 text-base mb-2">3. Tiêu chí xếp hạng trong tháng</h4>
        <ol className="list-decimal pl-5 space-y-1.5 text-xs">
          <li><strong>Tổng điểm thành tích của tháng</strong>, giảm dần.</li>
          <li><strong>Số khóa học hoàn thành hợp lệ</strong>, giảm dần.</li>
          <li><strong>Điểm quiz trung bình</strong> của các khóa có bài quiz, giảm dần; học viên không có khóa nào có quiz xếp sau ở tiêu chí này.</li>
          <li><strong>Thời điểm hoàn thành khóa cuối cùng</strong>: ai hoàn thành sớm hơn xếp trên.</li>
          <li>
            <strong>Đồng hạng:</strong> khi ba tiêu chí đầu bằng nhau và thời điểm hoàn thành khóa cuối cách nhau dưới 1 giây; các học
            viên đồng hạng cùng nhận đầy đủ phần thưởng của hạng đó, hạng kế tiếp bị bỏ qua (ví dụ 1, 1, 3).
          </li>
        </ol>
        <p className="text-xs text-slate-500 mt-2">
          Mỗi khóa học chỉ được tính một lần, vào tháng hoàn thành lần đầu (giờ Việt Nam); học lại không thay đổi điểm. Chỉ tài khoản học
          viên đang hoạt động được xếp hạng.
        </p>
      </div>

      <div>
        <h4 className="font-bold text-slate-900 text-base mb-2">4. Phần thưởng tháng</h4>
        <div className="space-y-2 text-xs">
          {REWARD_TIERS.map((t) => (
            <div key={t.ranks} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="font-bold text-slate-800">{t.icon} {t.ranks}: {t.badge}</span>
              <span className="font-extrabold text-amber-700">+{t.points.toLocaleString('vi-VN')} điểm thưởng + huy hiệu</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Kết quả được chốt tự động lúc 00:05 ngày 1 tháng sau (giờ Việt Nam). Điểm thưởng chỉ được cộng vào ví sau khi kỳ được chốt;
          trong tháng, cột phần thưởng là mức dự kiến theo thứ hạng hiện tại.
        </p>
      </div>
    </div>
  )
}

// ─── The learner's own status: current rank + wallet ────────────────────────────────────────────────────────────────────

export interface MyStatusCardProps {
  myRank: UserRank | null
  rankError: string | null
  myPoints: UserRewardPoints | null
  pointsError: string | null
  loading: boolean
  onRetry: () => void
  onRedeem: () => void
  onShowHistory: () => void
  onShowBreakdown: () => void
}

export function MyStatusCard(p: MyStatusCardProps) {
  return (
    <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 rounded-2xl p-5 sm:p-6 text-white shadow-xl shadow-emerald-200/50">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur border border-white/30 flex items-center justify-center text-xl font-black shadow-inner">
            {p.myRank?.rank ? (p.myRank.isTie ? `=${p.myRank.rank}` : `#${p.myRank.rank}`) : '—'}
          </div>
          <div>
            {p.myRank ? (
              <>
                <div className="flex items-center gap-2">
                  <p className="font-bold text-base sm:text-lg">
                    {p.myRank.rank ? `Thứ hạng của bạn kỳ này: #${p.myRank.rank}` : 'Bạn chưa có thành tích kỳ này'}
                  </p>
                  {p.myRank.isTie && (
                    <span className="text-[10px] uppercase font-bold bg-amber-400 text-slate-900 px-2 py-0.5 rounded-full">Đồng hạng</span>
                  )}
                </div>
                <p className="text-emerald-100 text-xs sm:text-sm mt-0.5">{p.myRank.totalParticipants} học viên đang có thành tích kỳ này</p>
              </>
            ) : p.rankError ? (
              <p className="font-semibold text-sm">Không tải được thứ hạng của bạn: {p.rankError}</p>
            ) : (
              <p className="text-sm text-emerald-100">{p.loading ? 'Đang tải thứ hạng...' : '—'}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-5 text-sm">
          {p.myRank && (
            <>
              <div className="text-center sm:text-right">
                <p className="text-2xl font-black text-amber-300">{p.myRank.points}</p>
                <p className="text-emerald-100 text-xs font-medium">Điểm thành tích</p>
              </div>
              <div className="text-center sm:text-right">
                <p className="text-2xl font-black">{p.myRank.completedCourses}</p>
                <p className="text-emerald-100 text-xs font-medium">Khóa học</p>
              </div>
            </>
          )}
          <div className="text-center sm:text-right border-l border-white/20 pl-4">
            {p.myPoints ? (
              <>
                <p className="text-2xl font-black text-yellow-300">💎 {fmt(p.myPoints.balance)}</p>
                <p className="text-emerald-100 text-xs font-medium">Ví điểm thưởng</p>
              </>
            ) : p.pointsError ? (
              <p className="text-xs font-semibold max-w-[12rem]">Không tải được ví điểm: {p.pointsError}</p>
            ) : (
              <p className="text-xs text-emerald-100">{p.loading ? 'Đang tải ví...' : '—'}</p>
            )}
          </div>
          {(p.rankError || p.pointsError) && (
            <button
              onClick={p.onRetry}
              disabled={p.loading}
              className="px-3.5 py-2 bg-white/20 hover:bg-white/30 rounded-xl text-xs font-bold disabled:opacity-50"
            >
              Thử lại
            </button>
          )}
          {p.myPoints && (
            <>
              <button
                onClick={p.onRedeem}
                className="px-3.5 py-2 bg-amber-400 hover:bg-amber-300 text-slate-900 rounded-xl text-xs font-extrabold shadow transition-all hover:scale-105 flex items-center gap-1.5"
              >
                <span>🎁</span> Đổi khóa học
              </button>
              <button
                onClick={p.onShowHistory}
                className="px-3.5 py-2 bg-white/90 text-emerald-800 hover:bg-white rounded-xl text-xs font-bold shadow transition-all hover:scale-105"
              >
                Lịch sử điểm
              </button>
            </>
          )}
          {p.myRank && p.myRank.completedCourses > 0 && (
            <button
              onClick={p.onShowBreakdown}
              className="px-3.5 py-2 bg-white text-emerald-800 hover:bg-emerald-50 rounded-xl text-xs font-bold shadow transition-all hover:scale-105"
            >
              Xem chi tiết điểm
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Reward point history ───────────────────────────────────────────────────────────────────────────────────────────────

export interface RewardHistoryPanelProps {
  items: RewardHistoryItem[] | null
  summary: { balance: number | null; totalEarned: number | null; totalSpent: number | null } | null
  loading: boolean
  error: string | null
  canLoadMore: boolean
  onRetry: () => void
  onLoadMore: () => void
}

export function RewardHistoryPanel(p: RewardHistoryPanelProps) {
  return (
    <div className="space-y-3">
      {p.summary && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-100">
            <p className="text-amber-700">Số dư</p>
            <p className="text-base font-black text-amber-800">{fmt(p.summary.balance)}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100">
            <p className="text-emerald-700">Tổng đã nhận</p>
            <p className="text-base font-black text-emerald-800">+{fmt(p.summary.totalEarned)}</p>
          </div>
          <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-100">
            <p className="text-rose-700">Tổng đã dùng</p>
            <p className="text-base font-black text-rose-800">−{fmt(p.summary.totalSpent)}</p>
          </div>
        </div>
      )}

      {p.error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between gap-2">
          <span>Không tải được lịch sử điểm: {p.error}</span>
          <button onClick={p.onRetry} disabled={p.loading} className="px-2.5 py-1 rounded-lg bg-white border border-rose-200 font-bold disabled:opacity-50">
            Thử lại
          </button>
        </div>
      )}

      {p.items === null ? (
        !p.error && <p className="text-center text-sm text-slate-400 py-8">{p.loading ? 'Đang tải lịch sử điểm...' : '—'}</p>
      ) : p.items.length === 0 ? (
        <p className="text-center text-sm text-slate-400 py-8">Bạn chưa có giao dịch điểm thưởng nào.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
          {p.items.map((t) => {
            const received = transactionDirection(t.amount) === 'RECEIVED'
            return (
              <li key={t.id} className="p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-800">
                    {describeTransactionType(t.type)}
                    <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${received ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                      {received ? 'Nhận điểm' : 'Dùng điểm'}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500 truncate">{t.description || '—'}</p>
                  <p className="text-[11px] text-slate-400">{t.createdAt ? new Date(t.createdAt).toLocaleString('vi-VN') : '—'}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-black ${received ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {received ? `+${t.amount}` : t.amount}
                  </p>
                  <p className="text-[11px] text-slate-400">Số dư sau: {fmt(t.balanceAfter)}</p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {p.items !== null && p.canLoadMore && (
        <div className="text-center">
          <button onClick={p.onLoadMore} disabled={p.loading} className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-50">
            {p.loading ? 'Đang tải...' : 'Xem thêm'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Ranking could not be loaded ────────────────────────────────────────────────────────────────────────────────────────

export function LeaderboardLoadError({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="text-center py-16 bg-white rounded-2xl border border-rose-100 p-8 shadow-sm">
      <div className="text-5xl mb-4">⚠️</div>
      <h3 className="text-lg font-bold text-slate-700 mb-2">Không tải được bảng xếp hạng</h3>
      <p className="text-sm text-slate-500 max-w-md mx-auto mb-4">{message}</p>
      <button
        onClick={onRetry}
        disabled={retrying}
        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl disabled:opacity-50"
      >
        {retrying ? 'Đang tải lại...' : 'Thử lại'}
      </button>
    </div>
  )
}
