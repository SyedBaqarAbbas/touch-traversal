"use client";

import { PerspectiveCamera } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { selectNodeSummaries, type GraphModel } from "@/lib/graph-model";
import {
  buildSceneEdges,
  buildSceneNodes,
  cameraModes,
  getCameraPose,
  type CameraMode,
  type SceneEdge,
  type SceneNode,
} from "@/lib/scene-model";

const routes = [
  { href: "/", label: "home" },
  { href: "/demo", label: "demo" },
  { href: "/calibration", label: "calibration" },
  { href: "/debug", label: "debug" },
] as const;

export function GraphScene({ model }: { model: GraphModel }) {
  const nodeSummaries = useMemo(() => selectNodeSummaries(model), [model]);
  const [cameraMode, setCameraMode] = useState<CameraMode>("overview");
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    () => nodeSummaries[0]?.id ?? null,
  );
  const sceneNodes = useMemo(
    () =>
      buildSceneNodes(model, "semantic", {
        hoverNodeId,
        selectedNodeId,
      }),
    [hoverNodeId, model, selectedNodeId],
  );
  const sceneEdges = useMemo(
    () =>
      buildSceneEdges(model, "semantic", {
        hoverNodeId,
        selectedNodeId,
      }),
    [hoverNodeId, model, selectedNodeId],
  );

  return (
    <main className="scene-shell">
      <Canvas
        className="scene-canvas"
        dpr={[1, 1.75]}
        gl={{
          alpha: false,
          antialias: true,
          powerPreference: "high-performance",
        }}
      >
        <color attach="background" args={["#050505"]} />
        <CameraRig mode={cameraMode} />
        <RelationshipEdgeInstances edges={sceneEdges} />
        <ThoughtNodeInstances halo nodes={sceneNodes} />
        <ThoughtNodeInstances nodes={sceneNodes} />
      </Canvas>

      <header className="scene-header">
        <Link className="wordmark" href="/">
          touch traversal
        </Link>
        <p className="mode-label">mode / {cameraMode}</p>
      </header>

      <section className="scene-overlay" aria-labelledby="scene-title">
        <p className="eyebrow">demo</p>
        <h1 id="scene-title">Graph artifact boundary</h1>
        <p className="description">
          {model.graph.order} thoughts and {model.graph.size} relationships
          rendered as shared-buffer geometry from the semantic layout.
        </p>

        <div className="scene-controls" aria-label="Camera modes">
          {cameraModes.map((mode) => (
            <button
              aria-pressed={cameraMode === mode}
              key={mode}
              onClick={() => setCameraMode(mode)}
              type="button"
            >
              {mode}
            </button>
          ))}
        </div>
      </section>

      <aside className="scene-node-list" aria-label="Thought nodes">
        {nodeSummaries.slice(0, 5).map((node) => (
          <button
            aria-pressed={selectedNodeId === node.id}
            key={node.id}
            onClick={() => setSelectedNodeId(node.id)}
            onPointerEnter={() => setHoverNodeId(node.id)}
            onPointerLeave={() => setHoverNodeId(null)}
            type="button"
          >
            <span>{node.title}</span>
            <small>degree {node.degree}</small>
          </button>
        ))}
      </aside>

      <nav className="route-shell__nav scene-nav" aria-label="Prototype routes">
        {routes.map((route) => (
          <Link href={route.href} key={route.href}>
            {route.label}
          </Link>
        ))}
      </nav>
    </main>
  );
}

function CameraRig({ mode }: { mode: CameraMode }) {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const target = useRef(new THREE.Vector3());
  const overview = getCameraPose("overview");

  useFrame((_state, delta) => {
    const camera = cameraRef.current;
    if (!camera) {
      return;
    }

    const pose = getCameraPose(mode);
    const alpha = 1 - Math.exp(-delta * 3.2);
    camera.position.lerp(new THREE.Vector3(...pose.position), alpha);
    target.current.lerp(new THREE.Vector3(...pose.target), alpha);
    camera.lookAt(target.current);
    camera.fov = THREE.MathUtils.lerp(camera.fov, pose.fov, alpha);
    camera.updateProjectionMatrix();
  });

  return (
    <PerspectiveCamera
      fov={overview.fov}
      makeDefault
      position={overview.position}
      ref={cameraRef}
    />
  );
}

function RelationshipEdgeInstances({ edges }: { edges: SceneEdge[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const scratch = useMemo(() => new THREE.Object3D(), []);
  const material = useMemo(() => createEdgeMaterial(), []);
  const axis = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const midpoint = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    const opacity = new Float32Array(edges.length);
    const typeBand = new Float32Array(edges.length);
    const selected = new Float32Array(edges.length);
    const visibility = new Float32Array(edges.length);

    edges.forEach((edge, index) => {
      const source = new THREE.Vector3(...edge.sourcePosition);
      const target = new THREE.Vector3(...edge.targetPosition);
      direction.copy(target).sub(source);
      const length = direction.length();
      midpoint.copy(source).add(target).multiplyScalar(0.5);

      scratch.position.copy(midpoint);
      scratch.quaternion.setFromUnitVectors(axis, direction.normalize());
      scratch.scale.set(edge.width, length, edge.width);
      scratch.updateMatrix();
      mesh.setMatrixAt(index, scratch.matrix);

      opacity[index] = edge.opacity;
      typeBand[index] = edge.typeBand;
      selected[index] = edge.selected;
      visibility[index] = edge.visible;
    });

    mesh.count = edges.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.setAttribute(
      "edgeOpacity",
      new THREE.InstancedBufferAttribute(opacity, 1),
    );
    mesh.geometry.setAttribute(
      "edgeTypeBand",
      new THREE.InstancedBufferAttribute(typeBand, 1),
    );
    mesh.geometry.setAttribute(
      "edgeSelected",
      new THREE.InstancedBufferAttribute(selected, 1),
    );
    mesh.geometry.setAttribute(
      "edgeVisibility",
      new THREE.InstancedBufferAttribute(visibility, 1),
    );
  }, [axis, direction, edges, midpoint, scratch]);

  return (
    <instancedMesh
      args={[
        undefined as unknown as THREE.BufferGeometry,
        undefined as unknown as THREE.Material,
        Math.max(edges.length, 1),
      ]}
      frustumCulled={false}
      ref={meshRef}
    >
      <cylinderGeometry args={[1, 1, 1, 6, 1, true]} />
      <primitive attach="material" object={material} />
    </instancedMesh>
  );
}

