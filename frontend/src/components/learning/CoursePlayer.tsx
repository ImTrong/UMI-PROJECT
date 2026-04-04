import { useState, useEffect, useRef } from 'react';
import { LessonProgress } from '../../services/learning.service';
import { FiPlay, FiPause, FiMaximize, FiVolume2, FiVolumeX } from 'react-icons/fi';

interface CoursePlayerProps {
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

export const CoursePlayer = ({ lesson, progress, onComplete, onTimeUpdate }: CoursePlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(progress?.timeSpentSeconds || 0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [_isFullscreen, setIsFullscreen] = useState(false);
  const [isCompleted, setIsCompleted] = useState(progress?.completed || false);

  useEffect(() => {
    if (videoRef.current && progress?.timeSpentSeconds) {
      videoRef.current.currentTime = progress.timeSpentSeconds;
    }
  }, [progress]);

  const handlePlay = () => {
    videoRef.current?.play();
    setIsPlaying(true);
  };

  const handlePause = () => {
    videoRef.current?.pause();
    setIsPlaying(false);
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const time = videoRef.current.currentTime;
      setCurrentTime(time);
      onTimeUpdate?.(Math.floor(time));
      
      // Auto-mark complete when reaching 90% of video
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

  const handleVolumeChange = () => {
    if (videoRef.current) {
      setIsMuted(videoRef.current.muted);
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      videoRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="bg-black rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        src={lesson.videoUrl}
        className="w-full aspect-video"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onVolumeChange={handleVolumeChange}
        controls={false}
      />
      
      {/* Custom Controls */}
      <div className="p-4 bg-gray-900">
        <div className="flex items-center space-x-4">
          <button
            onClick={isPlaying ? handlePause : handlePlay}
            className="text-white hover:text-primary-400 transition"
          >
            {isPlaying ? <FiPause size={20} /> : <FiPlay size={20} />}
          </button>
          
          <div className="flex-1">
            <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 transition-all"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
          
          <button
            onClick={() => {
              if (videoRef.current) {
                videoRef.current.muted = !isMuted;
              }
            }}
            className="text-white hover:text-primary-400 transition"
          >
            {isMuted ? <FiVolumeX size={20} /> : <FiVolume2 size={20} />}
          </button>
          
          <button
            onClick={toggleFullscreen}
            className="text-white hover:text-primary-400 transition"
          >
            <FiMaximize size={20} />
          </button>
        </div>
        
        <div className="mt-3">
          <h3 className="text-white font-semibold">{lesson.title}</h3>
          {lesson.description && (
            <p className="text-gray-400 text-sm mt-1">{lesson.description}</p>
          )}
          {isCompleted && (
            <span className="inline-block mt-2 text-xs bg-green-500 text-white px-2 py-1 rounded">
              Đã hoàn thành
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
