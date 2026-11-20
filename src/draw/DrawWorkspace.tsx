import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Undo2,
  Redo2,
  GitBranch,
  AlertCircle,
  Map as MapIcon,
  Grid,
  ZoomIn,
  ZoomOut,
  Save,
  Download,
  Upload,
} from 'lucide-react';
import { cloneTopology, GIWANGAN_TOPOLOGY, StaticSamplingBlueprint } from '../engine/samplingBlueprints';
import { compileTopology } from '../engine/topologyBuilder';
import { ArmDef, IntersectionTopology, SignalPhasePreset } from '../engine/topologyTypes';
import { DrawCanvas } from './DrawCanvas';
import { DrawInspector } from './DrawInspector';
import { DrawPalette } from './DrawPalette';
import {
  applyModuleToArm,
  deleteSavedTopologyLocal,
  DrawModuleKind,
  isValidTopologyPayload,
  loadSavedTopologies,
  rebuildPhases,
  removeArmFromTopology,
  saveTopologyLocal,
  updateArmInTopology,
  validateTopology,
} from './drawStore';

interface DrawWorkspaceProps {
  initialTopology?: IntersectionTopology;
  onSimulateTopology: (topology: IntersectionTopology) => void;
}

export const DrawWorkspace: React.FC<DrawWorkspaceProps> = ({ initialTopology, onSimulateTopology }) => {
  const [topology, setTopology] = useState<IntersectionTopology>(() =>
    cloneTopology(initialTopology ?? GIWANGAN_TOPOLOGY)
  );
  const [history, setHistory] = useState<IntersectionTopology[]>([]);
  const [future, setFuture] = useState<IntersectionTopology[]>([]);
  const [selectedArmId, setSelectedArmId] = useState<string | null>(() => (initialTopology ?? GIWANGAN_TOPOLOGY).arms[0]?.id ?? null);

  const [showSplines, setShowSplines] = useState(true);
  const [showConflicts, setShowConflicts] = useState(false);
  const [showStaticMap, setShowStaticMap] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [viewportState, setViewportState] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const [savedTopologies, setSavedTopologies] = useState<IntersectionTopology[]>(() => loadSavedTopologies());
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pushTopology = useCallback((next: IntersectionTopology, recordHistory = true) => {
    setTopology((prev) => {
      if (recordHistory) {
        setHistory((h) => [...h.slice(-29), prev]);
        setFuture([]);
      }
      return next;
    });
  }, []);

  const recordDragSnapshot = useCallback(() => {
    setHistory((h) => [...h.slice(-29), topology]);
    setFuture([]);
  }, [topology]);

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setFuture((f) => [topology, ...f]);
    setHistory((h) => h.slice(0, -1));
    setTopology(prev);
  }, [history, topology]);

  const handleRedo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setHistory((h) => [...h, topology]);
    setFuture((f) => f.slice(1));
    setTopology(next);
  }, [future, topology]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  const compiled = useMemo(() => compileTopology(topology), [topology]);
  const validation = useMemo(() => validateTopology(topology), [topology]);

  const handleApplyModule = useCallback(
    (kind: DrawModuleKind, armIdOverride?: string, dropAngleDeg?: number) => {
      const targetArm = armIdOverride ?? selectedArmId ?? topology.arms[0]?.id ?? '';
      const res = applyModuleToArm(topology, targetArm, kind, dropAngleDeg);
      pushTopology(res.topo, true);
      setSelectedArmId(res.selectedArmId);
    },
    [topology, selectedArmId, pushTopology]
  );

  const handleLoadBlueprint = useCallback(
    (bp: StaticSamplingBlueprint) => {
      const cloned = cloneTopology(bp.topology);
      pushTopology(cloned, true);
      setSelectedArmId(cloned.arms[0]?.id ?? null);
      setViewportState({ zoom: 1, pan: { x: 0, y: 0 } });
      setNotice(`Blueprint "${bp.label}" dimuat.`);
      window.setTimeout(() => setNotice(null), 2500);
    },
    [pushTopology]
  );

  const handleArmAngleDrag = useCallback(
    (armId: string, newAngleDeg: number) => {
      setTopology((prev) => updateArmInTopology(prev, armId, { angleDeg: newAngleDeg }));
    },
    []
  );

  const handleArmWidthDrag = useCallback((armId: string, side: 'in' | 'out', avgW: number) => {
    setTopology((prev) => {
      const target = prev.arms.find((a) => a.id === armId);
      if (!target) return prev;
      const count = side === 'in' ? target.inLanes : target.outLanes;
      const widths = Array.from({ length: count }, () => avgW);
      return updateArmInTopology(prev, armId, side === 'in' ? { inLaneWidths: widths } : { outLaneWidths: widths });
    });
  }, []);

  const handleSlipSetbackDrag = useCallback((armId: string, newSetback: number) => {
    setTopology((prev) => {
      const target = prev.arms.find((a) => a.id === armId);
      if (!target?.slipLane) return prev;
      return updateArmInTopology(prev, armId, {
        slipLane: { ...target.slipLane, islandSetback: newSetback },
      });
    });
  }, []);

  const handleSaveLocal = () => {
    const res = saveTopologyLocal(topology);
    setSavedTopologies(res.items);
    setNotice(res.ok ? 'Peta tersimpan di browser (localStorage).' : 'Gagal menyimpan: memori browser penuh.');
    window.setTimeout(() => setNotice(null), 2500);
  };

  const handleLoadSavedTopology = useCallback(
    (saved: IntersectionTopology) => {
      const cloned = cloneTopology(saved);
      pushTopology(cloned, true);
      setSelectedArmId(cloned.arms[0]?.id ?? null);
      setViewportState({ zoom: 1, pan: { x: 0, y: 0 } });
      setNotice(`Peta tersimpan "${cloned.name}" dimuat.`);
      window.setTimeout(() => setNotice(null), 2500);
    },
    [pushTopology]
  );

  const handleDeleteSavedTopology = useCallback((id: string) => {
    setSavedTopologies(deleteSavedTopologyLocal(id));
  }, []);

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(topology, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `peta-${topology.id || 'custom'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => {
      setNotice('Gagal membaca file JSON peta.');
      window.setTimeout(() => setNotice(null), 3000);
    };
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (isValidTopologyPayload(parsed)) {
          pushTopology(rebuildPhases(parsed), true);
          setSelectedArmId(parsed.arms[0].id);
          setNotice(`Peta "${parsed.name || 'Custom'}" berhasil dimuat.`);
          window.setTimeout(() => setNotice(null), 2500);
        } else {
          setNotice('Format JSON peta tidak valid (harus memiliki 3–5 lengan lengkap).');
          window.setTimeout(() => setNotice(null), 3000);
        }
      } catch {
        setNotice('File JSON peta tidak valid.');
        window.setTimeout(() => setNotice(null), 3000);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2.5 p-2.5 overflow-y-auto">
      {/* Draw Sub-Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleUndo}
            disabled={history.length === 0}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors duration-100"
            title="Undo"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={future.length === 0}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors duration-100"
            title="Redo"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>

          <div className="h-4 w-px bg-slate-200 mx-1" />

          <button
            type="button"
            onClick={() => setShowSplines((s) => !s)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors duration-100 ${
              showSplines ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" /> Jalur Spline
          </button>
          <button
            type="button"
            onClick={() => setShowConflicts((s) => !s)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors duration-100 ${
              showConflicts ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5" /> Titik Konflik ({compiled.conflictZones.length})
          </button>
          <button
            type="button"
            onClick={() => setShowStaticMap((s) => !s)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors duration-100 ${
              showStaticMap ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
            title="Tampilkan slot gambar peta statis (opsional di public/assets/maps/)"
          >
            <MapIcon className="w-3.5 h-3.5" /> Peta Statis
          </button>
          <button
            type="button"
            onClick={() => setShowGrid((g) => !g)}
            className={`p-1.5 rounded border transition-colors duration-100 ${
              showGrid ? 'bg-slate-100 text-slate-900 border-slate-300' : 'bg-white text-slate-500 border-slate-200'
            }`}
            title="Toggle Grid"
          >
            <Grid className="w-3.5 h-3.5" />
          </button>

          <div className="h-4 w-px bg-slate-200 mx-1" />

          <button
            type="button"
            onClick={() => setViewportState((v) => ({ ...v, zoom: Math.max(0.5, +(v.zoom - 0.15).toFixed(2)) }))}
            className="p-1.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors duration-100"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewportState({ zoom: 1, pan: { x: 0, y: 0 } })}
            className="px-1.5 py-1 text-[11px] font-mono text-slate-600 hover:bg-slate-100 rounded transition-colors duration-100"
            title="Reset Kamera"
          >
            {Math.round(viewportState.zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setViewportState((v) => ({ ...v, zoom: Math.min(3.0, +(v.zoom + 0.15).toFixed(2)) }))}
            className="p-1.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors duration-100"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {notice && (
            <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded">
              {notice}
            </span>
          )}
          <button
            type="button"
            onClick={handleSaveLocal}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors duration-100"
            title="Simpan ke Browser"
          >
            <Save className="w-3.5 h-3.5" /> Simpan
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors duration-100"
            title="Ekspor JSON"
          >
            <Download className="w-3.5 h-3.5" /> JSON
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded text-xs font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors duration-100"
            title="Impor JSON"
          >
            <Upload className="w-3.5 h-3.5" /> Muat
          </button>
          <input ref={fileInputRef} type="file" accept="application/json" onChange={handleImportJson} className="hidden" />

          <button
            type="button"
            disabled={!validation.valid}
            onClick={() => onSimulateTopology(cloneTopology(topology))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
          >
            <Play className="w-3.5 h-3.5" />
            Simulasikan Peta Ini
          </button>
        </div>
      </div>

      {/* Main 3-Pane Modular Editor */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2.5">
        <DrawPalette
          activeTopologyId={topology.id}
          selectedArmId={selectedArmId}
          armCount={topology.arms.length}
          savedTopologies={savedTopologies}
          onApplyModule={(kind) => handleApplyModule(kind)}
          onLoadBlueprint={handleLoadBlueprint}
          onLoadSavedTopology={handleLoadSavedTopology}
          onDeleteSavedTopology={handleDeleteSavedTopology}
        />

        <div className="flex-1 min-h-[380px] min-w-0">
          <DrawCanvas
            topology={topology}
            compiled={compiled}
            selectedArmId={selectedArmId}
            onSelectArm={setSelectedArmId}
            onDragStartRecord={recordDragSnapshot}
            onArmAngleDrag={handleArmAngleDrag}
            onArmWidthDrag={handleArmWidthDrag}
            onSlipSetbackDrag={handleSlipSetbackDrag}
            onDropModule={(armId, kind, angle) => handleApplyModule(kind, armId, angle)}
            showSplines={showSplines}
            showConflicts={showConflicts}
            showStaticMap={showStaticMap}
            showGrid={showGrid}
            zoom={viewportState.zoom}
            pan={viewportState.pan}
            onViewportChange={setViewportState}
          />
        </div>

        <DrawInspector
          topology={topology}
          selectedArmId={selectedArmId}
          validation={validation}
          onSelectArm={setSelectedArmId}
          onUpdateTopologyMeta={(patch) => pushTopology({ ...topology, ...patch }, true)}
          onChangePhasePreset={(preset: SignalPhasePreset) => pushTopology(rebuildPhases(topology, preset), true)}
          onUpdateArm={(armId: string, patch: Partial<ArmDef>) => pushTopology(updateArmInTopology(topology, armId, patch), true)}
          onRemoveArm={(armId: string) => {
            const next = removeArmFromTopology(topology, armId);
            pushTopology(next, true);
            setSelectedArmId(next.arms[0]?.id ?? null);
          }}
        />
      </div>
    </div>
  );
};
