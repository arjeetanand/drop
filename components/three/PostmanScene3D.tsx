'use client';

import { useRef, useState, Suspense, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Postman3D } from '@/components/three/Models';

function SceneContent({ onComplete }: { onComplete?: () => void }) {
  const [progress, setProgress] = useState(0);
  const completeRef = useRef(false);

  useEffect(() => {
    let raf: number;
    const start = performance.now();
    const duration = 3500;
    const animate = (t: number) => {
      const elapsed = t - start;
      const p = Math.min(elapsed / duration, 1);
      setProgress(p);
      if (p < 1) {
        raf = requestAnimationFrame(animate);
      } else if (!completeRef.current) {
        completeRef.current = true;
        onComplete?.();
      }
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [onComplete]);

  return (
    <>
      <ambientLight intensity={0.7} color="#FFF4E6" />
      <directionalLight position={[3, 5, 3]} intensity={1.0} color="#FFE8C0" castShadow />
      <directionalLight position={[-2, 3, -1]} intensity={0.2} color="#A8D5E8" />

      {/* Ground — a winding path */}
      <mesh position={[0, -1.5, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[16, 10]} />
        <meshStandardMaterial color="#E8DCC8" roughness={0.9} />
      </mesh>
      {/* Path stripe */}
      <mesh position={[0, -1.49, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12, 1.2]} />
        <meshStandardMaterial color="#D4CFC6" roughness={0.85} />
      </mesh>

      {/* Small trees as silhouettes */}
      <mesh position={[-2, -0.8, 1.5]} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 0.8, 8]} />
        <meshStandardMaterial color="#6B4226" roughness={0.8} />
      </mesh>
      <mesh position={[-2, -0.2, 1.5]} castShadow>
        <coneGeometry args={[0.35, 0.7, 8]} />
        <meshStandardMaterial color="#7DAA6B" roughness={0.8} />
      </mesh>

      <mesh position={[2.5, -0.9, -1.5]} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 0.8, 8]} />
        <meshStandardMaterial color="#6B4226" roughness={0.8} />
      </mesh>
      <mesh position={[2.5, -0.3, -1.5]} castShadow>
        <coneGeometry args={[0.3, 0.6, 8]} />
        <meshStandardMaterial color="#7DAA6B" roughness={0.8} />
      </mesh>

      {/* Postman riding across */}
      <Postman3D progress={progress} />
    </>
  );
}

export function PostmanScene3D({ onComplete }: { onComplete?: () => void }) {
  return (
    <div className="scene3d-container scene-light-bg">
      <Canvas
        shadows
        camera={{ position: [0, 1.8, 6], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <SceneContent onComplete={onComplete} />
        </Suspense>
      </Canvas>
    </div>
  );
}
