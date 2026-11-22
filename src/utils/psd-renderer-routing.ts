import type { PsdLayerNode } from './psd';

// Canvas isolates groups in scratch canvases. A Pass Through group's blend
// operators can instead act on the backdrop outside that group in a PSD.
export function needsServerBlend(nodes: PsdLayerNode[], inPassThrough = false): boolean {
  return nodes.some((node) => {
    if (!node.blendSupported) return true;
    const passThrough = node.kind === 'group' && node.blendMode === 'pass through';
    if (inPassThrough && !passThrough && node.blendMode !== 'normal') return true;
    if (passThrough && node.children?.length && (node.opacity !== 1 || (node.mask && !node.mask.disabled))) return true;
    // An isolated group breaks the backdrop chain, but may contain its own
    // Pass Through groups that need the backdrop within that isolated group.
    return node.children ? needsServerBlend(node.children, passThrough) : false;
  });
}
