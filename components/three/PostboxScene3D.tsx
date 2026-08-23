'use client';

import { useRef, useState, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Envelope3D, Postbox3D } from '@/components/three/Models';
import { playInterfaceSound } from '@/lib/interfaceSound';

function FallingEnvelope({ sent }: { sent: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const [done, setDone] = useState(false);

  useFrame(() => {
    if (!ref.current) return;
    if (sent && !done) {
      const target = -0.3;
      ref.current.position.y = THREE.MathUtils.lerp(ref.current.position.y, target, 0.08);
      ref.current.rotation.z = THREE.MathUtils.lerp(ref.current.rotation.z, 0.15, 0.08);
      if (ref.current.position.y < -0.25) {
        ref.current.visible = false;
        setDone(true);
      }
    }
  });

  return (
    <group ref={ref} position={[0, 1.8, 0.6]} rotation={[0.2, 0, -0.1]}>
      <Envelope3D scale={0.55} flapOpen={0} />
    </group>
  );
}

function SceneContent({ onPosted }: { onPosted?: () => void }) {
  const [sent, setSent] = useState(false);
  const [shaking, setShaking] = useState(false);
  const postedRef = useRef(false);

  const handleSend = () => {
    if (sent) return;
    setSent(true);
    playInterfaceSound('send');
    setTimeout(() => setShaking(true), 1200);
    setTimeout(() => {
      setShaking(false);
      if (!postedRef.current) {
        postedRef.current = true;
        onPosted?.();
      }
    }, 2000);
  };

  return (
    <>
      <ambientLight intensity={0.65} color="#FFF4E6" />
      <directionalLight position={[3, 5, 3]} intensity={1.0} color="#FFE8C0" castShadow />
      <directionalLight position={[-2, 3, -2]} intensity={0.25} color="#A8D5E8" />
      <pointLight position={[0, 2, 4]} intensity={0.15} color="#E8A838" />

      {/* Ground */}
      <mesh position={[0, -1.6, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[14, 10]} />
        <meshStandardMaterial color="#E8DCC8" roughness={0.9} />
      </mesh>

      {/* Postbox */}
      <group position={[0, -0.6, 0]}>
        <Postbox3D shaking={shaking} />
      </group>

      {/* Envelope falling into slot */}
      <FallingEnvelope sent={sent} />

      {/* Invisible click target */}
      <mesh position={[0, 0, 0]} onClick={handleSend} visible={false}>
        <boxGeometry args={[10, 10, 10]} />
        <meshBasicMaterial />
      </mesh>
    </>
  );
}

export function PostboxScene3D({ onPosted }: { onPosted?: () => void }) {
  return (
    <div className="scene3d-container scene-light-bg">
      <Canvas
        shadows
        camera={{ position: [0, 1.5, 5], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <SceneContent onPosted={onPosted} />
        </Suspense>
      </Canvas>
    </div>
  );
}
