'use client';

import { useRef, useState, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { Envelope3D, WaxStamp3D } from '@/components/three/Models';
import { playInterfaceSound } from '@/lib/interfaceSound';

function SceneContent({ onPressed }: { onPressed?: () => void }) {
  const [pressing, setPressing] = useState(false);
  const [pressed, setPressed] = useState(false);
  const envelopeRef = useRef<THREE.Group>(null);
  const stampRef = useRef<THREE.Group>(null);

  const handlePress = () => {
    if (pressed) return;
    setPressing(true);
    playInterfaceSound('seal');
    setTimeout(() => {
      setPressing(false);
      setPressed(true);
      onPressed?.();
    }, 1400);
  };

  return (
    <>
      {/* Lighting: warm, bright, nostalgic */}
      <ambientLight intensity={0.6} color="#FFF4E6" />
      <directionalLight position={[3, 5, 3]} intensity={1.1} color="#FFE8C0" castShadow />
      <directionalLight position={[-2, 3, -2]} intensity={0.3} color="#A8D5E8" />
      <pointLight position={[0, -2, 3]} intensity={0.2} color="#E8A838" />

      {/* Desk surface */}
      <mesh position={[0, -0.8, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12, 8]} />
        <meshStandardMaterial color="#EDE5D5" roughness={0.9} />
      </mesh>

      {/* Envelope on desk */}
      <group ref={envelopeRef} position={[0, -0.4, 0]} rotation={[-0.15, 0.2, 0]}>
        <Envelope3D scale={1.2} flapOpen={0} waxColor={pressed ? '#C0392B' : '#D07060'} />
      </group>

      {/* Wax stamp hovering above */}
      <group ref={stampRef} position={[0, 1.5, 0.3]} rotation={[-0.1, 0, 0]}>
        <WaxStamp3D pressing={pressing} />
      </group>

      {/* Click target (invisible) */}
      <mesh
        position={[0, 0, 0]}
        onClick={handlePress}
        visible={false}
      >
        <boxGeometry args={[10, 10, 10]} />
        <meshBasicMaterial />
      </mesh>
    </>
  );
}

export function WaxSealScene3D({ onPressed }: { onPressed?: () => void }) {
  return (
    <div className="scene3d-container scene-warm-bg">
      <Canvas
        shadows
        camera={{ position: [0, 1.5, 4.5], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <SceneContent onPressed={onPressed} />
        </Suspense>
      </Canvas>
    </div>
  );
}
