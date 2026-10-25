import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FiAward, FiCalendar, FiRefreshCw, FiCheckCircle, FiAlertTriangle,
  FiFileText, FiGift, FiEye, FiFlag, FiSearch, FiX, FiShield,
  FiTrendingUp, FiCheck, FiInfo, FiLayers, FiDatabase
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import {
  adminLeaderboardService,
  LeaderboardOverview,
  PeriodLeaderboard,
  StudentDetailAdmin,
  AuditLogAdmin,
  RewardTransactionAdmin,
  CompletionRecordAdmin,
  Pagination,
  FlagRequest,
  AdjustRequest
} from '../../services/admin-leaderboard.service';
import {
  PeriodRef,
  classifyPeriod,
  describeStoredStatus,
  finalizeAvailability,
  describeFinalizeOutcome,
  describeFinalizeError,
  readApiError
} from '../../utils/leaderboard-period';
import {
  RECORD_STATUSES,
  RecordStatus,
  buildAdjustRequest,
  buildFlagRequest,
  describeAuditAction,
  describeRecordStatus,
  describeSyncResult,
  describeTransactionType,
  describeWriteError,
  isOutcomeUnknown
} from '../../utils/leaderboard-admin';

/** A count the API reported, or "—" when it did not (never a made-up 0). */
const fmt = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString('vi-VN') : '—');

