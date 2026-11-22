import assert from 'node:assert/strict';
import test from 'node:test';

// Inline the pure function so the test runs without a TS loader.
function needsServerBlend(nodes, inPassThrough = false) {
  return nodes.some((node) => {
    if (!node.blendSupported) return true;
    const passThrough = node.kind === 'group' && node.blendMode === 'pass through';
    if (inPassThrough && !passThrough && node.blendMode !== 'normal') return true;
    if (passThrough && node.children?.length && (node.opacity !== 1 || (node.mask && !node.mask.disabled))) return true;
    return node.children ? needsServerBlend(node.children, passThrough) : false;
  });
}

const layer = (blendMode = 'normal', extra = {}) => ({ kind: 'layer', blendMode, opacity: 1, blendSupported: true, ...extra });
const group = (children, extra = {}) => layer('pass through', { kind: 'group', children, ...extra });

test('browser-native blends stay local', () => {
  assert.equal(needsServerBlend([layer('multiply'), group([layer(), layer()])]), false);
});

test('offloads a blend the browser cannot implement', () => {
  assert.equal(needsServerBlend([layer('linear dodge', { blendSupported: false })]), true);
});

test('offloads pass-through groups whose children blend against the outside backdrop', () => {
  assert.equal(needsServerBlend([layer(), group([group([layer('multiply', { hidden: true })])])]), true);
});

test('isolated (normal) groups keep children local when blends are native', () => {
  assert.equal(needsServerBlend([group([layer('multiply')], { blendMode: 'normal' })]), false);
});

test('pass-through groups with partial opacity or an enabled mask go server-side', () => {
  assert.equal(needsServerBlend([group([layer(), layer()], { opacity: 0.5 })]), true);
  assert.equal(needsServerBlend([group([layer(), layer()], { mask: { disabled: false } })]), true);
  assert.equal(needsServerBlend([group([layer(), layer()], { mask: { disabled: true } })]), false);
});
