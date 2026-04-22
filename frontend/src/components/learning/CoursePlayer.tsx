import { useState, useEffect, useRef } from 'react';
import { LessonProgress } from '../../services/learning.service';

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
  const [duration, setDuration] = useState(0);
  const [isCompleted, setIsCompleted] = useState(progress?.completed || false);

  useEffect(() => {
    // When lesson changes or mounts, initialize player correctly
    setIsCompleted(progress?.completed || false);
    
    if (videoRef.current) {
      // Reload is required when src changes in React
      videoRef.current.load();
      if (progress?.timeSpentSeconds) {
        videoRef.current.currentTime = progress.timeSpentSeconds;
      }
    }
  }, [lesson.videoUrl, progress?.completed]);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const time = videoRef.current.currentTime;
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

  return (
    <div className="bg-black rounded-lg overflow-hidden flex flex-col h-full">
      <video
        ref={videoRef}
        src={lesson.videoUrl}
        className="w-full aspect-video"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        controls
        controlsList="nodownload"
        autoPlay={false}
      >
        Trình duyệt của bạn không hỗ trợ thẻ video.
      </video>
        
      <div className="p-4 bg-gray-900 border-t border-gray-800 flex-none relative z-10">
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
  );
};