export default function AdminLeaderboard() {
  // Overview: the running period (live, top 10), the finalized periods and the system-wide stats
  const [overview, setOverview] = useState<LeaderboardOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Selected period; null = follow the running period reported by the backend (Asia/Ho_Chi_Minh, not the browser clock)
  const [selected, setSelected] = useState<PeriodRef | null>(null);
  // Stored status + ranking of a PAST period (history API)
  const [periodBoard, setPeriodBoard] = useState<PeriodLeaderboard | null>(null);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const periodRequest = useRef(0);

  // Active Tab: 'leaderboard' | 'transactions' | 'audit' | 'policy'
  const [activeTab, setActiveTab] = useState<'leaderboard' | 'transactions' | 'audit' | 'policy'>('leaderboard');

  // Search filter inside leaderboard
  const [searchQuery, setSearchQuery] = useState('');

  // Student detail modal (the name comes from the row that opened it: student-detail does not return one)
  const [studentModalOpen, setStudentModalOpen] = useState(false);
  const [studentTarget, setStudentTarget] = useState<{ userId: string; name: string | null } | null>(null);
  const [selectedStudentDetail, setSelectedStudentDetail] = useState<StudentDetailAdmin | null>(null);
  const [studentDetailLoading, setStudentDetailLoading] = useState(false);
  const [studentDetailError, setStudentDetailError] = useState<string | null>(null);
  const studentRequest = useRef(0);

  const [finalizeModalOpen, setFinalizeModalOpen] = useState(false);
  const [finalizeReason, setFinalizeReason] = useState('');
  const [finalizing, setFinalizing] = useState(false);

  // Adjust points modal. adjustLocked: the last request got no readable answer, so it may have been applied - no resend from here
  const [adjustPointsModalOpen, setAdjustPointsModalOpen] = useState(false);
  const [adjustUserId, setAdjustUserId] = useState('');
  const [adjustUserName, setAdjustUserName] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustLocked, setAdjustLocked] = useState(false);

  // Flag modal: the record and the status it is moved to
  const [flagModalOpen, setFlagModalOpen] = useState(false);
  const [flagTarget, setFlagTarget] = useState<CompletionRecordAdmin | null>(null);
  const [flagStatus, setFlagStatus] = useState<RecordStatus>('SUSPECT');
  const [flagReasonInput, setFlagReasonInput] = useState('');
  const [flagging, setFlagging] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);

  // Transactions & Audit Logs state (null = not loaded yet)
  const [transactions, setTransactions] = useState<RewardTransactionAdmin[] | null>(null);
  const [transPagination, setTransPagination] = useState<Pagination | null>(null);
  const [transLoading, setTransLoading] = useState(false);
  const [transError, setTransError] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogAdmin[] | null>(null);
  const [auditPagination, setAuditPagination] = useState<Pagination | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);

  const current: PeriodRef | null = overview
    ? { month: overview.currentPeriod.month, year: overview.currentPeriod.year }
    : null;
  const period: PeriodRef | null = selected ?? current;
  const kind = period && current ? classifyPeriod(period, current) : null;

  // Load Overview Data (a failed reload keeps the last good data on screen, with the error shown above it)
  const loadOverview = useCallback(async () => {
    try {
      setOverviewLoading(true);
      setOverviewError(null);
      setOverview(await adminLeaderboardService.getOverview());
    } catch (err: any) {
      setOverviewError(readApiError(err, 'Không tải được tổng quan bảng xếp hạng.'));
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  // Load one past period; an answer for a period that is no longer selected is dropped
  const loadPeriod = useCallback(async (p: PeriodRef) => {
    const request = ++periodRequest.current;
    setPeriodLoading(true);
    setPeriodError(null);
    setPeriodBoard(null);
    try {
      const board = await adminLeaderboardService.getPeriodLeaderboard(p.month, p.year);
      if (request === periodRequest.current) setPeriodBoard(board);
    } catch (err: any) {
      if (request === periodRequest.current) setPeriodError(readApiError(err, 'Không tải được dữ liệu của kỳ đã chọn.'));
    } finally {
      if (request === periodRequest.current) setPeriodLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (period && kind === 'PAST') {
      loadPeriod(period);
    } else {
      periodRequest.current++;
      setPeriodBoard(null);
      setPeriodError(null);
      setPeriodLoading(false);
    }
  }, [period?.month, period?.year, kind, loadPeriod]);

  const refreshAll = () => {
    loadOverview();
    if (period && kind === 'PAST') loadPeriod(period);
  };

  // Load Transactions when tab changes
  useEffect(() => {
    if (activeTab === 'transactions') {
      loadTransactions();
    } else if (activeTab === 'audit') {
      loadAuditLogs();
    }
  }, [activeTab]);

  // A failed reload keeps the rows already on screen and shows the error above them
  const loadTransactions = async () => {
    try {
      setTransLoading(true);
      setTransError(null);
      const data = await adminLeaderboardService.getRewardTransactions(1, 50);
      setTransactions(data.transactions);
      setTransPagination(data.pagination);
    } catch (err: any) {
      setTransError(readApiError(err, 'Không tải được sổ giao dịch điểm thưởng.'));
    } finally {
      setTransLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    try {
      setAuditLoading(true);
      setAuditError(null);
      const data = await adminLeaderboardService.getAuditLogs(1, 50);
      setAuditLogs(data.logs);
      setAuditPagination(data.pagination);
    } catch (err: any) {
      setAuditError(readApiError(err, 'Không tải được nhật ký kiểm toán.'));
    } finally {
      setAuditLoading(false);
    }
  };

  // View Student Details (for the selected period); an answer for a learner that is no longer shown is dropped
  const loadStudentDetail = async (userId: string) => {
    const request = ++studentRequest.current;
    setStudentDetailLoading(true);
    setStudentDetailError(null);
    try {
      const detail = await adminLeaderboardService.getStudentDetail(userId, period?.month, period?.year);
      if (request === studentRequest.current) setSelectedStudentDetail(detail);
    } catch (err: any) {
      if (request === studentRequest.current) setStudentDetailError(readApiError(err, 'Không tải được chi tiết học viên.'));
    } finally {
      if (request === studentRequest.current) setStudentDetailLoading(false);
    }
  };

  const handleOpenStudentDetail = (userId: string, name: string | null) => {
    setStudentTarget({ userId, name });
    setSelectedStudentDetail(null);
    setStudentModalOpen(true);
    loadStudentDetail(userId);
  };

  // After a write: reload what it may have changed (ranking, stats, ledger, audit log, the open learner)
  const reloadAfterWrite = (userId?: string) => {
    loadOverview();
    if (period && kind === 'PAST') loadPeriod(period);
    if (transactions !== null || activeTab === 'transactions') loadTransactions();
    if (auditLogs !== null || activeTab === 'audit') loadAuditLogs();
    if (studentModalOpen && studentTarget && (!userId || userId === studentTarget.userId)) loadStudentDetail(studentTarget.userId);
  };

  // Manual Finalize Month: only a past, not yet finalized period (see finalizeAvailability). The backend builds the snapshot and
  // pays the rewards; the page sends the request once, reports the answer and reloads the stored state either way.
  const handleFinalizeMonth = async () => {
    if (!period || !availability?.allowed || finalizing) return;
    const target = period;
    try {
      setFinalizing(true);
      const res = await adminLeaderboardService.finalizeMonth({
        month: target.month,
        year: target.year,
        reason: finalizeReason.trim() || `Quản trị viên chốt bảng xếp hạng tháng ${target.month}/${target.year} thủ công`
      });
      const notice = describeFinalizeOutcome(res);
      if (notice.tone === 'success') toast.success(notice.message, { duration: 6000 });
      else if (notice.tone === 'info') toast(notice.message, { duration: 6000 });
      else toast.error(notice.message, { duration: 6000 });
      setFinalizeModalOpen(false);
      setFinalizeReason('');
    } catch (err: any) {
      toast.error(describeFinalizeError(err).message, { duration: 8000 });
    } finally {
      setFinalizing(false);
      loadOverview();
      loadPeriod(target);
    }
  };

  // Sync Completions (creates only the records that are missing, so repeating it is safe)
  const handleSyncCompletions = async () => {
    if (syncing) return;
    if (!window.confirm('Hệ thống sẽ rà soát các tiến trình đã hoàn thành và lập bản ghi thành tích an toàn. Tiếp tục?')) {
      return;
    }
    try {
      setSyncing(true);
      const res = await adminLeaderboardService.syncCompletions();
      toast.success(describeSyncResult(res), { duration: 6000 });
    } catch (err: any) {
      toast.error(describeWriteError(err, 'Đồng bộ dữ liệu thất bại.').message, { duration: 8000 });
    } finally {
      setSyncing(false);
      reloadAfterWrite();
    }
  };

  // Change the status of a completion record (VALID / SUSPECT / EXCLUDED); only VALID records count in a live ranking
  const openFlagModal = (rec: CompletionRecordAdmin) => {
    setFlagTarget(rec);
    setFlagStatus(rec.status === 'VALID' ? 'SUSPECT' : 'VALID');
    setFlagReasonInput('');
    setFlagError(null);
    setFlagModalOpen(true);
  };

  const handleConfirmFlagRecord = async () => {
    if (!flagTarget || flagging) return;
    let request: FlagRequest;
    try {
      request = buildFlagRequest(flagTarget.id, flagStatus, flagReasonInput);
    } catch (err: any) {
      setFlagError(describeWriteError(err, '').message);
      return;
    }
    try {
      setFlagging(true);
      setFlagError(null);
      const res = await adminLeaderboardService.flagRecord(request);
      toast.success(res.message);
      setFlagModalOpen(false);
      setFlagReasonInput('');
    } catch (err: any) {
      setFlagError(describeWriteError(err, 'Không cập nhật được trạng thái bản ghi.').message);
    } finally {
      setFlagging(false);
      reloadAfterWrite(studentTarget?.userId);
    }
  };

  // Manual Point Adjustment (not idempotent on the backend: one request per confirmed click, never resent automatically)
  const openAdjustModal = (userId: string, name: string | null) => {
    setAdjustUserId(userId);
    setAdjustUserName(name);
    setAdjustAmount('');
    setAdjustReason('');
    setAdjustError(null);
    setAdjustLocked(false);
    setAdjustPointsModalOpen(true);
  };

  const handleConfirmAdjustPoints = async () => {
    if (adjusting || adjustLocked) return;
    let request: AdjustRequest;
    try {
      request = buildAdjustRequest(adjustUserId, adjustAmount, adjustReason);
    } catch (err: any) {
      setAdjustError(describeWriteError(err, '').message);
      return;
    }
    try {
      setAdjusting(true);
      setAdjustError(null);
      const res = await adminLeaderboardService.adjustPoints(request);
      toast.success(res.newBalance !== null ? `${res.message} Số dư mới: ${fmt(res.newBalance)} điểm.` : res.message, { duration: 6000 });
      setAdjustPointsModalOpen(false);
    } catch (err: any) {
      setAdjustError(describeWriteError(err, 'Điều chỉnh điểm thất bại.').message);
      if (isOutcomeUnknown(err)) setAdjustLocked(true);
    } finally {
      setAdjusting(false);
      reloadAfterWrite(request.targetUserId);
    }
  };

  // Format Helpers
  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  // What the selected period shows: the running period comes from the overview (live, top 10 only), a past period from the
  // history API (frozen snapshot when FINALIZED, otherwise computed live), a future period has no data.
  const storedStatus = kind === 'PAST' ? periodBoard?.status ?? null : null;
  const availability = kind ? finalizeAvailability(kind, storedStatus) : null;
  const finalizedSummary = period
    ? overview?.finalizedPeriods.find((p) => p.month === period.month && p.year === period.year) ?? null
    : null;
  const entries =
    kind === 'CURRENT' && overview ? overview.currentPeriod.topEntries : kind === 'PAST' ? periodBoard?.entries ?? [] : [];
  const participants =
    kind === 'CURRENT' && overview ? overview.currentPeriod.participantsCount : kind === 'PAST' ? periodBoard?.totalParticipants ?? null : null;
  const isSnapshot = kind === 'PAST' && storedStatus === 'FINALIZED';
  const tableLoading = (kind === 'CURRENT' && overviewLoading && !overview) || (kind === 'PAST' && periodLoading);
  const tableError = kind === 'PAST' ? periodError : null;

  const yearOptions = (() => {
    const years = new Set<number>();
    if (current) for (let y = current.year - 2; y <= current.year + 1; y++) years.add(y);
    overview?.finalizedPeriods.forEach((p) => years.add(p.year));
    if (period) years.add(period.year);
    return [...years].sort((a, b) => a - b);
  })();

  const selectPeriod = (p: PeriodRef) => {
    setSelected(current && p.month === current.month && p.year === current.year ? null : p);
    setActiveTab('leaderboard');
  };

  const filteredEntries = entries.filter((e) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return e.fullName?.toLowerCase().includes(q) || e.userId.toLowerCase().includes(q);
  });

  if (!overview) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="bg-white p-10 rounded-2xl shadow-sm border border-gray-100 text-center space-y-4">
          {overviewLoading ? (
            <p className="text-gray-400 animate-pulse">Đang tải tổng quan bảng xếp hạng...</p>
          ) : (
            <>
              <FiAlertTriangle className="mx-auto text-4xl text-rose-500" />
              <p className="font-bold text-gray-900">Không tải được tổng quan bảng xếp hạng</p>
              <p className="text-sm text-gray-500">{overviewError}</p>
              <button
                onClick={() => loadOverview()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition shadow-sm"
              >
                <FiRefreshCw /> Thử lại
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

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

        {/* Period Selector & Global Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-200">
            <FiCalendar className="text-gray-400 ml-2" />
            <select
              value={period?.month ?? ''}
              onChange={(e) => period && selectPeriod({ month: Number(e.target.value), year: period.year })}
              className="bg-transparent text-sm font-semibold text-gray-700 outline-none pr-2 py-1 cursor-pointer"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>Tháng {m}</option>
              ))}
            </select>
            <select
              value={period?.year ?? ''}
              onChange={(e) => period && selectPeriod({ month: period.month, year: Number(e.target.value) })}
              className="bg-transparent text-sm font-semibold text-gray-700 outline-none pr-2 py-1 cursor-pointer"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>Năm {y}</option>
              ))}
            </select>
          </div>

          {selected && (
            <button
              onClick={() => setSelected(null)}
              className="px-3.5 py-2 text-sm font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-xl hover:bg-primary-100 transition shadow-sm"
            >
              Về kỳ hiện tại
            </button>
          )}

          <button
            onClick={refreshAll}
            disabled={overviewLoading || periodLoading}
            className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition shadow-sm"
            title="Làm mới"
          >
            <FiRefreshCw className={overviewLoading || periodLoading ? 'animate-spin' : ''} />
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

          {kind === 'PAST' && (
            <button
              onClick={() => setFinalizeModalOpen(true)}
              disabled={!availability?.allowed || finalizing}
              title={availability?.reason}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-gradient-to-r from-amber-500 to-amber-600 rounded-xl hover:from-amber-600 hover:to-amber-700 transition shadow-sm shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FiCheckCircle />
              <span>{finalizing ? 'Đang chốt...' : `Chốt kỳ ${period?.month}/${period?.year}`}</span>
            </button>
          )}
        </div>
      </div>

      {/* Errors of a reload (the last good data stays on screen) */}
      {overviewError && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
          <FiAlertTriangle className="flex-shrink-0" />
          <span>Không làm mới được tổng quan: {overviewError} Dữ liệu dưới đây là lần tải thành công gần nhất.</span>
        </div>
      )}

      {/* Why the finalize action is (not) available for the selected period */}
      {availability && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <FiInfo className="flex-shrink-0" />
          <span>
            Kỳ {period?.month}/{period?.year}: {availability.reason}
            {kind === 'PAST' && periodLoading && ' (đang kiểm tra trạng thái kỳ...)'}
          </span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Status Card */}
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Trạng thái kỳ</p>
            <div className="mt-1 flex items-center gap-2">
              {kind === 'CURRENT' ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  ĐANG DIỄN RA
                </span>
              ) : kind === 'FUTURE' ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-gray-50 text-gray-600 border border-gray-200">
                  CHƯA BẮT ĐẦU
                </span>
              ) : periodLoading ? (
                <span className="text-xs text-gray-400 animate-pulse">Đang tải...</span>
              ) : periodError ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                  KHÔNG XÁC ĐỊNH
                </span>
              ) : storedStatus === 'FINALIZED' ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <FiCheck size={14} /> ĐÃ CHỐT SỔ
                </span>
              ) : storedStatus ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                  {describeStoredStatus(storedStatus).toUpperCase()}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Kỳ: Tháng {period?.month}/{period?.year}
              {isSnapshot && periodBoard?.finalizedAt && ` • chốt lúc ${new Date(periodBoard.finalizedAt).toLocaleString('vi-VN')}`}
            </p>
            {isSnapshot && finalizedSummary && (
              <p className="text-xs text-gray-400">
                Đã phát {fmt(finalizedSummary.totalPointsAwarded)} điểm thưởng • chốt bởi {finalizedSummary.finalizedBy ?? '—'}
              </p>
            )}
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
              {fmt(participants)}
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              {kind === 'CURRENT'
                ? 'Đủ điều kiện, tính trực tiếp'
                : isSnapshot
                ? 'Theo snapshot đã chốt'
                : kind === 'PAST'
                ? 'Xem trước tính trực tiếp, chưa phải snapshot'
                : 'Kỳ chưa có dữ liệu'}
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <FiTrendingUp size={24} />
          </div>
        </div>

        {/* Total Points Awarded */}
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tổng điểm đã cộng vào ví</p>
            <h3 className="text-2xl font-black text-amber-600 mt-1">
              {fmt(overview.stats.totalRewardPointsAwarded)} pts
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              Toàn hệ thống (gồm điều chỉnh cộng của quản trị viên) • Số dư hiện tại: {fmt(overview.stats.totalRewardPointsBalance)}
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <FiGift size={24} />
          </div>
        </div>

        {/* Completion Records */}
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Bản ghi hoàn thành hợp lệ</p>
            <h3 className="text-2xl font-black text-emerald-600 mt-1">
              {fmt(overview.stats.totalValidCompletions)}
            </h3>
            <p className="text-xs text-gray-400 mt-1">Toàn hệ thống, trạng thái VALID</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <FiShield size={24} />
          </div>
        </div>
      </div>

      {/* Finalized periods (the overview lists the 12 most recent) */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">Các kỳ đã chốt ({overview.finalizedPeriods.length})</h3>
          <span className="text-xs text-gray-400">Kỳ hiện tại: Tháng {current?.month}/{current?.year} (giờ Việt Nam)</span>
        </div>
        {overview.finalizedPeriods.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-400">Chưa có kỳ nào được chốt.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-600">
              <thead className="bg-gray-50/75 font-bold text-gray-400 uppercase">
                <tr>
                  <th className="py-2.5 px-4">Kỳ</th>
                  <th className="py-2.5 px-4">Chốt lúc</th>
                  <th className="py-2.5 px-4">Chốt bởi</th>
                  <th className="py-2.5 px-4 text-center">Học viên</th>
                  <th className="py-2.5 px-4 text-center">Điểm thưởng đã phát</th>
                  <th className="py-2.5 px-4 text-right">Xem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {overview.finalizedPeriods.map((p) => {
                  const isSelected = period?.month === p.month && period?.year === p.year;
                  return (
                    <tr key={p.id} className={isSelected ? 'bg-primary-50/50' : 'hover:bg-gray-50'}>
                      <td className="py-2.5 px-4 font-bold text-gray-800">Tháng {p.month}/{p.year}</td>
                      <td className="py-2.5 px-4">{p.finalizedAt ? new Date(p.finalizedAt).toLocaleString('vi-VN') : '—'}</td>
                      <td className="py-2.5 px-4 font-mono">{p.finalizedBy ?? '—'}</td>
                      <td className="py-2.5 px-4 text-center">{fmt(p.participantsCount)}</td>
                      <td className="py-2.5 px-4 text-center font-bold text-amber-600">{fmt(p.totalPointsAwarded)}</td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          onClick={() => selectPeriod({ month: p.month, year: p.year })}
                          className="p-1.5 text-primary-600 hover:bg-primary-50 rounded-lg transition"
                          title="Xem snapshot của kỳ"
                        >
                          <FiEye size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
          Bảng Xếp Hạng Tháng {period?.month}/{period?.year}
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
          Giao dịch Điểm Thưởng{transPagination?.total != null ? ` (${transPagination.total})` : ''}
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
                placeholder="Tìm kiếm theo tên hoặc ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:bg-white"
              />
            </div>
            <div className="text-xs text-gray-400 font-medium text-right">
              {kind === 'CURRENT'
                ? `Hiển thị ${filteredEntries.length} / ${entries.length} hạng đầu (tổng ${fmt(participants)} học viên; API tổng quan chỉ trả 10 hạng đầu)`
                : isSnapshot
                ? `Snapshot đã chốt • ${filteredEntries.length} / ${entries.length} học viên`
                : kind === 'PAST'
                ? `Xem trước tính trực tiếp, chưa phải snapshot • ${filteredEntries.length} / ${entries.length} học viên`
                : 'Kỳ chưa bắt đầu'}
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
                  <th className="py-3.5 px-4 text-center">{isSnapshot ? 'Thưởng (snapshot)' : 'Thưởng dự kiến'}</th>
                  <th className="py-3.5 px-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tableLoading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-gray-400 animate-pulse">
                      Đang tải bảng xếp hạng...
                    </td>
                  </tr>
                ) : tableError ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-rose-600">
                      <FiAlertTriangle className="mx-auto text-3xl mb-2" />
                      {tableError}
                    </td>
                  </tr>
                ) : filteredEntries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-gray-400">
                      <FiAward className="mx-auto text-4xl text-gray-300 mb-2" />
                      {kind === 'FUTURE'
                        ? 'Kỳ này chưa bắt đầu.'
                        : searchQuery
                        ? 'Không có học viên khớp từ khóa tìm kiếm.'
                        : isSnapshot
                        ? 'Snapshot của kỳ này không có học viên nào.'
                        : 'Chưa có dữ liệu thành tích hợp lệ trong kỳ này.'}
                    </td>
                  </tr>
                ) : (
                  filteredEntries.map((entry) => {
                    const durationSeconds = entry.scoreBreakdown.reduce((sum, c) => sum + (c.durationSeconds || 0), 0);
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
                              {entry.fullName?.charAt(0).toUpperCase() || 'H'}
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-gray-900 truncate">
                                {entry.fullName || 'Học viên ẩn'}
                              </p>
                              <p className="text-xs text-gray-400 truncate font-mono">
                                {entry.userId}
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
                          {entry.completedCourses}
                        </td>
                        <td className="py-4 px-4 text-center">
                          {entry.averageScore !== null ? (
                            <span className="font-semibold text-emerald-600">
                              {entry.averageScore}%
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 italic">Không có quiz</span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-center text-xs text-gray-500 font-medium">
                          {entry.scoreBreakdown.length > 0 ? formatDuration(durationSeconds) : '—'}
                        </td>
                        <td className="py-4 px-4 text-center">
                          {entry.rewardPoints !== null && entry.rewardPoints > 0 ? (
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
                              onClick={() => handleOpenStudentDetail(entry.userId, entry.fullName)}
                              className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg transition"
                              title="Xem chi tiết tính điểm"
                            >
                              <FiEye size={16} />
                            </button>
                            <button
                              onClick={() => openAdjustModal(entry.userId, entry.fullName)}
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
              disabled={transLoading}
              className="text-xs font-semibold text-primary-600 hover:text-primary-700 flex items-center gap-1 disabled:opacity-50"
            >
              <FiRefreshCw className={transLoading ? 'animate-spin' : ''} /> Tải lại
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Mọi biến động điểm thưởng đều được ghi vào sổ với số điểm cộng/trừ, số dư sau giao dịch và mô tả.
            {transactions !== null && transPagination?.total !== null && transPagination?.total !== undefined &&
              ` Hiển thị ${transactions.length} / ${transPagination.total} giao dịch mới nhất.`}
          </p>
          {transError && transactions !== null && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              <FiAlertTriangle className="flex-shrink-0" /> Không tải lại được: {transError}
            </div>
          )}

          <div className="overflow-x-auto border border-gray-100 rounded-xl">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-xs uppercase font-bold text-gray-400">
                <tr>
                  <th className="py-3 px-4">Thời gian</th>
                  <th className="py-3 px-4">Học viên</th>
                  <th className="py-3 px-4">Loại giao dịch</th>
                  <th className="py-3 px-4 text-center">Số điểm</th>
                  <th className="py-3 px-4 text-center">Số dư sau</th>
                  <th className="py-3 px-4">Mô tả</th>
                  <th className="py-3 px-4">Tham chiếu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transactions === null ? (
                  <tr>
                    <td colSpan={7} className={`py-8 text-center ${transError ? 'text-rose-600' : 'text-gray-400 animate-pulse'}`}>
                      {transError ? transError : 'Đang tải sổ giao dịch...'}
                    </td>
                  </tr>
                ) : transactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-400">
                      Chưa có giao dịch điểm thưởng nào.
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-gray-50/70">
                      <td className="py-3 px-4 text-xs text-gray-500">
                        {tx.createdAt ? new Date(tx.createdAt).toLocaleString('vi-VN') : '—'}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <p className="font-semibold text-gray-800">{tx.fullName ?? 'Học viên ẩn'}</p>
                        <p className="font-mono text-gray-400">{tx.userId}</p>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                          tx.type === 'LEADERBOARD_REWARD' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                          tx.type === 'COURSE_REDEMPTION' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                          tx.type === 'COURSE_REDEMPTION_REFUND' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                          'bg-purple-50 text-purple-700 border border-purple-200'
                        }`} title={tx.type}>
                          {describeTransactionType(tx.type)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-bold">
                        <span className={tx.amount > 0 ? 'text-emerald-600' : 'text-rose-600'}>
                          {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center text-xs font-semibold text-gray-700">
                        {fmt(tx.balanceAfter)}
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-700 max-w-xs truncate" title={tx.description}>
                        {tx.description || '—'}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-400" title={tx.sourceId ?? undefined}>
                        {tx.sourceId ? `…${tx.sourceId.slice(-6)}` : '—'}
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
              disabled={auditLoading}
              className="text-xs font-semibold text-primary-600 hover:text-primary-700 flex items-center gap-1 disabled:opacity-50"
            >
              <FiRefreshCw className={auditLoading ? 'animate-spin' : ''} /> Tải lại
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Lưu vết thao tác chốt kỳ, đồng bộ, gắn cờ, điều chỉnh điểm thưởng và các sự kiện hệ thống của bảng xếp hạng.
            {auditLogs !== null && auditPagination?.total !== null && auditPagination?.total !== undefined &&
              ` Hiển thị ${auditLogs.length} / ${auditPagination.total} bản ghi mới nhất.`}
          </p>
          {auditError && auditLogs !== null && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              <FiAlertTriangle className="flex-shrink-0" /> Không tải lại được: {auditError}
            </div>
          )}

          <div className="overflow-x-auto border border-gray-100 rounded-xl">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-xs uppercase font-bold text-gray-400">
                <tr>
                  <th className="py-3 px-4">Thời gian</th>
                  <th className="py-3 px-4">Người thực hiện</th>
                  <th className="py-3 px-4">Hành động</th>
                  <th className="py-3 px-4">Đối tượng</th>
                  <th className="py-3 px-4">Lý do</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {auditLogs === null ? (
                  <tr>
                    <td colSpan={5} className={`py-8 text-center ${auditError ? 'text-rose-600' : 'text-gray-400 animate-pulse'}`}>
                      {auditError ? auditError : 'Đang tải nhật ký kiểm toán...'}
                    </td>
                  </tr>
                ) : auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-400">
                      Chưa có nhật ký kiểm toán nào được ghi nhận.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50/70">
                      <td className="py-3 px-4 text-xs text-gray-500">
                        {log.createdAt ? new Date(log.createdAt).toLocaleString('vi-VN') : '—'}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <p className="font-semibold text-gray-800">{log.adminEmail ?? '—'}</p>
                        <p className="font-mono text-gray-400">{log.adminId}</p>
                      </td>
                      <td className="py-3 px-4 font-semibold text-xs text-primary-700" title={log.action}>
                        {describeAuditAction(log.action)}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-gray-500">
                        {log.targetUserId && <p>Học viên: {log.targetUserId}</p>}
                        {log.month !== null && log.year !== null && <p>Kỳ: {log.month}/{log.year}</p>}
                        {!log.targetUserId && (log.month === null || log.year === null) && '—'}
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-700 max-w-sm truncate" title={log.reason}>
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
            {/* The overview API does not return the scoring policy: nothing is shown instead of a copy that could drift */}
            <p className="p-3 text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl">
              API tổng quan hiện không trả cấu hình bậc điểm, nên trang không hiển thị bảng bậc điểm.
            </p>
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
            <p className="p-3 text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl">
              API tổng quan hiện không trả khung thưởng, nên trang không hiển thị khung thưởng.
            </p>
          </div>
        </div>
      )}

      {/* MODAL 1: STUDENT DETAIL & AUDIT */}
      {studentModalOpen && studentTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-5xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-100 p-6 space-y-6">
            <div className="flex items-center justify-between border-b pb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-xl">
                  {studentTarget.name?.charAt(0).toUpperCase() || 'H'}
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-900">
                    Đối Soát Điểm Học Viên: {studentTarget.name || 'Học viên ẩn'}
                  </h3>
                  <p className="text-xs text-gray-400 font-mono">
                    ID: {studentTarget.userId}
                    {selectedStudentDetail && ` • Kỳ ${selectedStudentDetail.month}/${selectedStudentDetail.year}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openAdjustModal(studentTarget.userId, studentTarget.name)}
                  className="px-3 py-1.5 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 flex items-center gap-1"
                >
                  <FiGift size={12} /> Điều chỉnh điểm
                </button>
                <button
                  onClick={() => setStudentModalOpen(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
                >
                  <FiX size={20} />
                </button>
              </div>
            </div>

            {studentDetailLoading && !selectedStudentDetail ? (
              <div className="py-12 text-center text-gray-400 animate-pulse">
                Đang tải dữ liệu đối soát...
              </div>
            ) : studentDetailError && !selectedStudentDetail ? (
              <div className="py-12 text-center space-y-3">
                <FiAlertTriangle className="mx-auto text-3xl text-rose-500" />
                <p className="text-sm text-rose-600">{studentDetailError}</p>
                <button
                  onClick={() => loadStudentDetail(studentTarget.userId)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <FiRefreshCw /> Thử lại
                </button>
              </div>
            ) : selectedStudentDetail ? (
              <div className="space-y-6">
                {studentDetailError && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                    <FiAlertTriangle className="flex-shrink-0" /> Không tải lại được: {studentDetailError} Dữ liệu dưới đây là lần tải gần nhất.
                  </div>
                )}
                {/* Stats Summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 bg-gray-50 rounded-xl">
                    <p className="text-xs text-gray-400">Điểm thành tích kỳ {selectedStudentDetail.month}/{selectedStudentDetail.year}</p>
                    <p className="text-xl font-black text-primary-600">
                      {fmt(selectedStudentDetail.periodPoints)} pts
                    </p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-xl">
                    <p className="text-xs text-gray-400">Khóa hợp lệ trong kỳ</p>
                    <p className="text-xl font-black text-gray-800">
                      {fmt(selectedStudentDetail.periodCourses)}
                    </p>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-xl">
                    <p className="text-xs text-amber-600">Số dư ví thưởng</p>
                    <p className="text-xl font-black text-amber-700">
                      {fmt(selectedStudentDetail.wallet?.balance)} pts
                    </p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-xl">
                    <p className="text-xs text-gray-400">Tổng nhận / đã dùng</p>
                    <p className="text-sm font-black text-gray-800 mt-1">
                      +{fmt(selectedStudentDetail.wallet?.totalEarned)} / −{fmt(selectedStudentDetail.wallet?.totalSpent)}
                    </p>
                  </div>
                </div>

                {/* All completion records of the learner (every status, every period) */}
                <div>
                  <h4 className="text-sm font-bold text-gray-900 mb-1 flex items-center gap-2">
                    <FiShield className="text-primary-600" />
                    Tất cả bản ghi hoàn thành ({selectedStudentDetail.records.length})
                  </h4>
                  <p className="text-xs text-gray-400 mb-3">
                    Chỉ bản ghi Hợp lệ được tính vào bảng xếp hạng đang diễn ra. Snapshot của kỳ đã chốt không thay đổi khi đổi trạng thái bản ghi.
                  </p>

                  <div className="overflow-x-auto border border-gray-100 rounded-xl">
                    <table className="w-full text-left text-xs text-gray-600">
                      <thead className="bg-gray-50 font-bold text-gray-400 uppercase">
                        <tr>
                          <th className="py-2.5 px-3">Khóa học</th>
                          <th className="py-2.5 px-3">Kỳ</th>
                          <th className="py-2.5 px-3">Thời lượng</th>
                          <th className="py-2.5 px-3">Cấp độ</th>
                          <th className="py-2.5 px-3 text-center">Điểm cơ sở</th>
                          <th className="py-2.5 px-3 text-center">Hệ số</th>
                          <th className="py-2.5 px-3 text-center">Điểm nhận</th>
                          <th className="py-2.5 px-3">Hoàn thành</th>
                          <th className="py-2.5 px-3">Trạng thái</th>
                          <th className="py-2.5 px-3 text-right">Đối soát</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {selectedStudentDetail.records.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="py-6 text-center text-gray-400">Học viên chưa có bản ghi hoàn thành nào.</td>
                          </tr>
                        ) : (
                          selectedStudentDetail.records.map((rec) => (
                            <tr key={rec.id} className={rec.status !== 'VALID' ? 'bg-rose-50/60' : 'hover:bg-gray-50'}>
                              <td className="py-2.5 px-3">
                                <p className="font-medium text-gray-800">{rec.courseTitle || '—'}</p>
                                <p className="font-mono text-gray-400">{rec.courseId}</p>
                              </td>
                              <td className="py-2.5 px-3">{rec.month !== null && rec.year !== null ? `${rec.month}/${rec.year}` : '—'}</td>
                              <td className="py-2.5 px-3">
                                {rec.totalDurationSeconds !== null ? formatDuration(rec.totalDurationSeconds) : '—'}
                              </td>
                              <td className="py-2.5 px-3 font-semibold">{rec.level || '—'}</td>
                              <td className="py-2.5 px-3 text-center font-bold">{fmt(rec.baseDurationPoints)}</td>
                              <td className="py-2.5 px-3 text-center">{rec.levelMultiplier !== null ? `x${rec.levelMultiplier}` : '—'}</td>
                              <td className="py-2.5 px-3 text-center font-black text-primary-600 text-sm">
                                {rec.achievementPoints !== null ? `+${rec.achievementPoints}` : '—'}
                              </td>
                              <td className="py-2.5 px-3 text-gray-400">
                                {rec.completedAt ? new Date(rec.completedAt).toLocaleDateString('vi-VN') : '—'}
                              </td>
                              <td className="py-2.5 px-3">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  rec.status === 'VALID' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-200 text-rose-800'
                                }`} title={rec.status}>
                                  {describeRecordStatus(rec.status)}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <button
                                  onClick={() => openFlagModal(rec)}
                                  className={`px-2 py-1 rounded text-[11px] font-bold flex items-center gap-1 ml-auto transition ${
                                    rec.status !== 'VALID'
                                      ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                      : 'bg-rose-100 text-rose-800 hover:bg-rose-200'
                                  }`}
                                >
                                  <FiFlag size={11} />
                                  Đổi trạng thái
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
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
              <h3 className="font-bold text-gray-900">Xác Nhận Chốt Sổ Tháng {period?.month}/{period?.year}</h3>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Learning Service sẽ đóng băng snapshot bảng xếp hạng của tháng (hoặc tiếp tục từ snapshot đã đóng băng), cộng điểm thưởng và huy hiệu cho các hạng đạt giải rồi chuyển kỳ sang trạng thái đã chốt. Kỳ đã chốt không bị tính lại hay thưởng lại.
            </p>
            {storedStatus && (
              <p className="text-xs text-gray-500">
                Trạng thái hiện tại: <span className="font-bold">{describeStoredStatus(storedStatus)}</span>
              </p>
            )}
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
                disabled={finalizing}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                onClick={handleFinalizeMonth}
                disabled={finalizing || !availability?.allowed}
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-gray-100 p-6 space-y-4">
            <div className="flex items-center gap-3 text-primary-600">
              <div className="w-10 h-10 rounded-2xl bg-primary-50 flex items-center justify-center">
                <FiGift size={20} />
              </div>
              <h3 className="font-bold text-gray-900">Điều Chỉnh Điểm Thưởng Học Viên</h3>
            </div>
            <p className="text-xs text-gray-500">
              Học viên: <span className="font-bold text-gray-700">{adjustUserName || 'Học viên ẩn'}</span>{' '}
              <span className="font-mono text-gray-500">({adjustUserId})</span>
            </p>
            <p className="text-xs text-gray-500">
              Mỗi lần xác nhận ghi một giao dịch mới vào sổ điểm thưởng; số dư sau điều chỉnh không được âm.
            </p>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Số điểm thưởng (số nguyên, + cộng / - trừ):
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={adjustAmount}
                disabled={adjusting || adjustLocked}
                onChange={(e) => setAdjustAmount(e.target.value)}
                placeholder="Ví dụ: 100 hoặc -50"
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-800 outline-none disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Lý do điều chỉnh (Bắt buộc để kiểm toán):
              </label>
              <textarea
                value={adjustReason}
                disabled={adjusting || adjustLocked}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Nhập lý do cụ thể..."
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none disabled:opacity-60"
                rows={3}
              />
            </div>

            {adjustError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {adjustError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setAdjustPointsModalOpen(false)}
                disabled={adjusting}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl disabled:opacity-50"
              >
                {adjustLocked ? 'Đóng' : 'Hủy'}
              </button>
              <button
                onClick={handleConfirmAdjustPoints}
                disabled={adjusting || adjustLocked}
                className="px-4 py-2 text-xs font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-xl shadow-md transition disabled:opacity-50"
              >
                {adjusting ? 'Đang thực hiện...' : 'Cập nhật điểm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: CHANGE COMPLETION RECORD STATUS */}
      {flagModalOpen && flagTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-gray-100 p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 flex items-center justify-center">
                <FiFlag size={20} />
              </div>
              <h3 className="font-bold text-gray-900">Đổi trạng thái bản ghi thành tích</h3>
            </div>
            <p className="text-xs text-gray-500">
              {flagTarget.courseTitle || flagTarget.courseId} • hiện tại:{' '}
              <span className="font-bold">{describeRecordStatus(flagTarget.status)}</span>
              <span className="block font-mono text-gray-400">Bản ghi: {flagTarget.id}</span>
            </p>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Trạng thái mới:</label>
              <select
                value={flagStatus}
                disabled={flagging}
                onChange={(e) => setFlagStatus(e.target.value as RecordStatus)}
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none"
              >
                {RECORD_STATUSES.filter((s) => s !== flagTarget.status).map((s) => (
                  <option key={s} value={s}>{describeRecordStatus(s)} ({s})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Lý do đối soát (Lưu nhật ký kiểm toán):
              </label>
              <textarea
                value={flagReasonInput}
                disabled={flagging}
                onChange={(e) => setFlagReasonInput(e.target.value)}
                placeholder="Ví dụ: Hoàn thành khóa 20h trong 5 giây, nghi vấn gian lận..."
                className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none"
                rows={3}
              />
            </div>

            {flagError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {flagError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setFlagModalOpen(false)}
                disabled={flagging}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmFlagRecord}
                disabled={flagging}
                className={`px-4 py-2 text-xs font-bold text-white rounded-xl shadow-md transition disabled:opacity-50 ${
                  flagStatus === 'VALID' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {flagging ? 'Đang cập nhật...' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