function ThoughtNodeInstances({
  halo = false,
  nodes,
}: {
  halo?: boolean;
  nodes: SceneNode[];
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const scratch = useMemo(() => new THREE.Object3D(), []);
  const material = useMemo(() => createNodeMaterial(halo), [halo]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    const opacity = new Float32Array(nodes.length);
    const cluster = new Float32Array(nodes.length);
    const hover = new Float32Array(nodes.length);
    const selected = new Float32Array(nodes.length);
    const visibility = new Float32Array(nodes.length);

    nodes.forEach((node, index) => {
      const stateScale = 1 + node.hovered * 0.22 + node.selected * 0.36;
      scratch.position.set(...node.position);
      scratch.scale.setScalar(node.scale * stateScale * (halo ? 3.8 : 1));
      scratch.updateMatrix();
      mesh.setMatrixAt(index, scratch.matrix);
      opacity[index] = node.opacity;
      cluster[index] = node.cluster;
      hover[index] = node.hovered;
      selected[index] = node.selected;
      visibility[index] = node.visible;
    });

    mesh.count = nodes.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.setAttribute(
      "instanceOpacity",
      new THREE.InstancedBufferAttribute(opacity, 1),
    );
    mesh.geometry.setAttribute(
      "instanceCluster",
      new THREE.InstancedBufferAttribute(cluster, 1),
    );
    mesh.geometry.setAttribute(
      "instanceHover",
      new THREE.InstancedBufferAttribute(hover, 1),
    );
    mesh.geometry.setAttribute(
      "instanceSelected",
      new THREE.InstancedBufferAttribute(selected, 1),
    );
    mesh.geometry.setAttribute(
      "instanceVisibility",
      new THREE.InstancedBufferAttribute(visibility, 1),
    );
  }, [halo, nodes, scratch]);

  return (
    <instancedMesh
      args={[
        undefined as unknown as THREE.BufferGeometry,
        undefined as unknown as THREE.Material,
        Math.max(nodes.length, 1),
      ]}
      frustumCulled={false}
      ref={meshRef}
    >
      <sphereGeometry args={[1, halo ? 10 : 14, halo ? 6 : 8]} />
      <primitive attach="material" object={material} />
    </instancedMesh>
  );
}

function createNodeMaterial(halo: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: true,
    depthWrite: !halo,
    fragmentShader: nodeFragmentShader,
    transparent: true,
    uniforms: {
      uHalo: { value: halo ? 1 : 0 },
    },
    vertexShader: nodeVertexShader,
  });
}

function createEdgeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthTest: true,
    depthWrite: false,
    fragmentShader: edgeFragmentShader,
    transparent: true,
    vertexShader: edgeVertexShader,
  });
}

const edgeVertexShader = `
attribute float edgeOpacity;
attribute float edgeTypeBand;
attribute float edgeSelected;
attribute float edgeVisibility;

varying float vOpacity;
varying vec3 vColor;

void main() {
  vec3 base = vec3(0.82, 0.80, 0.75);
  vec3 cool = vec3(0.56, 0.64, 0.68);
  vec3 warm = vec3(0.92, 0.78, 0.56);
  vec3 dim = vec3(0.48, 0.48, 0.45);

  vColor = base;
  vColor = mix(vColor, dim, step(0.5, edgeTypeBand));
  vColor = mix(vColor, cool, step(1.5, edgeTypeBand));
  vColor = mix(vColor, warm, step(2.5, edgeTypeBand) * 0.45);
  vColor = mix(vColor, vec3(0.96, 0.94, 0.88), edgeSelected * 0.35);
  vOpacity = edgeOpacity * edgeVisibility;

  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const edgeFragmentShader = `
varying float vOpacity;
varying vec3 vColor;

void main() {
  gl_FragColor = vec4(vColor, vOpacity);
}
`;

const nodeVertexShader = `
attribute float instanceOpacity;
attribute float instanceCluster;
attribute float instanceHover;
attribute float instanceSelected;
attribute float instanceVisibility;

uniform float uHalo;

varying float vOpacity;
varying vec3 vColor;

void main() {
  float emphasis = max(instanceHover * 0.2, instanceSelected * 0.36);
  float haloScale = mix(1.0, 0.22, uHalo);
  vOpacity = clamp(instanceOpacity * instanceVisibility * haloScale * (1.0 + emphasis), 0.0, 1.0);

  vec3 base = vec3(0.96, 0.94, 0.88);
  vec3 cool = vec3(0.72, 0.78, 0.82);
  vec3 warm = vec3(1.0, 0.88, 0.68);
  float clusterBand = mod(instanceCluster, 3.0);
  vColor = mix(base, cool, step(0.5, clusterBand));
  vColor = mix(vColor, warm, step(1.5, clusterBand));

  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const nodeFragmentShader = `
varying float vOpacity;
varying vec3 vColor;

void main() {
  gl_FragColor = vec4(vColor, vOpacity);
}
`;
