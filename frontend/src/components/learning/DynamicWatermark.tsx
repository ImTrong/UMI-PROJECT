import { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';

export const DynamicWatermark = () => {
  const user = useSelector((state: RootState) => state.auth.user);
  
  const [position, setPosition] = useState({ top: '10%', left: '10%' });
  const [timestamp, setTimestamp] = useState('');

  useEffect(() => {
    const updateWatermark = () => {
      // Random position: top 5% to 85%, left 5% to 75% to keep it visible
      const top = Math.floor(Math.random() * 80) + 5;
      const left = Math.floor(Math.random() * 70) + 5;
      setPosition({ top: `${top}%`, left: `${left}%` });

      // Update timestamp
      const now = new Date();
      const formattedTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      setTimestamp(formattedTime);
    };

    // Initial setup
    updateWatermark();

    // Update every 15 seconds so it's less distracting
    const interval = setInterval(updateWatermark, 15000);
    return () => clearInterval(interval);
  }, []);

  if (!user) return null;

  const displayUserId = (user as any).userId || user.id || 'N/A';

  return (
    <div
      className="absolute z-50 pointer-events-none select-none transition-all duration-3000 ease-in-out"
      style={{ 
        top: position.top, 
        left: position.left,
        opacity: 0.15 // Rất mờ để không cản trở người dùng xem video/PDF
      }}
    >
      <div 
        className="text-white/60 text-[10px] px-2 py-1 whitespace-nowrap font-mono tracking-wider"
        style={{
          textShadow: '1px 1px 2px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.8)', // Viền đen để dễ đọc trên nền sáng mờ
          userSelect: 'none',
          WebkitUserSelect: 'none'
        }}
      >
        {user.email} • {displayUserId.toString().substring(0, 8)} • {timestamp}
      </div>
    </div>
  );
};
