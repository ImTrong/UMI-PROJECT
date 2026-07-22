import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FiAward, FiX, FiArrowRight } from 'react-icons/fi';

import { learningService } from '../../services/learning.service';
import { toast } from 'react-hot-toast';

interface Props {
  isOpen: boolean;
  pathId: string;
  pathTitle: string;
  onClose: () => void;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  color: string;
  size: number;
  rotation: number;
  speedX: number;
  speedY: number;
  opacity: number;
}

const CONFETTI_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
  '#f43f5e', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6',
];

export default function PathCompletionCelebration({ isOpen, pathId, pathTitle, onClose }: Props) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [showContent, setShowContent] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  const createParticles = useCallback(() => {
    const newParticles: Particle[] = [];
    for (let i = 0; i < 80; i++) {
      newParticles.push({
        id: i,
        x: Math.random() * 100,
        y: -10 - Math.random() * 30,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        size: 4 + Math.random() * 8,
        rotation: Math.random() * 360,
        speedX: (Math.random() - 0.5) * 3,
        speedY: 1.5 + Math.random() * 3,
        opacity: 0.8 + Math.random() * 0.2,
      });
    }
    setParticles(newParticles);
  }, []);

  useEffect(() => {
    if (isOpen) {
      createParticles();
      const timer = setTimeout(() => setShowContent(true), 300);
      
      // Auto-generate certificate
      if (pathId && !hasGenerated && !isGenerating) {
        setIsGenerating(true);
        learningService.generatePathCertificate(pathId)
          .then(() => {
            setHasGenerated(true);
            toast.success('Chứng chỉ lộ trình đã được tạo thành công!');
          })
          .catch((err) => {
            console.error('Error auto-generating certificate:', err);
            // Don't show error toast here since it might have already been created
          })
          .finally(() => {
            setIsGenerating(false);
          });
      }

      return () => clearTimeout(timer);
    } else {
      setShowContent(false);
      setParticles([]);
      setHasGenerated(false);
    }
  }, [isOpen, createParticles, pathId]);

  // Animate particles falling
  useEffect(() => {
    if (!isOpen || particles.length === 0) return;

    const interval = setInterval(() => {
      setParticles((prev) =>
        prev
          .map((p) => ({
            ...p,
            y: p.y + p.speedY * 0.5,
            x: p.x + p.speedX * 0.2,
            rotation: p.rotation + 2,
            opacity: p.y > 80 ? Math.max(0, p.opacity - 0.02) : p.opacity,
          }))
          .filter((p) => p.y < 110 && p.opacity > 0)
      );
    }, 30);

    return () => clearInterval(interval);
  }, [isOpen, particles.length]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Confetti Particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {particles.map((p) => (
          <div
            key={p.id}
            className="absolute"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.size}px`,
              height: `${p.size * 0.6}px`,
              backgroundColor: p.color,
              borderRadius: '2px',
              transform: `rotate(${p.rotation}deg)`,
              opacity: p.opacity,
              transition: 'none',
            }}
          />
        ))}
      </div>

      {/* Modal Content */}
      <div
        className={`relative bg-white rounded-3xl shadow-sm max-w-md w-full overflow-hidden transition-all duration-500 ${
          showContent ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
        }`}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 transition-colors z-10 cursor-pointer"
        >
          <FiX className="w-5 h-5 text-slate-400" />
        </button>

        {/* Gradient Header */}
        <div className="bg-gradient-to-br from-emerald-600 via-teal-600 to-teal-700 p-8 text-center relative overflow-hidden">
          {/* Decorative circles */}
          <div className="absolute -right-8 -top-8 w-24 h-24 bg-white/10 rounded-full blur-xl" />
          <div className="absolute -left-4 -bottom-4 w-16 h-16 bg-white/10 rounded-full blur-lg" />

          {/* Trophy */}
          <div className="relative z-10">
            <div className="w-20 h-20 mx-auto mb-4 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center border-2 border-white/30">
              <span className="text-4xl">🏆</span>
            </div>
            <h2 className="text-2xl font-extrabold text-white mb-1">
              Chúc mừng! 🎉
            </h2>
            <p className="text-emerald-100 text-sm font-medium">
              Bạn đã hoàn thành xuất sắc lộ trình
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 text-center">
          <h3 className="text-lg font-extrabold text-slate-900 mb-2 leading-snug">
            "{pathTitle}"
          </h3>
          <p className="text-sm text-slate-500 mb-6 leading-relaxed">
            Bạn đã chinh phục tất cả các chặng đường trong lộ trình này. Hãy tiếp tục khám phá những lộ trình mới!
          </p>

          {/* Achievement Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/50 rounded-xl mb-6">
            <FiAward className="w-5 h-5 text-amber-500" />
            <span className="text-sm font-bold text-amber-700">Thành tích: Hoàn thành lộ trình</span>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <Link
              to="/certificates"
              className={`w-full py-3 font-bold rounded-xl text-sm shadow-sm transition-all flex items-center justify-center gap-2 ${
                isGenerating 
                  ? 'bg-emerald-100 text-emerald-400 cursor-not-allowed' 
                  : 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:shadow-sm hover:scale-[1.02] active:scale-[0.98]'
              }`}
              onClick={(e) => {
                if (isGenerating) e.preventDefault();
                else onClose();
              }}
            >
              {isGenerating ? (
                <>
                  <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                  Đang tạo chứng chỉ...
                </>
              ) : (
                <>Xem chứng chỉ lộ trình <FiArrowRight className="w-4 h-4" /></>
              )}
            </Link>
            <button
              onClick={onClose}
              className="w-full py-3 bg-slate-100 text-slate-600 font-bold rounded-xl text-sm hover:bg-slate-200 transition-all cursor-pointer"
            >
              Tiếp tục khám phá
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
