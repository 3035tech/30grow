/** A compact, top-down forest. Each subtree owns a horizontal span. */
export const ORG_CARD_WIDTH = 216;
export const ORG_CARD_HEIGHT = 132;
export const ORG_CARD_EXPANDED_HEIGHT = 200;
const GAP_X = 20;
const GAP_Y = 44;
const PAD = 24;

export function flattenOrgChart(roots) {
  const result = [];
  const visit = (node, depth) => {
    result.push({ ...node, depth });
    for (const child of node.children || []) visit(child, depth + 1);
  };
  for (const root of roots || []) visit(root, 0);
  return result;
}

export function orgChartLayout(roots, collapsed = new Set(), expandedDetails = new Set()) {
  const spans = new Map();
  const measure = (node) => {
    const children = collapsed.has(node.id) ? [] : node.children || [];
    const span = Math.max(ORG_CARD_WIDTH, children.reduce((sum, child) => sum + measure(child), 0) + Math.max(0, children.length - 1) * GAP_X);
    spans.set(node.id, span);
    return span;
  };
  roots.forEach(measure);
  const nodes = [], edges = [];
  const place = (node, left, depth, parent, top) => {
    const positioned = { ...node, x: left + (spans.get(node.id) - ORG_CARD_WIDTH) / 2, y: top, height: expandedDetails.has(node.id) ? ORG_CARD_EXPANDED_HEIGHT : ORG_CARD_HEIGHT, depth };
    nodes.push(positioned);
    if (parent) edges.push({ from: parent, to: positioned });
    if (!collapsed.has(node.id)) {
      let cursor = left;
      for (const child of node.children || []) {
        place(child, cursor, depth + 1, positioned, top + positioned.height + GAP_Y);
        cursor += spans.get(child.id) + GAP_X;
      }
    }
  };
  let left = PAD, top = PAD, rowBottom = PAD, width = ORG_CARD_WIDTH + PAD * 2;
  roots.forEach((root) => {
    const span = spans.get(root.id);
    // Disconnected teams wrap instead of creating a 200-card horizontal strip.
    if (left > PAD && left + span > 1120) { left = PAD; top = rowBottom + GAP_Y; }
    const start = nodes.length;
    place(root, left, 0, null, top);
    rowBottom = Math.max(rowBottom, ...nodes.slice(start).map((node) => node.y + node.height));
    width = Math.max(width, left + span + PAD);
    left += span + GAP_X;
  });
  return {
    nodes, edges,
    width,
    height: Math.max(ORG_CARD_HEIGHT + PAD * 2, ...nodes.map((node) => node.y + node.height + PAD)),
  };
}

/** Exclude the employee and all descendants from manager choices. */
export function orgDescendantIds(node) {
  return new Set(flattenOrgChart(node ? [node] : []).map((person) => person.id));
}

/** Search names, roles and units without requiring accents or exact spacing. */
export function filterOrgPeople(people, query) {
  const normalize = (value) => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
  const terms = normalize(query).split(' ').filter(Boolean);
  return people.filter((person) => {
    const text = normalize(`${person.name} ${person.jobRoleName || ''} ${person.orgUnitName || ''}`);
    return terms.every((term) => text.includes(term));
  });
}
