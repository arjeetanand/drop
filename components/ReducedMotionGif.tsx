'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { getReducedMotionFrameSize } from '@/lib/reducedMotionFrame';

interface ReducedMotionGifProps {
  src: string;
  alt: string;
  animated: boolean;
  sizes: string;
  className?: string;
}

type MotionPreference = 'checking' | 'reduce' | 'allow';

/** Render a GIF as a captured first-frame still when the user asks to reduce motion. */
export function ReducedMotionGif({ src, alt, animated, sizes, className }: ReducedMotionGifProps) {
  const [motion, setMotion] = useState<MotionPreference>('checking');
  const [stillSrc, setStillSrc] = useState('');
  const [captureFailed, setCaptureFailed] = useState(false);

  useEffect(() => {
    if (!animated) {
      setMotion('allow');
      return;
    }
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setMotion(query.matches ? 'reduce' : 'allow');
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [animated]);

  useEffect(() => {
    if (!animated || motion !== 'reduce') {
      setStillSrc('');
      setCaptureFailed(false);
      return;
    }

    let active = true;
    setStillSrc('');
    setCaptureFailed(false);
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      if (!active) return;
      try {
        const frameSize = getReducedMotionFrameSize(image.naturalWidth, image.naturalHeight);
        if (!frameSize) throw new Error('Still frame unavailable');
        const canvas = document.createElement('canvas');
        canvas.width = frameSize.width;
        canvas.height = frameSize.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Still frame unavailable');
        context.drawImage(image, 0, 0, frameSize.width, frameSize.height);
        setStillSrc(canvas.toDataURL('image/png'));
      } catch {
        // Never fall back to animated media when reduced motion is requested.
        setCaptureFailed(true);
      }
    };
    image.onerror = () => { if (active) setCaptureFailed(true); };
    image.src = src;

    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [animated, motion, src]);

  if (!animated || motion === 'allow') {
    return <Image src={src} alt={alt} fill unoptimized sizes={sizes} className={className} />;
  }

  if (motion === 'reduce' && stillSrc) {
    return <Image src={stillSrc} alt={alt} fill unoptimized sizes={sizes} className={className} />;
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center bg-[#ede8df] px-6 text-center text-sm text-on-surface-variant"
      role="img"
      aria-label={`${alt}${captureFailed ? ' (still preview unavailable; animation paused)' : ' (preparing still preview)'}`}
    >
      {captureFailed ? 'Still preview unavailable. Animation paused.' : 'Preparing still preview…'}
    </div>
  );
}
