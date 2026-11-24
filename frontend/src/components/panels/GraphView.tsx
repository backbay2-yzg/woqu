import React, { useEffect, useRef, useState } from 'react';
import { Network, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { GraphData, GraphNode } from '@/types';

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphViewProps {
  onNavigatePage: (pageId: string) => void;
  onClose: () => void;
}

export const GraphView: React.FC<GraphViewProps> = ({ onNavigatePage, onClose }) => {
  const theme = useAppStore((s) => s.theme);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [filterText, setFilterText] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const simNodesRef = useRef<SimNode[]>([]);
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const dragNodeRef = useRef<SimNode | null>(null);
  const panningRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    api.getGraph().then(setGraph).catch(() => {});
  }, []);

  useEffect(() => {
    const q = filterText.trim().toLowerCase();
    const filteredNodes = graph.nodes.filter(
      (n) =>
        !q ||
        n.title.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)),
    );
    const allowed = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = graph.edges.filter((e) => allowed.has(e.source) && allowed.has(e.target));

    const prevPos = new Map(simNodesRef.current.map((n) => [n.id, { x: n.x, y: n.y }]));
    const simNodes: SimNode[] = filteredNodes.map((n, idx) => {
      const old = prevPos.get(n.id);
      const angle = (idx / Math.max(filteredNodes.length, 1)) * Math.PI * 2;
      const radius = 140 + (idx % 3) * 45;
      return {
        ...n,
        x: old?.x ?? Math.cos(angle) * radius,
        y: old?.y ?? Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      };
    });
    simNodesRef.current = simNodes;

    let animId = 0;
    const step = () => {
      const nodes = simNodesRef.current;
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      // Force simulation
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        // Center pull
        a.vx += -a.x * 0.002;
        a.vy += -a.y * 0.002;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = b.x - a.x || 0.1;
          const dy = b.y - a.y || 0.1;
          const dist2 = Math.max(dx * dx + dy * dy, 250);
          const rep = 1400 / dist2;
          const dist = Math.sqrt(dist2);
          const fx = (dx / dist) * rep;
          const fy = (dy / dist) * rep;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      for (const e of filteredEdges) {
        const src = nodeMap.get(e.source);
        const dst = nodeMap.get(e.target);
        if (!src || !dst) continue;
        const dx = dst.x - src.x;
        const dy = dst.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetDist = 110;
        const force = (dist - targetDist) * 0.015;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        src.vx += fx;
        src.vy += fy;
        dst.vx -= fx;
        dst.vy -= fy;
      }

      for (const n of nodes) {
        if (dragNodeRef.current?.id === n.id) continue;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
      }

      draw(nodes, filteredEdges);
      animId = requestAnimationFrame(step);
    };

    const draw = (nodes: SimNode[], edges: typeof filteredEdges) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const isDark = theme === 'dark';
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const { x: tx, y: ty, k } = transformRef.current;
      ctx.translate(rect.width / 2 + tx, rect.height / 2 + ty);
      ctx.scale(k, k);

      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const activeNeighbors = new Set<string>();
      if (hoveredId) {
        activeNeighbors.add(hoveredId);
        for (const e of edges) {
          if (e.source === hoveredId) activeNeighbors.add(e.target);
          if (e.target === hoveredId) activeNeighbors.add(e.source);
        }
      }

      // Draw edges
      for (const e of edges) {
        const s = nodeMap.get(e.source);
        const t = nodeMap.get(e.target);
        if (!s || !t) continue;
        const highlighted = hoveredId && (e.source === hoveredId || e.target === hoveredId);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.strokeStyle = highlighted
          ? '#3b82f6'
          : isDark
            ? 'rgba(255,255,255,0.12)'
            : 'rgba(15,23,42,0.14)';
        ctx.lineWidth = highlighted ? 2 : 1;
        ctx.stroke();
      }

      // Draw nodes
      for (const n of nodes) {
        const radius = Math.min(18, 7 + n.link_count * 2);
        const dimmed = hoveredId && !activeNeighbors.has(n.id);
        ctx.globalAlpha = dimmed ? 0.25 : 1;

        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = n.is_database
          ? '#10b981'
          : hoveredId === n.id
            ? '#2563eb'
            : '#6366f1';
        ctx.fill();

        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = isDark ? '#e6e6e4' : '#1f2329';
        ctx.fillText(`${n.icon ? n.icon + ' ' : ''}${n.title}`, n.x, n.y + radius + 14);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    };

    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [graph, filterText, hoveredId, theme]);

  const screenToWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { wx: 0, wy: 0 };
    const rect = canvas.getBoundingClientRect();
    const { x, y, k } = transformRef.current;
    return {
      wx: (clientX - rect.left - rect.width / 2 - x) / k,
      wy: (clientY - rect.top - rect.height / 2 - y) / k,
    };
  };

  const hitTest = (wx: number, wy: number): SimNode | null => {
    for (const n of simNodesRef.current) {
      const r = Math.min(20, 10 + n.link_count * 2);
      const dx = n.x - wx;
      const dy = n.y - wy;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50/50 dark:bg-[#191919] relative">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#202020]">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Network className="w-4 h-4 text-purple-600" />
          <span>双向链接知识图谱</span>
          <span className="text-xs font-normal text-slate-400">
            ({graph.nodes.length} 节点 · {graph.edges.length} 关联)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="按标题或标签过滤..."
              className="pl-8 pr-3 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-transparent text-xs outline-none"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          onMouseDown={(e) => {
            const { wx, wy } = screenToWorld(e.clientX, e.clientY);
            const hit = hitTest(wx, wy);
            if (hit) {
              dragNodeRef.current = hit;
            } else {
              panningRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                origX: transformRef.current.x,
                origY: transformRef.current.y,
              };
            }
          }}
          onMouseMove={(e) => {
            const { wx, wy } = screenToWorld(e.clientX, e.clientY);
            if (dragNodeRef.current) {
              dragNodeRef.current.x = wx;
              dragNodeRef.current.y = wy;
              dragNodeRef.current.vx = 0;
              dragNodeRef.current.vy = 0;
            } else if (panningRef.current) {
              transformRef.current.x = panningRef.current.origX + (e.clientX - panningRef.current.startX);
              transformRef.current.y = panningRef.current.origY + (e.clientY - panningRef.current.startY);
            } else {
              const hit = hitTest(wx, wy);
              setHoveredId(hit?.id || null);
            }
          }}
          onMouseUp={(e) => {
            if (dragNodeRef.current && Math.abs(e.movementX) < 2 && Math.abs(e.movementY) < 2) {
              onNavigatePage(dragNodeRef.current.id);
            }
            dragNodeRef.current = null;
            panningRef.current = null;
          }}
          onDoubleClick={(e) => {
            const { wx, wy } = screenToWorld(e.clientX, e.clientY);
            const hit = hitTest(wx, wy);
            if (hit) onNavigatePage(hit.id);
          }}
          onWheel={(e) => {
            const factor = e.deltaY < 0 ? 1.08 : 0.92;
            transformRef.current.k = Math.min(3, Math.max(0.35, transformRef.current.k * factor));
          }}
        />
        <div className="absolute bottom-4 left-4 text-[11px] text-slate-400 bg-white/80 dark:bg-zinc-900/80 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800">
          拖拽节点整理布局 · 滚轮缩放 · 双击或点击节点直达页面
        </div>
      </div>
    </div>
  );
};
