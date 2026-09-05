import * as THREE from 'three';
import type { Material } from '@/lib/model/project';

/** Deterministic pseudo random for stable textures. */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** Procedural top-surface texture for a material; one texture tile represents `tileMm` millimetres. */
export function makeTexture(material: Material, size = 512): { texture: THREE.CanvasTexture; tileMm: number; color: string; metalness: number; roughness: number } {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d')!;
  const rand = rng(42);
  let tileMm = 200, color = '#ffffff', metalness = 0, roughness = 0.85;
  const noise = (base: string, amount: number, n = 20000) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < n; i++) { const v = Math.floor((rand() - 0.5) * amount); ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`; ctx.fillRect(rand() * size, rand() * size, 2, 2); }
  };
  switch (material) {
    case 'mdf': noise('#c9a97a', 40, 30000); break;
    case 'osb': {
      ctx.fillStyle = '#c8a870'; ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 260; i++) {
        ctx.save(); ctx.translate(rand() * size, rand() * size); ctx.rotate(rand() * Math.PI);
        const w = 30 + rand() * 90, h = 10 + rand() * 25; const l = 60 + Math.floor(rand() * 60);
        ctx.fillStyle = `hsl(${32 + rand() * 12}, ${40 + rand() * 25}%, ${l}%)`; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore();
      }
      break;
    }
    case 'plywood': case 'wood': {
      tileMm = 300; ctx.fillStyle = material === 'wood' ? '#d2a76a' : '#e3c48f'; ctx.fillRect(0, 0, size, size);
      for (let y = 0; y < size; y += 3) {
        const wobble = Math.sin(y * 0.02) * 12 + Math.sin(y * 0.11) * 4;
        ctx.strokeStyle = `rgba(90,50,20,${0.05 + rand() * 0.12})`; ctx.lineWidth = 1 + rand() * 2;
        ctx.beginPath(); ctx.moveTo(0, y); for (let x = 0; x <= size; x += 32) ctx.lineTo(x, y + wobble * Math.sin(x * 0.01 + y)); ctx.stroke();
      }
      for (let k = 0; k < 4; k++) { ctx.fillStyle = 'rgba(70,40,15,0.25)'; ctx.beginPath(); ctx.ellipse(rand() * size, rand() * size, 8 + rand() * 10, 4 + rand() * 6, rand(), 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'aluminium': noise('#b9bec4', 24, 40000); color = '#d9dde2'; metalness = 0.85; roughness = 0.35; break;
    case 'acrylic': ctx.fillStyle = '#dbeeff'; ctx.fillRect(0, 0, size, size); roughness = 0.15; break;
    default: noise('#cfd3d8', 16, 15000);
  }
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, tileMm, color, metalness, roughness };
}

/** Side texture: plywood shows its layered edge, everything else reuses the top look slightly darker. */
export function makeSideTexture(material: Material, thickness: number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  if (material === 'plywood') {
    const layers = Math.max(3, Math.round(thickness / 1.6)) | 1;
    for (let i = 0; i < layers; i++) { ctx.fillStyle = i % 2 ? '#c69a5c' : '#e6cc98'; ctx.fillRect(0, (i * 64) / layers, 256, 64 / layers + 1); }
  } else if (material === 'osb') { ctx.fillStyle = '#b08d58'; ctx.fillRect(0, 0, 256, 64); }
  else if (material === 'mdf') { ctx.fillStyle = '#b8955f'; ctx.fillRect(0, 0, 256, 64); }
  else if (material === 'aluminium') { ctx.fillStyle = '#aeb3b9'; ctx.fillRect(0, 0, 256, 64); }
  else if (material === 'acrylic') { ctx.fillStyle = '#cfe6ff'; ctx.fillRect(0, 0, 256, 64); }
  else if (material === 'wood') { ctx.fillStyle = '#b8874e'; ctx.fillRect(0, 0, 256, 64); }
  else { ctx.fillStyle = '#b4b9bf'; ctx.fillRect(0, 0, 256, 64); }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
