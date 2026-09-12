// ============================================================
// Learner Analytics Dashboard — Composition Page
// ============================================================
// This page is a COMPOSITION container only.
// It does NOT contain business logic or analytics calculations.
// All data comes from the Analytics Engine (backend) via API.
//
// Data flow:
//   mount → getLearnerDashboard() → loading → success (real data)
//                                           → error (error state)
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { analyticsService } from '../services/analytics.service';
import type {
  LearnerAnalyticsDashboardData,
  SectionStatus,
} from '../components/learner-analytics/learner-analytics.types';

import {
  DashboardHeader,
  LearningOverview,
  LearningTimeline,
  ProgressTrendChart,
  PerformanceTrendChart,
  EngagementAnalytics,
  SkillAnalytics,
  KnowledgeGap,
  BottleneckDetection,
  RevisitRecovery,
  LearningState,
  NextRecommendedAction,
  AILearningSummary,
} from '../components/learner-analytics';

export default function LearningAnalytics() {
  const { user } = useAuth();

  // ─────────────────────────────────────────────────
  // Dashboard data + global loading state
  // ─────────────────────────────────────────────────
  const [dashboardData, setDashboardData] =
    useState<LearnerAnalyticsDashboardData | null>(null);
  const [globalStatus, setGlobalStatus] = useState<SectionStatus>('loading');

  const loadAnalytics = useCallback(async () => {
    setGlobalStatus('loading');
    try {
      const data = await analyticsService.getLearnerDashboard();
      setDashboardData(data);
      setGlobalStatus('ready');
    } catch {
      setGlobalStatus('error');
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  // ─────────────────────────────────────────────────
  // Per-section status: if global is loading/error,
  // all sections inherit. If global is ready, each
  // section checks whether it has data.
  // ─────────────────────────────────────────────────
  const getStatus = (block: any): SectionStatus => {
    if (globalStatus === 'loading') return 'loading';
    if (globalStatus === 'error') return 'error';
    if (!block) return 'empty';
    if (block.status === 'INSUFFICIENT_DATA') return 'empty';
    return 'ready';
  };

  const d = dashboardData; // shorthand

  // Section-level data availability checks
  const overviewStatus = getStatus(d?.overview ? { status: 'READY' } : null);
  const timelineStatus = (globalStatus === 'loading' || globalStatus === 'error') 
    ? globalStatus 
    : (Array.isArray(d?.timeline?.milestones) && d!.timeline!.milestones.length > 0 ? 'ready' : 'empty');
    
  const progressStatus = getStatus(d?.progressTrend);
  const performanceStatus = getStatus(d?.performanceTrend);
  const engagementStatus = getStatus(d?.engagement);
  const skillsStatus = getStatus(d?.skills);
  const knowledgeGapStatus = getStatus(d?.knowledgeGaps);
  const bottleneckStatus = getStatus(d?.bottlenecks);
  const revisitStatus = getStatus(d?.recovery);
  const learningStateStatus = getStatus(d?.learningState ? { status: 'READY' } : null);
  const recommendationStatus = (globalStatus === 'loading' || globalStatus === 'error')
    ? globalStatus
    : (Array.isArray(d?.recommendations) && d!.recommendations.length > 0 ? 'ready' : 'empty');
  // AI Summary: use real data from backend
  const aiSummaryStatus: SectionStatus = globalStatus === 'loading'
    ? 'loading'
    : globalStatus === 'error'
      ? 'error'
      : d?.aiSummary
        ? 'ready'
        : 'empty';

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* ── Header ── */}
      <DashboardHeader userName={user?.fullName} />

      {/* ── Learning Overview (5 KPI Cards) ── */}
      <section className="mb-8">
        <LearningOverview
          data={d?.overview ?? null}
          status={overviewStatus}
          onRetry={loadAnalytics}
        />
      </section>

      {/* ── Trends: Progress & Performance ── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ProgressTrendChart
          data={d?.progressTrend ?? null}
          status={progressStatus}
          onRetry={loadAnalytics}
        />
        <PerformanceTrendChart
          data={d?.performanceTrend ?? null}
          status={performanceStatus}
          onRetry={loadAnalytics}
        />
      </section>

      {/* ── Engagement & Momentum ── */}
      <section className="mb-8">
        <EngagementAnalytics
          data={d?.engagement ?? null}
          status={engagementStatus}
          onRetry={loadAnalytics}
        />
      </section>

      {/* ── Skill Analytics ── */}
      <section className="mb-8">
        <SkillAnalytics
          data={d?.skills ?? null}
          status={skillsStatus}
          onRetry={loadAnalytics}
        />
      </section>

      {/* ── Learning Insights: Gap + Bottlenecks ── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <KnowledgeGap
          data={d?.knowledgeGaps ?? null}
          status={knowledgeGapStatus}
          onRetry={loadAnalytics}
        />
        <BottleneckDetection
          data={d?.bottlenecks ?? null}
          status={bottleneckStatus}
          onRetry={loadAnalytics}
        />
      </section>

      {/* ── Learning Insights: Revisit/Recovery + State ── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <RevisitRecovery
          data={d?.recovery ?? null}
          status={revisitStatus}
          onRetry={loadAnalytics}
        />
        <LearningState
          data={d?.learningState ?? null}
          status={learningStateStatus}
          onRetry={loadAnalytics}
        />
      </section>

      {/* ── Next Recommended Action ── */}
      <section className="mb-8">
        <NextRecommendedAction
          recommendations={d?.recommendations ?? []}
          status={recommendationStatus}
          onRetry={loadAnalytics}
        />
      </section>

      {/* ── AI Learning Summary ── */}
      <section className="mb-8">
        <AILearningSummary
          data={d?.aiSummary ?? null}
          status={aiSummaryStatus}
          onRetry={loadAnalytics}
        />
      </section>

      {/* ── Learning Journey Timeline (bottom — historical view) ── */}
      <section className="mb-8">
        <LearningTimeline
          milestones={d?.timeline?.milestones ?? []}
          status={timelineStatus}
          onRetry={loadAnalytics}
        />
      </section>
    </div>
  );
}
