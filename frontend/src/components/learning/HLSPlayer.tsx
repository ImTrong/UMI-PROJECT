import { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import { MdFullscreen, MdFullscreenExit } from 'react-icons/md';
import { learningService, LessonProgress } from '../../services/learning.service';
import { DynamicWatermark } from './DynamicWatermark';

// ============================================
// Types
// ============================================

interface HLSPlayerProps {
  lesson: {
    id: string;
    title: string;
    description?: string;
    videoUrl: string;
    duration: number;
  };
  progress?: LessonProgress;
  onComplete?: () => void;
  onTimeUpdate?: (seconds: number) => void;
}

// ============================================
// HLS Player Component
// ============================================

export const HLSPlayer = ({ lesson, progress, onComplete, onTimeUpdate }: HLSPlayerProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hlsReady, setHlsReady] = useState(true);
  const [duration, setDuration] = useState(0);
  const [isCompleted, setIsCompleted] = useState(progress?.completed || false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ── Fullscreen handler ──
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  // ── Cleanup function ──
  const cleanup = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  // ── Load HLS stream ──
  const loadHLSStream = useCallback(async () => {
    if (!lesson.id) return;

    setIsLoading(true);
    setError(null);

    try {
      // First, try HLS endpoint
      const hlsData = await learningService.getHLSStream(lesson.id);

      if (!hlsData.hls.ready) {
        setHlsReady(false);
        setIsLoading(false);
        return;
      }

      setHlsReady(true);

      // Fetch the signed playlist (with presigned .ts URLs)
      const signedPlaylist = await learningService.getSignedPlaylist(lesson.id);

      // Create a blob URL from the signed playlist
      const playlistBlob = new Blob([signedPlaylist], {
        type: 'application/vnd.apple.mpegurl',
      });
      const playlistUrl = URL.createObjectURL(playlistBlob);

      const video = videoRef.current;
      if (!video) return;

      // Cleanup previous HLS instance
      cleanup();

      if (Hls.isSupported()) {
        // ── Use hls.js ──
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          startLevel: -1, // Auto quality selection
        });

        hlsRef.current = hls;

        hls.loadSource(playlistUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setIsLoading(false);
          // Restore position if progress exists
          if (progress?.timeSpentSeconds && video) {
            video.currentTime = progress.timeSpentSeconds;
          }
        });

        hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                // Try to recover
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                setError('Lỗi phát video. Vui lòng thử lại.');
                hls.destroy();
                break;
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // ── Native HLS support (Safari / iOS) ──
        video.src = playlistUrl;
        video.addEventListener('loadedmetadata', () => {
          setIsLoading(false);
          if (progress?.timeSpentSeconds) {
            video.currentTime = progress.timeSpentSeconds;
          }
        });
      } else {
        setError('Trình duyệt không hỗ trợ phát video HLS.');
        setIsLoading(false);
      }

      // Schedule URL refresh before expiry
      const refreshMs = (hlsData.expiresIn - 10) * 1000;
      if (refreshMs > 0) {
        refreshTimerRef.current = setTimeout(() => {
          loadHLSStream();
        }, refreshMs);
      }
    } catch (err: any) {
      if (err?.response?.status === 403) {
        setError('Bạn cần mua khóa học này để xem video.');
      } else if (err?.response?.status === 404) {
        // HLS not available, fallback to direct MP4 streaming
        fallbackToMP4();
      } else {
        setError('Không thể tải video. Vui lòng thử lại.');
      }
      setIsLoading(false);
    }
  }, [lesson.id, progress?.timeSpentSeconds, cleanup]);

  // ── Fallback to MP4 presigned URL ──
  const fallbackToMP4 = useCallback(async () => {
    try {
      const video = videoRef.current;
      if (!video) return;

      // If HLS fails, try direct stream endpoint
      const streamData = await fetch(`/api/learning/lessons/${lesson.id}/stream`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
        },
      });

      if (streamData.ok) {
        const data = await streamData.json();
        video.src = data.streamUrl;
        setIsLoading(false);

        // Refresh before expiry
        const refreshMs = (data.expiresIn - 5) * 1000;
        if (refreshMs > 0) {
          refreshTimerRef.current = setTimeout(fallbackToMP4, refreshMs);
        }
      } else {
        // Fallback to the original video URL if stream endpoint fails
        video.src = lesson.videoUrl;
        setIsLoading(false);
      }
    } catch {
      const video = videoRef.current;
      if (video) video.src = lesson.videoUrl;
      setIsLoading(false);
    }
  }, [lesson.id, lesson.videoUrl]);

  // ── Initialize player on mount / lesson change ──
  useEffect(() => {
    setIsCompleted(progress?.completed || false);
    loadHLSStream();

    return cleanup;
  }, [lesson.id, loadHLSStream, cleanup, progress?.completed]);

  // ── Video event handlers ──
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const time = videoRef.current.currentTime;
      onTimeUpdate?.(Math.floor(time));

      // Auto-mark complete at 90%
      if (!isCompleted && duration > 0 && time / duration >= 0.9) {
        setIsCompleted(true);
        onComplete?.();
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  // ── Render ──

  // HLS not ready (processing)
  if (!hlsReady) {
    return (
      <div className="bg-black rounded-xl overflow-hidden flex flex-col h-full">
        <div className="w-full aspect-video flex items-center justify-center bg-slate-900">
          <div className="text-center p-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500 mx-auto mb-4"></div>
            <p className="text-white text-lg font-medium">Video đang được xử lý...</p>
            <p className="text-slate-400 text-sm mt-2">
              Video đang được chuyển đổi sang định dạng HLS để phát trực tuyến.
              <br />Vui lòng quay lại sau vài phút.
            </p>
          </div>
        </div>
        <div className="p-4 bg-slate-900 border-t border-slate-800 flex-none">
          <h3 className="text-white font-semibold">{lesson.title}</h3>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-black rounded-xl overflow-hidden flex flex-col h-full">
        <div className="w-full aspect-video flex items-center justify-center bg-slate-900">
          <div className="text-center p-8">
            <svg className="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <p className="text-red-400 text-lg">{error}</p>
            <button
              onClick={() => loadHLSStream()}
              className="mt-4 px-6 py-2 bg-cyan-600 text-white rounded-xl hover:bg-cyan-700 transition-colors"
            >
              Thử lại
            </button>
          </div>
        </div>
        <div className="p-4 bg-slate-900 border-t border-slate-800 flex-none">
          <h3 className="text-white font-semibold">{lesson.title}</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-black rounded-xl overflow-hidden flex flex-col h-full">
      {/* Container for Video + Watermark, enables fullscreen for both */}
      <div 
        ref={containerRef} 
        className="relative w-full bg-black flex-1 flex flex-col justify-center group select-none"
        onDoubleClick={toggleFullscreen}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      >
        <style>{`
          /* Hide native fullscreen button to force using custom fullscreen that includes watermark */
          video::-webkit-media-controls-fullscreen-button {
            display: none !important;
          }
        `}</style>
        
        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-cyan-500"></div>
          </div>
        )}

        {/* Dynamic Watermark for Anti-Piracy */}
        <DynamicWatermark />


        {/* Video element */}
        <video
          ref={videoRef}
          className="w-full max-h-[85vh] aspect-video object-contain"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          controls
          controlsList="nodownload nofullscreen"
          autoPlay={false}
          playsInline
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
        >
          Trình duyệt của bạn không hỗ trợ thẻ video.
        </video>
      </div>

      {/* Info bar */}
      <div className="p-4 bg-slate-900 border-t border-slate-800 flex-none relative z-10">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-white font-semibold">{lesson.title}</h3>
            {lesson.description && (
              <p className="text-slate-400 text-sm mt-1">{lesson.description}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {isCompleted && (
              <span className="inline-block text-xs bg-green-500 text-white px-2 py-1 rounded">
                Đã hoàn thành
              </span>
            )}
            <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">
              HLS
            </span>
            <button
              onClick={toggleFullscreen}
              className="text-slate-400 hover:text-white transition-colors p-1"
              title={isFullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}
            >
              {isFullscreen ? <MdFullscreenExit size={24} /> : <MdFullscreen size={24} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
