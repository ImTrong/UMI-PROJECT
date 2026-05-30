import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

/**
 * Custom Hook to protect course resources from inspect and download.
 * Disables:
 * - Right click (context menu)
 * - Keyboard shortcuts: F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U, Ctrl+S, Ctrl+P (and Mac Cmd equivalents)
 * - Text copying and cutting
 * - Dragging of elements (e.g. video, images)
 * - DevTools interaction using a debugger freeze loop and window size checks.
 * 
 * Returns { isDevToolsOpen } so page components can unmount sensitive assets from the DOM.
 * 
 * @param enabled Whether the protection is active (defaults to true)
 */
export const useFileProtection = (enabled = true) => {
  // 1. Synchronous initialization check:
  // We check the window dimensions synchronously during state initialization.
  // This ensures that if the user already has DevTools open, isDevToolsOpen is true
  // on the VERY FIRST RENDER cycle. This prevents any split-second DOM mounting
  // of protected video/PDF links that DevTools could capture.
  const [isDevToolsOpen, setIsDevToolsOpen] = useState(() => {
    if (typeof window === 'undefined') return false;

    const hostname = window.location.hostname;
    // NOTE: DevTools protection is bypassed on localhost during development 
    // to prevent freezing your own coding session. To test the block screen locally,
    // temporarily change the line below to: const isLocal = false;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.');
    if (isLocal) return false;

    const threshold = 160;
    const widthThreshold = window.outerWidth - window.innerWidth > threshold;
    const heightThreshold = window.outerHeight - window.innerHeight > threshold;
    
    return widthThreshold || heightThreshold;
  });

  useEffect(() => {
    if (!enabled) return;

    const hostname = window.location.hostname;
    // Bypassed on localhost by default for developer convenience.
    // Change to const isLocal = false; to test on localhost.
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.');

    // 2. Disable Right Click
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      toast.error('Để bảo mật tài nguyên học tập, tính năng chuột phải bị vô hiệu hóa.', {
        id: 'sec-right-click',
        duration: 2000,
      });
    };

    // 3. Disable Keyboard Shortcuts (Inspect, DevTools, View Source, Save, Print)
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      
      const isInspectKey = 
        e.key === 'F12' || e.keyCode === 123 || // F12
        ((e.ctrlKey || (isMac && e.metaKey)) && e.shiftKey && (e.key === 'I' || e.keyCode === 73)) || // Ctrl+Shift+I / Cmd+Opt+I
        ((e.ctrlKey || (isMac && e.metaKey)) && e.shiftKey && (e.key === 'J' || e.keyCode === 74)) || // Ctrl+Shift+J / Cmd+Opt+J
        ((e.ctrlKey || (isMac && e.metaKey)) && e.shiftKey && (e.key === 'C' || e.keyCode === 67));   // Ctrl+Shift+C / Cmd+Opt+C

      const isViewSourceKey = (e.ctrlKey || (isMac && e.metaKey)) && (e.key === 'u' || e.key === 'U' || e.keyCode === 85); // Ctrl+U / Cmd+Opt+U
      const isSaveKey = (e.ctrlKey || (isMac && e.metaKey)) && (e.key === 's' || e.key === 'S' || e.keyCode === 83);       // Ctrl+S / Cmd+S
      const isPrintKey = (e.ctrlKey || (isMac && e.metaKey)) && (e.key === 'p' || e.key === 'P' || e.keyCode === 80);     // Ctrl+P / Cmd+P

      if (isInspectKey || isViewSourceKey || isSaveKey || isPrintKey) {
        e.preventDefault();
        e.stopPropagation();
        toast.error('Tính năng này bị vô hiệu hóa vì lý do bảo mật tài nguyên.', {
          id: 'sec-shortcut',
          duration: 2000,
        });
      }
    };

    // 4. Disable copy and cut actions
    const handleCopyCut = (e: ClipboardEvent) => {
      e.preventDefault();
      toast.error('Không được phép sao chép tài nguyên học tập trên trang này.', {
        id: 'sec-copy',
        duration: 2000,
      });
    };

    // 5. Disable drag and drop (prevent dragging images or video to desktop/address bar)
    const handleDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    // 6. DevTools Detection: Size-based check (Runs dynamically on resize)
    const checkSizes = () => {
      if (isLocal) return;

      const threshold = 160;
      const widthThreshold = window.outerWidth - window.innerWidth > threshold;
      const heightThreshold = window.outerHeight - window.innerHeight > threshold;
      
      if (widthThreshold || heightThreshold) {
        setIsDevToolsOpen(true);
        toast.error('Phát hiện bảng kiểm tra mã nguồn đang mở. Vui lòng đóng lại để học tập.', {
          id: 'sec-devtools-sizes',
          duration: 4000,
        });
      }
    };

    // 7. DevTools Detection: Debugger time delta check
    const checkDebugger = () => {
      if (isLocal) return;

      const startTime = performance.now();
      // eslint-disable-next-line no-debugger
      debugger;
      const endTime = performance.now();
      
      if (endTime - startTime > 100) {
        setIsDevToolsOpen(true);
      }
    };

    // 8. Extension Piracy Check: Detect injected global variables from common video downloader extensions
    const checkPiracyExtensions = () => {
      if (isLocal) return;

      const suspiciousVars = [
        '__vdp_info',       // Video Downloader Plus
        'idm_',             // IDM Integration Module
        'vgetExtension',    // vGet Extension
        '__hls_downloader', // HLS Downloader
        'videoDownloader',
        '__coccoc_video'    // CocCoc browser sniffer
      ];

      for (const varName of suspiciousVars) {
        if (typeof (window as any)[varName] !== 'undefined' || 
            Object.keys(window).some(k => k.toLowerCase().includes('videodownloader') || k.includes('idm'))) {
          setIsDevToolsOpen(true);
          toast.error('Phát hiện tiện ích hỗ trợ tải lậu (Video Downloader/IDM). Vui lòng tắt tiện ích để tiếp tục học.', {
            id: 'sec-extension-block',
            duration: 4000,
          });
          break;
        }
      }
    };

    // Add event listeners
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('copy', handleCopyCut);
    document.addEventListener('cut', handleCopyCut);
    document.addEventListener('dragstart', handleDragStart);

    // Initial check on mount
    checkSizes();
    checkDebugger();
    checkPiracyExtensions();

    // Listen to resize and periodic debugger checks
    window.addEventListener('resize', checkSizes);
    const debuggerInterval = setInterval(checkDebugger, 1000);
    const piracyInterval = setInterval(checkPiracyExtensions, 3000);

    // Cleanup listeners and interval
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('copy', handleCopyCut);
      document.removeEventListener('cut', handleCopyCut);
      document.removeEventListener('dragstart', handleDragStart);
      window.removeEventListener('resize', checkSizes);
      if (debuggerInterval) clearInterval(debuggerInterval);
      if (piracyInterval) clearInterval(piracyInterval);
    };
  }, [enabled]);

  return { isDevToolsOpen };
};
