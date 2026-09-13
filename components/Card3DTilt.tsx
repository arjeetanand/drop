'use client';

import React, { useRef, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface Card3DTiltProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  maxTilt?: number;      // Maximum tilt angle in degrees (default: 8)
  glareOpacity?: number; // Opacity of the cursor-following reflection (default: 0.15)
  scaleOnHover?: number; // Scale factor on hover (default: 1.02)
}

/**
 * Open-source 3D interactive card tilt component.
 * Inspired by Atropos.js and Aceternity 3D Card.
 * Tracks cursor position to apply dynamic 3D perspective rotation and specular glare.
 */
export function Card3DTilt({
  children,
  className,
  maxTilt = 8,
  glareOpacity = 0.15,
  scaleOnHover = 1.015,
  ...props
}: Card3DTiltProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [transformStyle, setTransformStyle] = useState({
    rotateX: 0,
    rotateY: 0,
    scale: 1,
  });
  const [glarePos, setGlarePos] = useState({ x: 50, y: 50, active: false });

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!cardRef.current) return;
      const rect = cardRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Normalize between -1 and 1
      const normX = (x / rect.width) * 2 - 1;
      const normY = (y / rect.height) * 2 - 1;

      // Invert Y for standard natural 3D tilt
      const rotateX = -normY * maxTilt;
      const rotateY = normX * maxTilt;

      setTransformStyle({
        rotateX,
        rotateY,
        scale: scaleOnHover,
      });

      setGlarePos({
        x: (x / rect.width) * 100,
        y: (y / rect.height) * 100,
        active: true,
      });
    },
    [maxTilt, scaleOnHover]
  );

  const handleMouseLeave = useCallback(() => {
    setTransformStyle({ rotateX: 0, rotateY: 0, scale: 1 });
    setGlarePos((prev) => ({ ...prev, active: false }));
  }, []);

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn('relative transition-all duration-200 ease-out', className)}
      style={{
        perspective: '1200px',
        transformStyle: 'preserve-3d',
      }}
      {...props}
    >
      <div
        className="w-full h-full rounded-2xl relative transition-transform duration-200 ease-out"
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateX(${transformStyle.rotateX.toFixed(2)}deg) rotateY(${transformStyle.rotateY.toFixed(2)}deg) scale3d(${transformStyle.scale}, ${transformStyle.scale}, 1)`,
        }}
      >
        {children}

        {/* Dynamic Specular Glare Overlay */}
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-300"
          style={{
            opacity: glarePos.active ? 1 : 0,
            background: `radial-gradient(circle at ${glarePos.x}% ${glarePos.y}%, rgba(255, 255, 255, ${glareOpacity}) 0%, rgba(255, 255, 255, 0) 65%)`,
            mixBlendMode: 'overlay',
          }}
        />
      </div>
    </div>
  );
}
