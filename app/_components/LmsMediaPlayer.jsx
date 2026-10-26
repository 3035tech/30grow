'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { S } from '../dashboard/dashboard-shared';
import { StatusToneChip } from './StatusToneChip';
import { lmsPdfCanEmbed } from '../../lib/development/lms-media.js';
import { EmptyState } from './EmptyState';

function loadScript(src, globalKey) {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (globalKey && window[globalKey]) return Promise.resolve(window[globalKey]);
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) {
    return new Promise((resolve) => {
      if (globalKey && window[globalKey]) resolve(window[globalKey]);
      else existing.addEventListener('load', () => resolve(globalKey ? window[globalKey] : null));
    });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve(globalKey ? window[globalKey] : null);
    s.onerror = () => reject(new Error(`script ${src}`));
    document.body.appendChild(s);
  });
}

function PlayerChrome({
  title,
  kindLabel,
  resumeLabel,
  loadingLabel,
  loading,
  loadErrorLabel,
  fallbackHref,
  openLabel,
  onClose,
  closeLabel,
  children,
}) {
  return (
    <div className="overflow-hidden rounded-card border border-brand-500/25 bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/10 bg-brand-500/[0.06] px-3 py-2.5">
        <div className="min-w-0 flex flex-wrap items-center gap-2">
          <span className={cn(S.cardRowTitle, 'min-w-0 truncate')}>{title}</span>
          {kindLabel ? <StatusToneChip tone="neutral">{kindLabel}</StatusToneChip> : null}
          {resumeLabel ? <StatusToneChip tone="info">{resumeLabel}</StatusToneChip> : null}
        </div>
        {onClose ? (
          <button
            type="button"
            className={cn(S.btnGhost, 'min-h-touch shrink-0 text-2xs')}
            onClick={onClose}
            aria-label={closeLabel}
          >
            {closeLabel}
          </button>
        ) : null}
      </div>
      <div className="relative">
        {loading ? (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-ink/80 font-mono text-2xs text-canvas"
            aria-live="polite"
          >
            {loadingLabel}
          </div>
        ) : null}
        {!loading && loadErrorLabel ? (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-ink/90 px-4 text-center text-canvas"
            role="status"
            aria-live="polite"
          >
            <p className="m-0 font-ui text-sm">{loadErrorLabel}</p>
            {fallbackHref ? (
              <a href={fallbackHref} target="_blank" rel="noreferrer" className={cn(S.btnBrandSoft, 'min-h-touch no-underline')}>
                {openLabel || 'Open lesson'}
              </a>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/**
 * YouTube / Vimeo / PDF in-app viewer with optional resume + progress callback.
 * PDFs: iframe only for same-origin (CSP frame-src 'self'); external → open CTA.
 * Does not auto-complete lessons.
 */
export function LmsMediaPlayer({
  lesson,
  startAtSec = 0,
  onProgress,
  onClose,
  closeLabel = 'Close',
  kindLabel,
  resumeLabel,
  loadingLabel = '…',
  loadErrorLabel = 'The player could not be loaded.',
  openLabel,
  pdfExternalHint,
  className,
}) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const lastSentRef = useRef(0);
  const onProgressRef = useRef(onProgress);
  const seekOnceRef = useRef(Math.max(0, Math.floor(Number(startAtSec) || 0)));
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showResumeChip, setShowResumeChip] = useState(
    () => Math.max(0, Math.floor(Number(startAtSec) || 0)) >= 15
  );
  const [pageOrigin, setPageOrigin] = useState('');

  const kind = lesson?.contentKind;
  const videoId = lesson?.videoId;
  const embedUrl = lesson?.embedUrl;
  const contentUrl = lesson?.contentUrl || embedUrl;
  const title = lesson?.title || 'Lesson';

  useEffect(() => {
    if (typeof window !== 'undefined') setPageOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  // Capture resume position once per lesson open (avoid remount when progress updates).
  useEffect(() => {
    const s = Math.max(0, Math.floor(Number(startAtSec) || 0));
    seekOnceRef.current = s;
    setShowResumeChip(s >= 15);
  }, [lesson?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- startAt only on lesson change

  useEffect(() => {
    if (!lesson) return undefined;
    const startAt = seekOnceRef.current;

    const flush = (positionSec, durationSec, { force = false } = {}) => {
      const cb = onProgressRef.current;
      if (!cb) return;
      const pos = Math.floor(Number(positionSec) || 0);
      if (pos < 0) return;
      const now = Date.now();
      if (!force && now - lastSentRef.current < 12000 && pos > 0) return;
      lastSentRef.current = now;
      cb({
        lessonId: lesson.id,
        positionSec: pos,
        durationSec: Math.floor(Number(durationSec) || 0),
      });
    };

    let cancelled = false;
    let pollId = null;
    let apiReadyTimeoutId = null;
    let loadTimeoutId = ['youtube', 'vimeo'].includes(kind) ? window.setTimeout(() => {
      loadTimeoutId = null;
      if (!cancelled) {
        setLoading(false);
        setLoadFailed(true);
      }
    }, 12000) : null;
    const clearLoadTimeout = () => {
      if (loadTimeoutId) window.clearTimeout(loadTimeoutId);
      loadTimeoutId = null;
    };
    setLoadFailed(false);

    const setupYoutube = async () => {
      if (!videoId || !hostRef.current) return;
      setLoading(true);
      try {
        await loadScript('https://www.youtube.com/iframe_api', null);
        await Promise.race([
          new Promise((resolve) => {
            if (window.YT?.Player) resolve();
            else {
              const prev = window.onYouTubeIframeAPIReady;
              window.onYouTubeIframeAPIReady = () => {
                if (typeof prev === 'function') prev();
                resolve();
              };
            }
          }),
          new Promise((_, reject) => {
            apiReadyTimeoutId = window.setTimeout(() => {
              apiReadyTimeoutId = null;
              reject(new Error('YouTube API timeout'));
            }, 8000);
          }),
        ]);
        if (apiReadyTimeoutId) window.clearTimeout(apiReadyTimeoutId);
        apiReadyTimeoutId = null;
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = '';
        const el = document.createElement('div');
        el.style.width = '100%';
        el.style.height = '100%';
        hostRef.current.appendChild(el);
        const player = new window.YT.Player(el, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            rel: 0,
            modestbranding: 1,
            enablejsapi: 1,
            origin: window.location.origin,
            playsinline: 1,
          },
          events: {
            onReady: (e) => {
              clearLoadTimeout();
              setLoading(false);
              setLoadFailed(false);
              if (startAt > 0) {
                try {
                  e.target.seekTo(startAt, true);
                } catch {
                  /* ignore */
                }
              }
            },
            onStateChange: (e) => {
              if (
                e.data === window.YT.PlayerState.PAUSED ||
                e.data === window.YT.PlayerState.ENDED
              ) {
                try {
                  flush(e.target.getCurrentTime(), e.target.getDuration(), { force: true });
                } catch {
                  /* ignore */
                }
              }
            },
            onError: () => {
              clearLoadTimeout();
              setLoading(false);
              setLoadFailed(true);
            },
          },
        });
        playerRef.current = player;
        pollId = window.setInterval(() => {
          try {
            if (player.getPlayerState?.() === window.YT.PlayerState.PLAYING) {
              flush(player.getCurrentTime(), player.getDuration());
            }
          } catch {
            /* ignore */
          }
        }, 15000);
      } catch {
        if (apiReadyTimeoutId) window.clearTimeout(apiReadyTimeoutId);
        apiReadyTimeoutId = null;
        clearLoadTimeout();
        setLoading(false);
        if (!cancelled) setLoadFailed(true);
      }
    };

    const setupVimeo = async () => {
      if (!videoId || !hostRef.current) return;
      setLoading(true);
      try {
        await loadScript('https://player.vimeo.com/api/player.js', 'Vimeo');
        if (cancelled || !hostRef.current || !window.Vimeo?.Player) {
          setLoading(false);
          return;
        }
        hostRef.current.innerHTML = '';
        const iframe = document.createElement('iframe');
        iframe.src = `https://player.vimeo.com/video/${encodeURIComponent(videoId)}`;
        iframe.className = 'absolute inset-0 h-full w-full border-0';
        iframe.allow = 'autoplay; fullscreen; picture-in-picture';
        iframe.allowFullscreen = true;
        iframe.title = title;
        hostRef.current.appendChild(iframe);
        const player = new window.Vimeo.Player(iframe);
        playerRef.current = player;
        await player.ready();
        if (startAt > 0) {
          try {
            await player.setCurrentTime(startAt);
          } catch {
            /* ignore */
          }
        }
        clearLoadTimeout();
        setLoading(false);
        const tick = async (force = false) => {
          try {
            const [pos, dur] = await Promise.all([player.getCurrentTime(), player.getDuration()]);
            flush(pos, dur, { force });
          } catch {
            /* ignore */
          }
        };
        player.on('pause', () => void tick(true));
        player.on('ended', () => void tick(true));
        pollId = window.setInterval(() => void tick(false), 15000);
      } catch {
        clearLoadTimeout();
        setLoading(false);
        if (!cancelled) setLoadFailed(true);
      }
    };

    if (kind === 'youtube' && videoId) void setupYoutube();
    else if (kind === 'vimeo' && videoId) void setupVimeo();
    else setLoading(false);

    const onUnload = () => {
      try {
        const p = playerRef.current;
        if (kind === 'youtube' && p?.getCurrentTime) {
          flush(p.getCurrentTime(), p.getDuration?.(), { force: true });
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pagehide', onUnload);

    return () => {
      cancelled = true;
      clearLoadTimeout();
      if (apiReadyTimeoutId) window.clearTimeout(apiReadyTimeoutId);
      window.removeEventListener('pagehide', onUnload);
      if (pollId) window.clearInterval(pollId);
      try {
        const p = playerRef.current;
        if (kind === 'youtube' && p?.getCurrentTime) {
          flush(p.getCurrentTime(), p.getDuration?.(), { force: true });
          p.destroy?.();
        } else if (kind === 'vimeo' && p?.getCurrentTime) {
          void p.getCurrentTime().then((pos) =>
            p.getDuration().then((dur) => flush(pos, dur, { force: true }))
          );
          p.unload?.();
        }
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [lesson?.id, kind, videoId, title]);

  if (!lesson) return null;

  if (kind === 'pdf') {
    const pdfSrc = contentUrl || embedUrl;
    const canEmbed = Boolean(pdfSrc) && lmsPdfCanEmbed(pdfSrc, pageOrigin);
    return (
      <div className={cn(className)}>
        <PlayerChrome
          title={title}
          kindLabel={kindLabel}
          resumeLabel={null}
          loading={false}
          loadingLabel={loadingLabel}
          loadErrorLabel={null}
          onClose={onClose}
          closeLabel={closeLabel}
        >
          {canEmbed ? (
            <div className="h-[min(75vh,720px)] w-full bg-canvas">
              <iframe title={title} src={pdfSrc} className="h-full w-full border-0" />
            </div>
          ) : (
            <div className="flex min-h-[240px] flex-col items-center justify-center gap-4 bg-canvas px-4 py-10 text-center">
              <EmptyState
                message={pdfExternalHint || 'Open the PDF in a new tab to read this lesson.'}
                className="w-full max-w-md border-0 bg-transparent py-0"
              />
              {pdfSrc ? (
                <a
                  href={pdfSrc}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(S.btnPrimary, 'min-h-touch no-underline')}
                >
                  {openLabel || 'Open material'}
                </a>
              ) : null}
            </div>
          )}
        </PlayerChrome>
      </div>
    );
  }

  if ((kind === 'youtube' || kind === 'vimeo') && videoId) {
    return (
      <div className={cn(className)}>
        <PlayerChrome
          title={title}
          kindLabel={kindLabel}
          resumeLabel={showResumeChip ? resumeLabel : null}
          loading={loading}
          loadingLabel={loadingLabel}
          loadErrorLabel={loadFailed ? loadErrorLabel : null}
          fallbackHref={embedUrl || (kind === 'youtube'
            ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
            : `https://vimeo.com/${encodeURIComponent(videoId)}`)}
          openLabel={openLabel}
          onClose={onClose}
          closeLabel={closeLabel}
        >
          <div className="relative aspect-video w-full bg-ink/90" ref={hostRef} />
        </PlayerChrome>
      </div>
    );
  }

  if (embedUrl) {
    return (
      <div className={cn('overflow-hidden rounded-card border border-ink/12', className)}>
        <div className="aspect-video w-full bg-ink/90">
          <iframe title={title} src={embedUrl} className="h-full w-full border-0" allowFullScreen />
        </div>
      </div>
    );
  }

  return null;
}
