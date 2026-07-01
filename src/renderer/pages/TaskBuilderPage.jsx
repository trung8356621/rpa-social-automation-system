import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ArrowLeft, Cable, Database, LogIn, MousePointerClick, Plus, Save, Trash2, Workflow, ZoomIn, ZoomOut } from 'lucide-react';
import { saveTask } from '../slices/taskSlice';
import { showToast } from '../slices/uiSlice';

const NODE_WIDTH = 272;
const NODE_HEIGHT = 96;
const PORT_SIZE = 14;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.1;

const WIDGET_TYPES = {
  prepare: {
    title: 'Prepare scenario',
    shortTitle: 'Prepare',
    description: 'Login, lưu cookies',
    icon: LogIn,
    color: '#8b5cf6',
    bg: '#2d2358',
  },
  crawl: {
    title: 'Crawl scenario',
    shortTitle: 'Crawl',
    description: 'Lấy dữ liệu',
    icon: Database,
    color: '#06b6d4',
    bg: '#183d4b',
  },
  action: {
    title: 'Action scenario',
    shortTitle: 'Action',
    description: 'Đăng bài, tương tác',
    icon: MousePointerClick,
    color: '#20b486',
    bg: '#163f35',
  },
};

function createScenarioNode(type = 'action', index = 0) {
  const config = WIDGET_TYPES[type] || WIDGET_TYPES.action;

  return {
    id: `${type}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type,
    title: config.title,
    x: 96 + index * 36,
    y: 96 + index * 36,
    data: {
      scenarioId: '',
    },
  };
}

function getInputPort(node) {
  return {
    x: node.x,
    y: node.y + NODE_HEIGHT / 2,
  };
}

function getOutputPort(node) {
  return {
    x: node.x + NODE_WIDTH,
    y: node.y + NODE_HEIGHT / 2,
  };
}

function edgePath(source, target) {
  const start = getOutputPort(source);
  const end = getInputPort(target);
  const curve = Math.max(60, Math.abs(end.x - start.x) / 2);

  return `M ${start.x} ${start.y} C ${start.x + curve} ${start.y}, ${end.x - curve} ${end.y}, ${end.x} ${end.y}`;
}

function normalizeFlowData(flowData) {
  if (!flowData || typeof flowData !== 'object') {
    return { nodes: [createScenarioNode('prepare')], edges: [] };
  }

  const nodes = Array.isArray(flowData.nodes) && flowData.nodes.length > 0
    ? flowData.nodes.map((node, index) => ({
      ...createScenarioNode(node.type || 'action', index),
      ...node,
      data: {
        scenarioId: node.data?.scenarioId || '',
      },
    }))
    : [createScenarioNode('prepare')];

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(flowData.edges)
    ? flowData.edges.filter((edge) => nodeIds.has(edge.sourceNode) && nodeIds.has(edge.targetNode))
    : [];

  return { nodes, edges };
}

export default function TaskBuilderPage({ task, onBack }) {
  const dispatch = useDispatch();
  const scenarios = useSelector((state) => state.scenarios.items);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const initialFlow = useMemo(() => normalizeFlowData(task?.flow_data), [task?.id]);
  const [taskName, setTaskName] = useState(task?.name || 'Task mới');
  const [nodes, setNodes] = useState(() => initialFlow.nodes);
  const [edges, setEdges] = useState(() => initialFlow.edges);
  const [selectedNodeId, setSelectedNodeId] = useState(() => nodes[0]?.id || null);
  const [connecting, setConnecting] = useState(null);
  const [zoom, setZoom] = useState(1);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
  );

  const selectedScenario = useMemo(() => {
    if (!selectedNode?.data?.scenarioId) return null;
    return scenarios.find((scenario) => String(scenario.id) === String(selectedNode.data.scenarioId)) || null;
  }, [scenarios, selectedNode]);

  const scenarioOptions = useMemo(() => {
    const selectedType = selectedNode?.type || 'action';

    return scenarios
      .filter((scenario) => (scenario.scenario_type || 'action') === selectedType)
      .map((scenario) => ({
        value: String(scenario.id),
        label: scenario.name || scenario.id,
      }));
  }, [scenarios, selectedNode?.type]);

  const changeZoom = (amount) => {
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((current + amount).toFixed(2)))));
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;

      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        changeZoom(ZOOM_STEP);
      }

      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        changeZoom(-ZOOM_STEP);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const addScenarioWidget = (type) => {
    const node = createScenarioNode(type, nodes.length);
    setNodes((current) => [...current, node]);
    setSelectedNodeId(node.id);
  };

  const updateSelectedScenario = (scenarioId) => {
    setNodes((current) => current.map((node) => (
      node.id === selectedNodeId
        ? { ...node, data: { ...node.data, scenarioId } }
        : node
    )));
  };

  const deleteSelectedNode = () => {
    if (!selectedNodeId) return;
    setNodes((current) => current.filter((node) => node.id !== selectedNodeId));
    setEdges((current) => current.filter((edge) => (
      edge.sourceNode !== selectedNodeId && edge.targetNode !== selectedNodeId
    )));
    setSelectedNodeId(null);
  };

  const handleSave = async () => {
    const result = await dispatch(saveTask({
      id: task?.id,
      name: taskName,
      description: task?.description || '',
      is_active: task?.is_active ?? 1,
      flow_data: { nodes, edges },
    }));

    if (result.meta.requestStatus === 'fulfilled') {
      dispatch(showToast({ type: 'success', message: 'Đã lưu task' }));
    } else {
      dispatch(showToast({ type: 'error', message: result.payload || 'Lưu task thất bại' }));
    }
  };

  const startDrag = (event, node) => {
    if (event.button !== 0) return;
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;
    const worldX = (event.clientX - canvasRect.left + canvasRef.current.scrollLeft) / zoom;
    const worldY = (event.clientY - canvasRect.top + canvasRef.current.scrollTop) / zoom;

    dragRef.current = {
      nodeId: node.id,
      offsetX: worldX - node.x,
      offsetY: worldY - node.y,
    };
    setSelectedNodeId(node.id);
  };

  const handleCanvasMove = (event) => {
    const drag = dragRef.current;
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!drag || !canvasRect) return;

    const worldX = (event.clientX - canvasRect.left + canvasRef.current.scrollLeft) / zoom;
    const worldY = (event.clientY - canvasRect.top + canvasRef.current.scrollTop) / zoom;
    const nextX = Math.max(24, worldX - drag.offsetX);
    const nextY = Math.max(24, worldY - drag.offsetY);

    setNodes((current) => current.map((node) => (
      node.id === drag.nodeId ? { ...node, x: nextX, y: nextY } : node
    )));
  };

  const stopDrag = () => {
    dragRef.current = null;
  };

  const handleOutputPort = (event, nodeId) => {
    event.stopPropagation();
    setConnecting({ nodeId });
    setSelectedNodeId(nodeId);
  };

  const handleInputPort = (event, nodeId) => {
    event.stopPropagation();
    if (!connecting || connecting.nodeId === nodeId) {
      setConnecting(null);
      setSelectedNodeId(nodeId);
      return;
    }

    setEdges((current) => {
      const exists = current.some((edge) => edge.sourceNode === connecting.nodeId && edge.targetNode === nodeId);
      if (exists) return current;

      return [
        ...current,
        {
          id: `edge_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          sourceNode: connecting.nodeId,
          targetNode: nodeId,
        },
      ];
    });
    setConnecting(null);
    setSelectedNodeId(nodeId);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#111827] text-[#eef2f7]">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#2e3b4e] bg-[#151f2d] px-5">
        <div className="flex min-w-0 items-center gap-3">
          {onBack ? (
            <button type="button" onClick={onBack} className="btn-secondary">
              <ArrowLeft className="h-4 w-4" />
              Tasks
            </button>
          ) : null}
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2f80ed] text-white">
            <Workflow className="h-5 w-5" />
          </div>
          <input
            type="text"
            value={taskName}
            onChange={(event) => setTaskName(event.target.value)}
            className="w-72 rounded-md border border-[#344257] bg-[#111a27] px-3 py-2 text-sm font-semibold text-white outline-none transition focus:border-[#2f80ed] focus:ring-2 focus:ring-[#2f80ed]/20"
          />
        </div>

        <button type="button" onClick={handleSave} className="btn-primary">
          <Save className="h-4 w-4" />
          Lưu
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[248px_minmax(0,1fr)_328px]">
        <aside className="border-r border-[#2e3b4e] bg-[#151f2d] p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#7e8da5]">
            Thêm widget
          </div>
          <div className="space-y-3">
            {Object.entries(WIDGET_TYPES).map(([type, config]) => {
              const Icon = config.icon;

              return (
                <button
                  type="button"
                  key={type}
                  onClick={() => addScenarioWidget(type)}
                  className="flex w-full items-center gap-3 rounded-lg border border-[#344257] bg-[#1b2737] p-3 text-left transition hover:border-[#2f80ed] hover:bg-[#202f43]"
                >
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-md"
                    style={{ backgroundColor: config.bg, color: config.color }}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white">{config.shortTitle}</span>
                    <span className="block truncate text-xs text-[#9aa7b7]">{config.description}</span>
                  </span>
                  <Plus className="ml-auto h-4 w-4 text-[#7e8da5]" />
                </button>
              );
            })}
          </div>
        </aside>

        <main
          ref={canvasRef}
          onMouseMove={handleCanvasMove}
          onMouseUp={stopDrag}
          onMouseLeave={stopDrag}
          className="relative min-h-0 overflow-auto bg-[#f8fafc] text-[#182230]"
        >
          <div className="absolute inset-0 [background-image:radial-gradient(#b8d3f3_1px,transparent_1px)] [background-size:20px_20px]" />
          <div className="relative" style={{ width: 1400 * zoom, height: 1400 * zoom }}>
            <div
              className="absolute left-0 top-0 h-[1400px] w-[1400px] origin-top-left"
              style={{ transform: `scale(${zoom})` }}
            >
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
              {edges.map((edge) => {
                const source = nodes.find((node) => node.id === edge.sourceNode);
                const target = nodes.find((node) => node.id === edge.targetNode);
                if (!source || !target) return null;

                return (
                  <path
                    key={edge.id}
                    d={edgePath(source, target)}
                    fill="none"
                    stroke="#8da0b7"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                );
              })}
            </svg>

            {nodes.map((node) => {
              const config = WIDGET_TYPES[node.type] || WIDGET_TYPES.action;
              const Icon = config.icon;
              const scenario = node.data.scenarioId
                ? scenarios.find((item) => String(item.id) === String(node.data.scenarioId))
                : null;

              return (
                <div
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  onMouseDown={(event) => startDrag(event, node)}
                  onClick={() => setSelectedNodeId(node.id)}
                  className={`absolute select-none rounded-lg border bg-white text-left shadow-lg transition ${
                    selectedNodeId === node.id
                      ? 'border-[#2f80ed] ring-2 ring-[#2f80ed]/25'
                      : 'border-[#d5dce8] hover:border-[#8fb8ee]'
                  }`}
                  style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
                >
                  <button
                    type="button"
                    aria-label="Input"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => handleInputPort(event, node.id)}
                    className={`absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ${
                      connecting && connecting.nodeId !== node.id ? 'bg-[#2f80ed]' : 'bg-[#7e8da5]'
                    }`}
                    style={{ left: 0, width: PORT_SIZE, height: PORT_SIZE }}
                  />
                  <button
                    type="button"
                    aria-label="Output"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => handleOutputPort(event, node.id)}
                    className={`absolute top-1/2 z-10 -translate-y-1/2 translate-x-1/2 rounded-full border-2 border-white ${
                      connecting?.nodeId === node.id ? 'bg-[#f59e0b]' : 'bg-[#64748b]'
                    }`}
                    style={{ right: 0, width: PORT_SIZE, height: PORT_SIZE }}
                  />

                  <div className="flex items-center justify-between border-b border-[#e5eaf2] px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="flex h-7 w-7 items-center justify-center rounded-md"
                        style={{ backgroundColor: config.bg, color: config.color }}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="truncate text-sm font-bold text-[#182230]">{node.title}</span>
                    </div>
                    <Cable className="h-4 w-4 text-[#8da0b7]" />
                  </div>
                  <div className="px-3 py-2">
                    <p className="truncate text-sm font-semibold text-[#2563eb]">
                      {scenario?.name || 'Chưa chọn scenario'}
                    </p>
                    <p className="mt-1 truncate text-xs text-[#64748b]">
                      {scenario?.target_url || config.description}
                    </p>
                  </div>
                </div>
              );
            })}
            </div>
          </div>

          <div className="sticky bottom-4 left-4 z-20 ml-4 mb-4 flex w-fit items-center gap-2 rounded-lg border border-[#d5dce8] bg-white px-2 py-1.5 text-[#182230] shadow-lg">
            <button
              type="button"
              onClick={() => changeZoom(-ZOOM_STEP)}
              disabled={zoom <= MIN_ZOOM}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[#475569] hover:bg-[#eef4fb] disabled:cursor-not-allowed disabled:opacity-40"
              title="Zoom out (Ctrl -)"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="min-w-12 text-center text-xs font-semibold">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={() => changeZoom(ZOOM_STEP)}
              disabled={zoom >= MAX_ZOOM}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[#475569] hover:bg-[#eef4fb] disabled:cursor-not-allowed disabled:opacity-40"
              title="Zoom in (Ctrl +)"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        </main>

        <aside className="border-l border-[#2e3b4e] bg-[#151f2d] p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Cài đặt widget</h2>
              <p className="mt-1 text-xs text-[#9aa7b7]">
                {selectedNode ? WIDGET_TYPES[selectedNode.type]?.title : 'Chưa chọn widget'}
              </p>
            </div>
            {selectedNode ? (
              <button type="button" onClick={deleteSelectedNode} className="icon-button text-[#ffb4b4]">
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {selectedNode ? (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[#9aa7b7]">
                Chọn scenario
              </label>
              <select
                value={selectedNode.data.scenarioId || ''}
                onChange={(event) => updateSelectedScenario(event.target.value)}
                className="select-field"
              >
                <option value="">Chọn scenario...</option>
                {scenarioOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <div className="mt-2 text-xs text-[#7e8da5]">
                Danh sách đang lọc theo type: <span className="font-semibold text-[#c7d0dc]">{selectedNode.type}</span>
              </div>

              {selectedScenario ? (
                <div className="mt-4 rounded-lg border border-[#344257] bg-[#111a27] p-3">
                  <div className="text-sm font-semibold text-white">{selectedScenario.name}</div>
                  <div className="mt-1 truncate text-xs text-[#9aa7b7]">
                    {selectedScenario.target_url || selectedScenario.description || selectedScenario.id}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg border border-[#344257] bg-[#111a27] p-3 text-sm text-[#9aa7b7]">
              Chọn widget để cài đặt.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
