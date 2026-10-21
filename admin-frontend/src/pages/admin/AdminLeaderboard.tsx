import { useState, useEffect } from 'react';
import {
  FiAward, FiCalendar, FiRefreshCw, FiCheckCircle, FiAlertTriangle,
  FiFileText, FiGift, FiEye, FiFlag, FiSearch, FiX, FiShield,
  FiTrendingUp, FiCheck, FiInfo, FiLayers, FiDatabase
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import {
  adminLeaderboardService,
  OverviewResponse,
  StudentDetailAdmin,
  AuditLogAdmin,
  RewardTransactionAdmin
} from '../../services/admin-leaderboard.service';

export default function AdminLeaderboard() {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);

  // Filter month & year
  const today = new Date();
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());

  // Active Tab: 'leaderboard' | 'transactions' | 'audit' | 'policy'
  const [activeTab, setActiveTab] = useState<'leaderboard' | 'transactions' | 'audit' | 'policy'>('leaderboard');

  // Search filter inside leaderboard
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [studentModalOpen, setStudentModalOpen] = useState(false);
  const [selectedStudentDetail, setSelectedStudentDetail] = useState<StudentDetailAdmin | null>(null);
  const [studentDetailLoading, setStudentDetailLoading] = useState(false);

  const [finalizeModalOpen, setFinalizeModalOpen] = useState(false);
  const [finalizeReason, setFinalizeReason] = useState('');
  const [finalizing, setFinalizing] = useState(false);

  const [adjustPointsModalOpen, setAdjustPointsModalOpen] = useState(false);
  const [adjustUserId, setAdjustUserId] = useState('');
  const [adjustUserPoints, setAdjustUserPoints] = useState<number>(100);
  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  // Flag modal
  const [flagModalOpen, setFlagModalOpen] = useState(false);
  const [targetRecordId, setTargetRecordId] = useState('');
  const [targetFlagState, setTargetFlagState] = useState(true);
  const [flagReasonInput, setFlagReasonInput] = useState('');

  // Transactions & Audit Logs state
  const [transactions, setTransactions] = useState<RewardTransactionAdmin[]>([]);
  const [transLoading, setTransLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLogAdmin[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const [syncing, setSyncing] = useState(false);

  // Load Overview Data
  const loadOverview = async (m = selectedMonth, y = selectedYear) => {
    try {
      setLoading(true);
      const data = await adminLeaderboardService.getOverview(m, y);
      setOverview(data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Lỗi khi tải dữ liệu tổng quan');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview(selectedMonth, selectedYear);
  }, [selectedMonth, selectedYear]);

  // Load Transactions when tab changes
  useEffect(() => {
    if (activeTab === 'transactions') {
      loadTransactions();
    } else if (activeTab === 'audit') {
      loadAuditLogs();
    }
  }, [activeTab]);

  const loadTransactions = async () => {
    try {
      setTransLoading(true);
      const data = await adminLeaderboardService.getRewardTransactions(1, 50);
      setTransactions(data.transactions || []);
    } catch (err: any) {
      toast.error('Lỗi tải lịch sử giao dịch điểm thưởng');
    } finally {
      setTransLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    try {
      setAuditLoading(true);
      const data = await adminLeaderboardService.getAuditLogs(1, 50);
      setAuditLogs(data.logs || []);
    } catch (err: any) {
      toast.error('Lỗi tải nhật ký kiểm toán');
    } finally {
      setAuditLoading(false);
    }
  };

  // View Student Details
  const handleOpenStudentDetail = async (userId: string) => {
    try {
      setStudentDetailLoading(true);
      setStudentModalOpen(true);
      const detail = await adminLeaderboardService.getStudentDetail(userId, selectedMonth, selectedYear);
      setSelectedStudentDetail(detail);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Không thể tải chi tiết học viên');
      setStudentModalOpen(false);
    } finally {
      setStudentDetailLoading(false);
    }
  };

  // Manual Finalize Month
  const handleFinalizeMonth = async () => {
    try {
      setFinalizing(true);
      await adminLeaderboardService.finalizeMonth({
        month: selectedMonth,
        year: selectedYear,
        reason: finalizeReason || `Quản trị viên chốt bảng xếp hạng tháng ${selectedMonth}/${selectedYear} thủ công`
      });
      toast.success(`Đã chốt bảng xếp hạng tháng ${selectedMonth}/${selectedYear} thành công!`);
      setFinalizeModalOpen(false);
      setFinalizeReason('');
      loadOverview();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Không thể chốt bảng xếp hạng');
    } finally {
      setFinalizing(false);
    }
  };

  // Sync Completions
  const handleSyncCompletions = async () => {
    if (!window.confirm('Hệ thống sẽ rà soát các tiến trình đã hoàn thành và lập bản ghi thành tích an toàn. Tiếp tục?')) {
      return;
    }
    try {
      setSyncing(true);
      const res = await adminLeaderboardService.syncCompletions();
      toast.success(`Đồng bộ hoàn tất: ${res.syncedCount} bản ghi mới, bỏ qua ${res.skippedCount} bản ghi đã có.`);
      loadOverview();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Lỗi khi đồng bộ dữ liệu');
    } finally {
      setSyncing(false);
    }
  };

  // Flag / Unflag completion record
  const handleConfirmFlagRecord = async () => {
    if (!flagReasonInput.trim()) {
      toast.error('Vui lòng nhập lý do đánh dấu');
      return;
    }
    try {
      await adminLeaderboardService.flagRecord({
        recordId: targetRecordId,
        isFlagged: targetFlagState,
        reason: flagReasonInput
      });
      toast.success(targetFlagState ? 'Đã gắn cờ nghi vấn bản ghi' : 'Đã gỡ cờ bản ghi');
      setFlagModalOpen(false);
      setFlagReasonInput('');
      // Reload student detail if open
      if (selectedStudentDetail) {
        handleOpenStudentDetail(selectedStudentDetail.userId);
      }
      loadOverview();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Lỗi thao tác gắn cờ');
    }
  };

  // Manual Point Adjustment
  const handleConfirmAdjustPoints = async () => {
    if (!adjustReason.trim()) {
      toast.error('Vui lòng nhập lý do điều chỉnh điểm');
      return;
    }
    try {
      setAdjusting(true);
      await adminLeaderboardService.adjustPoints({
        userId: adjustUserId,
        points: Number(adjustUserPoints),
        reason: adjustReason
      });
      toast.success('Điều chỉnh điểm thưởng thành công!');
      setAdjustPointsModalOpen(false);
      setAdjustReason('');
      if (selectedStudentDetail) {
        handleOpenStudentDetail(selectedStudentDetail.userId);
      }
      loadOverview();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Lỗi điều chỉnh điểm');
    } finally {
      setAdjusting(false);
    }
  };

  // Format Helpers
  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const currentBoard = overview?.finalizedLeaderboard || overview?.activeLeaderboard;
  const entries = currentBoard?.entries || [];

  const filteredEntries = entries.filter((e) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      e.user?.fullName?.toLowerCase().includes(q) ||
      e.user?.email?.toLowerCase().includes(q) ||
      e.userId.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold text-xl">
              <FiAward />
            </div>
            <div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight">
                Quản lý Bảng Xếp Hạng & Điểm Thưởng
              </h1>
              <p className="text-sm text-gray-500">
                Theo dõi xếp hạng hàng tháng, đối soát điểm thành tích, chốt kỳ và kiểm soát giao dịch thưởng.
              </p>
            </div>
          </div>
        </div>

        {/* Month Selector & Global Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-200">
            <FiCalendar className="text-gray-400 ml-2" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="bg-transparent text-sm font-semibold text-gray-700 outline-none pr-2 py-1 cursor-pointer"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>Tháng {m}</option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="bg-transparent text-sm font-semibold text-gray-700 outline-none pr-2 py-1 cursor-pointer"
            >
              {[2025, 2026, 2027].map((y) => (
                <option key={y} value={y}>Năm {y}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => loadOverview()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition shadow-sm"
            title="Làm mới"
          >
            <FiRefreshCw className={loading ? 'animate-spin' : ''} />
            <span>Làm mới</span>
          </button>

          <button
            onClick={handleSyncCompletions}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition shadow-sm"
            title="Đồng bộ lại thành tích từ tiến trình học"
          >
            <FiDatabase className={syncing ? 'animate-spin' : ''} />
            <span>{syncing ? 'Đang đồng bộ...' : 'Đồng bộ dữ liệu'}</span>
          </button>

          {overview?.activeLeaderboard && !overview.finalizedLeaderboard && (
            <button
              onClick={() => setFinalizeModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-gradient-to-r from-amber-500 to-amber-600 rounded-xl hover:from-amber-600 hover:to-amber-700 transition shadow-sm shadow-amber-500/20"
            >
              <FiCheckCircle />
              <span>Chốt tháng thủ công</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Status Card */}
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Trạng thái kỳ</p>
            <div className="mt-1 flex items-center gap-2">
              {overview?.finalizedLeaderboard ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <FiCheck size={14} /> ĐÃ CHỐT SỔ
                </span>
              ) : overview?.activeLeaderboard?.status === 'FINALIZING' ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 animate-pulse">
                  ĐANG CHỐT SỔ...
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  ĐANG DIỄN RA
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Kỳ: Tháng {selectedMonth}/{selectedYear}
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center text-gray-400">
            <FiCalendar size={24} />
          </div>
        </div>

        {/* Participants Card */}
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Học viên tham gia</p>
            <h3 className="text-2xl font-black text-gray-900 mt-1">
              {overview?.finalizedLeaderboard?.entries?.length || overview?.activeLeaderboard?.totalParticipants || 0}
            </h3>
            <p className="text-xs text-gray-400 mt-1">Trong bảng xếp hạng kỳ này</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <FiTrendingUp size={24} />
          </div>
        </div>

        {/* Total Points Awarded */}
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tổng điểm thưởng đã phát</p>
            <h3 className="text-2xl font-black text-amber-600 mt-1">
              {overview?.totals?.totalRewardPointsAwarded?.toLocaleString() || 0} pts
            </h3>
            <p className="text-xs text-gray-400 mt-1">Toàn hệ thống UMI</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <FiGift size={24} />
          </div>
        </div>

        {/* Completion Records */}
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Bản ghi hoàn thành</p>
            <h3 className="text-2xl font-black text-emerald-600 mt-1">
              {overview?.totals?.totalCompletionRecords || 0}
            </h3>
            <p className="text-xs text-gray-400 mt-1">Thành tích bất biến lưu trữ</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <FiShield size={24} />
          </div>
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex border-b border-gray-200 gap-4">
        <button
          onClick={() => setActiveTab('leaderboard')}
          className={`pb-3 px-2 font-bold text-sm flex items-center gap-2 border-b-2 transition ${
            activeTab === 'leaderboard'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <FiAward size={16} />
          Bảng Xếp Hạng Tháng {selectedMonth}/{selectedYear}
        </button>

        <button
          onClick={() => setActiveTab('transactions')}
          className={`pb-3 px-2 font-bold text-sm flex items-center gap-2 border-b-2 transition ${
            activeTab === 'transactions'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <FiGift size={16} />
          Giao dịch Điểm Thưởng ({transactions.length})
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`pb-3 px-2 font-bold text-sm flex items-center gap-2 border-b-2 transition ${
            activeTab === 'audit'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <FiFileText size={16} />
          Nhật ký Kiểm toán (Audit Logs)
        </button>

        <button
          onClick={() => setActiveTab('policy')}
          className={`pb-3 px-2 font-bold text-sm flex items-center gap-2 border-b-2 transition ${
            activeTab === 'policy'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <FiInfo size={16} />
          Chính sách & Cấu hình tính điểm
        </button>
      </div>

      {/* TAB CONTENT 1: LEADERBOARD */}
      {activeTab === 'leaderboard' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Subheader / Search */}
          <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full sm:w-80">
              <FiSearch className="absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                placeholder="Tìm kiếm theo tên, email, ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:bg-white"
              />
            </div>
            <div className="text-xs text-gray-400 font-medium">
              Hiển thị {filteredEntries.length} / {entries.length} học viên
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50/75 text-xs uppercase font-bold text-gray-400 border-b border-gray-100">
                <tr>
                  <th className="py-3.5 px-4 text-center w-16">Hạng</th>
                  <th className="py-3.5 px-4">Học viên</th>
                  <th className="py-3.5 px-4 text-center">Điểm Thành Tích</th>
                  <th className="py-3.5 px-4 text-center">Khóa Đạt</th>
                  <th className="py-3.5 px-4 text-center">Quiz TB</th>
                  <th className="py-3.5 px-4 text-center">Thời lượng</th>
                  <th className="py-3.5 px-4 text-center">Thưởng dự kiến</th>
                  <th className="py-3.5 px-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredEntries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-gray-400">
                      <FiAward className="mx-auto text-4xl text-gray-300 mb-2" />
                      Chưa có dữ liệu thành tích hợp lệ trong tháng này.
                    </td>
                  </tr>
                ) : (
                  filteredEntries.map((entry) => {
                    return (
                      <tr key={entry.userId} className="hover:bg-gray-50/70 transition">
                        <td className="py-4 px-4 text-center">
                          <span
                            className={`inline-flex items-center justify-center w-8 h-8 rounded-full font-black text-xs ${
                              entry.rank === 1
                                ? 'bg-amber-400 text-amber-950 shadow-md shadow-amber-300/50'
                                : entry.rank === 2
                                ? 'bg-slate-300 text-slate-800 shadow-sm'
                                : entry.rank === 3
                                ? 'bg-amber-700 text-amber-100 shadow-sm'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {entry.rank}
                          </span>
                          {entry.isTie && (
                            <span className="block text-[10px] text-amber-600 font-bold mt-0.5">
                              (Đồng hạng)
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary-500 to-indigo-600 text-white font-bold flex items-center justify-center flex-shrink-0">
                              {entry.user?.fullName?.charAt(0).toUpperCase() || 'H'}
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-gray-900 truncate">
                                {entry.user?.fullName || 'Học viên'}
                              </p>
                              <p className="text-xs text-gray-400 truncate">
                                {entry.user?.email || entry.userId}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-4 text-center">
                          <span className="font-extrabold text-primary-600 text-base">
                            {entry.points}
                          </span>
                          <span className="text-xs text-gray-400 ml-1">pts</span>
                        </td>
                        <td className="py-4 px-4 text-center font-semibold text-gray-800">
                          {entry.coursesCompleted}
                        </td>
                        <td className="py-4 px-4 text-center">
                          {entry.averageQuizScore !== null && entry.averageQuizScore !== undefined ? (
                            <span className="font-semibold text-emerald-600">
                              {entry.averageQuizScore}%
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 italic">Không có quiz</span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-center text-xs text-gray-500 font-medium">
                          {formatDuration(entry.totalDurationSeconds || 0)}
                        </td>
                        <td className="py-4 px-4 text-center">
                          {entry.rewardPoints > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              <FiGift size={12} /> +{entry.rewardPoints} pts
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleOpenStudentDetail(entry.userId)}
                              className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg transition"
                              title="Xem chi tiết tính điểm"
                            >
                              <FiEye size={16} />
                            </button>
                            <button
                              onClick={() => {
                                setAdjustUserId(entry.userId);
                                setAdjustUserPoints(100);
                                setAdjustPointsModalOpen(true);
                              }}
                              className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg transition"
                              title="Điều chỉnh điểm thưởng"
                            >
                              <FiGift size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CONTENT 2: REWARD TRANSACTIONS */}
      {activeTab === 'transactions' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-gray-900">Sổ Giao Dịch Điểm Thưởng UMI (Ledger)</h3>
            <button
              onClick={loadTransactions}
              className="text-xs font-semibold text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              <FiRefreshCw className={transLoading ? 'animate-spin' : ''} /> Tải lại
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Mọi biến động điểm thưởng đều được ghi nhận bất biến với lý do, số điểm cộng/trừ và mã định danh đối soát.
          </p>

          <div className="overflow-x-auto border border-gray-100 rounded-xl">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-xs uppercase font-bold text-gray-400">
                <tr>
                  <th className="py-3 px-4">Thời gian</th>
                  <th className="py-3 px-4">Mã User</th>
                  <th className="py-3 px-4">Loại giao dịch</th>
                  <th className="py-3 px-4 text-center">Số điểm</th>
                  <th className="py-3 px-4">Lý do</th>
                  <th className="py-3 px-4">Tham chiếu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-400">
                      Chưa có giao dịch điểm thưởng nào.
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-gray-50/70">
                      <td className="py-3 px-4 text-xs text-gray-500">
                        {new Date(tx.createdAt).toLocaleString('vi-VN')}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-700">
                        {tx.userId}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                          tx.type === 'LEADERBOARD_REWARD' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                          tx.type === 'COURSE_REDEMPTION' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                          tx.type === 'REFUND' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                          'bg-purple-50 text-purple-700 border border-purple-200'
                        }`}>
                          {tx.type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-bold">
                        <span className={tx.points > 0 ? 'text-emerald-600' : 'text-rose-600'}>
                          {tx.points > 0 ? `+${tx.points}` : tx.points}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-700 max-w-xs truncate">
                        {tx.reason}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400">
                        {tx.referenceType ? `${tx.referenceType}:${tx.referenceId?.slice(-6)}` : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CONTENT 3: AUDIT LOGS */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-gray-900">Nhật Ký Kiểm Toán Nghiệp Vụ (Leaderboard Audit Logs)</h3>
            <button
              onClick={loadAuditLogs}
              className="text-xs font-semibold text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              <FiRefreshCw className={auditLoading ? 'animate-spin' : ''} /> Tải lại
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Lưu vết toàn bộ thao tác chốt kỳ, đồng bộ, gắn cờ nghi vấn và điều chỉnh điểm thưởng của quản trị viên.
          </p>

          <div className="overflow-x-auto border border-gray-100 rounded-xl">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-xs uppercase font-bold text-gray-400">
                <tr>
                  <th className="py-3 px-4">Thời gian</th>
                  <th className="py-3 px-4">Admin ID</th>
                  <th className="py-3 px-4">Hành động</th>
                  <th className="py-3 px-4">Mục tiêu</th>
                  <th className="py-3 px-4">Lý do</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-400">
                      Chưa có nhật ký kiểm toán nào được ghi nhận.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50/70">
                      <td className="py-3 px-4 text-xs text-gray-500">
                        {new Date(log.createdAt).toLocaleString('vi-VN')}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-700">
                        {log.adminId}
                      </td>
                      <td className="py-3 px-4 font-semibold text-xs text-primary-700">
                        {log.action}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-500">
                        {log.targetType}: {log.targetId}
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-700 max-w-sm truncate">
                        {log.reason || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CONTENT 4: POLICY */}
      {activeTab === 'policy' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-primary-600">
              <FiLayers size={20} />
              <h3 className="font-bold text-gray-900">Bậc Điểm Cơ Sở Theo Thời Lượng (Duration Tiers)</h3>
            </div>
            <p className="text-xs text-gray-500">
              Tính bằng tổng thời lượng các bài học hợp lệ do server xác thực (không dùng timeSpent do client gửi).
            </p>
            <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
              {overview?.policy?.durationTiers?.map((tier, idx) => (
                <div key={idx} className="p-3 flex items-center justify-between text-xs hover:bg-gray-50">
                  <span className="font-medium text-gray-700">{tier.label}</span>
                  <span className="font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-md">
                    +{tier.points} điểm cơ sở
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <FiAward size={20} />
              <h3 className="font-bold text-gray-900">Hệ Số Cấp Độ & Mức Thưởng Tháng</h3>
            </div>
            <p className="text-xs text-gray-500">
              Hệ số áp dụng nhân vào điểm cơ sở. Khóa chưa xác thực mặc định hệ số 1.0.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 bg-gray-50 rounded-xl text-center">
                <p className="text-xs text-gray-500">Cơ bản (BEGINNER)</p>
                <p className="text-lg font-black text-gray-800 mt-1">x1.0</p>
              </div>
              <div className="p-3 bg-blue-50 rounded-xl text-center">
                <p className="text-xs text-blue-600">Trung cấp (INTERMEDIATE)</p>
                <p className="text-lg font-black text-blue-800 mt-1">x1.1</p>
              </div>
              <div className="p-3 bg-purple-50 rounded-xl text-center">
                <p className="text-xs text-purple-600">Nâng cao (ADVANCED)</p>
                <p className="text-lg font-black text-purple-800 mt-1">x1.2</p>
              </div>
            </div>

            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400 pt-2">Khung Thưởng Xếp Hạng</h4>
            <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
              {overview?.policy?.rewardTiers?.map((r, idx) => (
                <div key={idx} className="p-2.5 flex items-center justify-between text-xs hover:bg-gray-50">
                  <span className="font-bold text-gray-800">{r.rank}: {r.badgeName}</span>
                  <span className="font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">
                    +{r.points} pts
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: STUDENT DETAIL & AUDIT */}
      {studentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-100 p-6 space-y-6">
            <div className="flex items-center justify-between border-b pb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-xl">
                  {selectedStudentDetail?.user?.fullName?.charAt(0) || 'H'}
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-900">
                    Đối Soát Điểm Học Viên: {selectedStudentDetail?.user?.fullName || 'Học viên'}
                  </h3>
                  <p className="text-xs text-gray-400">
                    ID: {selectedStudentDetail?.userId} • Email: {selectedStudentDetail?.user?.email}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setStudentModalOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <FiX size={20} />
              </button>
            </div>

            {studentDetailLoading ? (
              <div className="py-12 text-center text-gray-400 animate-pulse">
                Đang tải dữ liệu đối soát...
              </div>
            ) : selectedStudentDetail ? (
              <div className="space-y-6">
                {/* Stats Summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 bg-gray-50 rounded-xl">
                    <p className="text-xs text-gray-400">Điểm tháng này</p>
                    <p className="text-xl font-black text-primary-600">
                      {selectedStudentDetail.totalMonthlyPoints} pts
                    </p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-xl">
                    <p className="text-xs text-gray-400">Khóa hoàn thành</p>
                    <p className="text-xl font-black text-gray-800">
                      {selectedStudentDetail.completedCoursesCount}
                    </p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-xl">
                    <p className="text-xs text-gray-400">Quiz trung bình</p>
                    <p className="text-xl font-black text-emerald-600">
                      {selectedStudentDetail.averageQuizScore !== null ? `${selectedStudentDetail.averageQuizScore}%` : 'N/A'}
                    </p>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-xl">
                    <p className="text-xs text-amber-600">Số dư ví thưởng</p>
                    <p className="text-xl font-black text-amber-700">
                      {selectedStudentDetail.rewardWallet?.currentBalance || 0} pts
                    </p>
                  </div>
                </div>

                {/* Course Completion Records List */}
                <div>
                  <h4 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <FiShield className="text-primary-600" />
                    Các Khóa Học Đóng Góp Thành Tích ({selectedStudentDetail.records.length})
                  </h4>

                  <div className="overflow-x-auto border border-gray-100 rounded-xl">
                    <table className="w-full text-left text-xs text-gray-600">
                      <thead className="bg-gray-50 font-bold text-gray-400 uppercase">
                        <tr>
                          <th className="py-2.5 px-3">Mã Khóa học</th>
                          <th className="py-2.5 px-3">Thời lượng</th>
                          <th className="py-2.5 px-3">Cấp độ</th>
                          <th className="py-2.5 px-3 text-center">Điểm cơ sở</th>
                          <th className="py-2.5 px-3 text-center">Hệ số</th>
                          <th className="py-2.5 px-3 text-center">Điểm nhận</th>
                          <th className="py-2.5 px-3">Ngày hoàn thành</th>
                          <th className="py-2.5 px-3 text-right">Đối soát</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {selectedStudentDetail.records.map((rec) => (
                          <tr key={rec.id} className={rec.isFlagged ? 'bg-rose-50/60' : 'hover:bg-gray-50'}>
                            <td className="py-2.5 px-3 font-mono font-medium text-gray-800">
                              {rec.courseId}
                              {rec.isFlagged && (
                                <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-rose-200 text-rose-800 font-bold">
                                  BỊ GẮN CỜ
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              {formatDuration(rec.courseDurationSeconds)}
                            </td>
                            <td className="py-2.5 px-3 font-semibold">
                              {rec.courseLevel}
                            </td>
                            <td className="py-2.5 px-3 text-center font-bold">
                              {rec.basePoints}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              x{rec.levelMultiplier}
                            </td>
                            <td className="py-2.5 px-3 text-center font-black text-primary-600 text-sm">
                              +{rec.earnedPoints}
                            </td>
                            <td className="py-2.5 px-3 text-gray-400">
                              {new Date(rec.completedAt).toLocaleDateString('vi-VN')}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                onClick={() => {
                                  setTargetRecordId(rec.id);
                                  setTargetFlagState(!rec.isFlagged);
                                  setFlagReasonInput(rec.flagReason || '');
                                  setFlagModalOpen(true);
                                }}
                                className={`px-2 py-1 rounded text-[11px] font-bold flex items-center gap-1 ml-auto transition ${
                                  rec.isFlagged
                                    ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                    : 'bg-rose-100 text-rose-800 hover:bg-rose-200'
                                }`}
                              >
                                <FiFlag size={11} />
                                {rec.isFlagged ? 'Gỡ cờ' : 'Gắn cờ'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* MODAL 2: MANUAL FINALIZE CONFIRMATION */}
      {finalizeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-gray-100 p-6 space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center">
                <FiAlertTriangle size={20} />
              </div>
              <h3 className="font-bold text-gray-900">Xác Nhận Chốt Sổ Tháng {selectedMonth}/{selectedYear}</h3>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Thao tác này sẽ khóa vĩnh viễn snapshot bảng xếp hạng của tháng, tính hạng chính thức và tự động cộng điểm thưởng cho các học viên đạt giải theo chính sách quy định.
            </p>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Lý do chốt sổ (Ghi nhật ký kiểm toán):
              </label>
              <textarea
                value={finalizeReason}
                onChange={(e) => setFinalizeReason(e.target.value)}
                placeholder="Ví dụ: Chốt sổ kiểm toán cuối kỳ theo lịch định kỳ..."
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-primary-500 outline-none"
                rows={3}
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setFinalizeModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
              >
                Hủy
              </button>
              <button
                onClick={handleFinalizeMonth}
                disabled={finalizing}
                className="px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-md transition disabled:opacity-50"
              >
                {finalizing ? 'Đang chốt sổ...' : 'Xác nhận chốt sổ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: MANUAL ADJUST POINTS */}
      {adjustPointsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-gray-100 p-6 space-y-4">
            <div className="flex items-center gap-3 text-primary-600">
              <div className="w-10 h-10 rounded-2xl bg-primary-50 flex items-center justify-center">
                <FiGift size={20} />
              </div>
              <h3 className="font-bold text-gray-900">Điều Chỉnh Điểm Thưởng Học Viên</h3>
            </div>
            <p className="text-xs text-gray-500">
              Học viên: <span className="font-mono font-bold text-gray-700">{adjustUserId}</span>
            </p>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Số điểm thưởng (+ cộng / - trừ):
              </label>
              <input
                type="number"
                value={adjustUserPoints}
                onChange={(e) => setAdjustUserPoints(Number(e.target.value))}
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-800 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Lý do điều chỉnh (Bắt buộc để kiểm toán):
              </label>
              <textarea
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Nhập lý do cụ thể..."
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none"
                rows={3}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setAdjustPointsModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmAdjustPoints}
                disabled={adjusting}
                className="px-4 py-2 text-xs font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-xl shadow-md transition disabled:opacity-50"
              >
                {adjusting ? 'Đang thực hiện...' : 'Cập nhật điểm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: FLAG SUSPECT RECORD */}
      {flagModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-gray-100 p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 flex items-center justify-center">
                <FiFlag size={20} />
              </div>
              <h3 className="font-bold text-gray-900">
                {targetFlagState ? 'Gắn cờ nghi vấn thành tích' : 'Gỡ cờ thành tích'}
              </h3>
            </div>
            <p className="text-xs text-gray-500">
              Bản ghi ID: <span className="font-mono font-bold">{targetRecordId}</span>
            </p>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Lý do đối soát (Lưu nhật ký kiểm toán):
              </label>
              <textarea
                value={flagReasonInput}
                onChange={(e) => setFlagReasonInput(e.target.value)}
                placeholder="Ví dụ: Hoàn thành khóa 20h trong 5 giây, nghi vấn gian lận..."
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none"
                rows={3}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setFlagModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmFlagRecord}
                className={`px-4 py-2 text-xs font-bold text-white rounded-xl shadow-md transition ${
                  targetFlagState ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                Xác nhận
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
