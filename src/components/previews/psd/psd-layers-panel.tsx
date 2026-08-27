import { Button, Spinner } from "@tw-material/react";
import clsx from "clsx";
import { memo, useCallback, useMemo, useState } from "react";
import IconChevronRight from "~icons/material-symbols/chevron-right";
import IconClose from "~icons/material-symbols/close";
import IconInfoOutline from "~icons/material-symbols/info-outline";
import IconRestartAlt from "~icons/material-symbols/restart-alt";
import IconVisibility from "~icons/material-symbols/visibility";
import IconVisibilityOff from "~icons/material-symbols/visibility-off";

import { scrollbarClasses } from "@/utils/classes";
import type { PsdLayerNode } from "@/utils/psd";

function PsdLayersPanel({
  tree,
  visible,
  unsupportedBlends,
  isLoading,
  onToggle,
  onReset,
  onClose,
}: PsdLayersPanelProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  // Flattened once per tree/collapse change, so the list is a plain map instead of a
  // recursive component - and at <=250 rows it needs no virtualization.
  const rows = useMemo(() => flatten(tree, collapsed, visible), [tree, collapsed, visible]);

  const layerCount = useMemo(() => countLayers(tree), [tree]);

  return (
    <div className="flex size-full flex-col bg-surface-container-low">
      <div className="flex items-center gap-2 border-outline-variant border-b px-3 py-2">
        <span className="text-body-medium text-on-surface-variant">
          {layerCount} {layerCount === 1 ? "layer" : "layers"}
        </span>
        {isLoading && <Spinner size="sm" />}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="text"
            startContent={<IconRestartAlt />}
            onPress={onReset}
            isDisabled={isLoading}
          >
            Reset
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="text"
            aria-label="Close layers panel"
            onPress={onClose}
          >
            <IconClose className="pointer-events-none" />
          </Button>
        </div>
      </div>

      {unsupportedBlends.length > 0 && (
        <p className="flex gap-1.5 border-outline-variant border-b px-3 py-2 text-body-small text-on-surface-variant">
          <IconInfoOutline className="mt-px size-4 shrink-0" />
          <span>
            {unsupportedBlends.length} blend{" "}
            {unsupportedBlends.length === 1 ? "mode has" : "modes have"} no browser equivalent and{" "}
            {unsupportedBlends.length === 1 ? "is" : "are"} shown as Normal.
          </span>
        </p>
      )}

      <ul
        className={clsx(
          "min-h-0 grow overflow-y-auto py-1 pb-[env(safe-area-inset-bottom)]",
          scrollbarClasses,
        )}
      >
        {rows.map((row) => (
          <LayerRow
            key={row.node.id}
            row={row}
            isCollapsed={collapsed.has(row.node.id)}
            isDisabled={isLoading}
            onToggle={onToggle}
            onToggleCollapsed={toggleCollapsed}
          />
        ))}
      </ul>
    </div>
  );
}

function LayerRow({ row, isCollapsed, isDisabled, onToggle, onToggleCollapsed }: LayerRowProps) {
  const { node, depth, effectiveHidden } = row;
  const isGroup = node.kind === "group";
  const isShown = row.isVisible;

  return (
    <li>
      <div
        className={clsx(
          "flex items-center gap-1 pr-2 hover:bg-on-surface/5",
          effectiveHidden && "opacity-50",
        )}
        style={{ paddingLeft: 4 + depth * 16 }}
      >
        {isGroup ? (
          <Button
            isIconOnly
            size="sm"
            variant="text"
            className="size-7 min-w-7"
            aria-label={isCollapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
            aria-expanded={!isCollapsed}
            onPress={() => onToggleCollapsed(node.id)}
          >
            <IconChevronRight
              className={clsx(
                "pointer-events-none size-4 transition-transform",
                !isCollapsed && "rotate-90",
              )}
            />
          </Button>
        ) : (
          <span className="size-7 shrink-0" />
        )}

        <Button
          isIconOnly
          size="sm"
          variant="text"
          className="size-7 min-w-7 shrink-0"
          aria-label={`Toggle ${node.name}`}
          aria-pressed={isShown}
          isDisabled={isDisabled}
          onPress={() => onToggle(node.id)}
        >
          {isShown ? (
            <IconVisibility className="pointer-events-none size-4" />
          ) : (
            <IconVisibilityOff className="pointer-events-none size-4 text-on-surface-variant" />
          )}
        </Button>

        <span className="grow truncate py-1 text-body-small" title={node.name}>
          {node.name}
        </span>

        {!node.blendSupported && (
          <span
            className="shrink-0 leading-none"
            title={`"${node.blendMode}" has no browser equivalent; shown as Normal.`}
          >
            <IconInfoOutline className="size-4 text-on-surface-variant" />
          </span>
        )}

        <span className="shrink-0 text-body-small text-on-surface-variant tabular-nums">
          {formatMeta(node)}
        </span>
      </div>
    </li>
  );
}

function flatten(
  nodes: PsdLayerNode[],
  collapsed: ReadonlySet<string>,
  visible: Record<string, boolean>,
  depth = 0,
  ancestorHidden = false,
  rows: LayerRowData[] = [],
) {
  // Photoshop lists the top-most layer first, the reverse of the file order the
  // renderer walks.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const isVisible = visible[node.id] !== false;
    rows.push({ node, depth, isVisible, effectiveHidden: ancestorHidden || !isVisible });

    if (node.children && !collapsed.has(node.id))
      flatten(node.children, collapsed, visible, depth + 1, ancestorHidden || !isVisible, rows);
  }

  return rows;
}

function countLayers(nodes: PsdLayerNode[]): number {
  return nodes.reduce((total, node) => total + (node.children ? countLayers(node.children) : 1), 0);
}

function formatMeta(node: PsdLayerNode) {
  const opacity = Math.round(node.opacity * 100);
  if (node.blendMode === "normal") return opacity === 100 ? "" : `${opacity}%`;
  return opacity === 100 ? node.blendMode : `${node.blendMode} · ${opacity}%`;
}

interface LayerRowData {
  node: PsdLayerNode;
  depth: number;
  isVisible: boolean;
  effectiveHidden: boolean;
}

interface LayerRowProps {
  row: LayerRowData;
  isCollapsed: boolean;
  isDisabled: boolean;
  onToggle: (id: string) => void;
  onToggleCollapsed: (id: string) => void;
}

interface PsdLayersPanelProps {
  tree: PsdLayerNode[];
  visible: Record<string, boolean>;
  unsupportedBlends: string[];
  isLoading: boolean;
  onToggle: (id: string) => void;
  onReset: () => void;
  onClose: () => void;
}

export default memo(PsdLayersPanel);
