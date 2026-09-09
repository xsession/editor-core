from __future__ import annotations

from collections import defaultdict, deque
from .model import Document, Point


def layered_layout(document: Document, *, direction: str = 'RIGHT', layer_spacing: float = 180.0, node_spacing: float = 100.0) -> dict[str, Point]:
    """Dependency-free layered layout for the Python core."""
    indegree = {cid: 0 for cid in document.component_order}
    outgoing: dict[str, set[str]] = defaultdict(set)
    for wire in document.wires.values():
        if wire.source.kind == wire.target.kind == 'port' and wire.source.component_id != wire.target.component_id:
            a, b = wire.source.component_id, wire.target.component_id
            if a in indegree and b in indegree and b not in outgoing[a]:
                outgoing[a].add(b)
                indegree[b] += 1
    queue = deque([cid for cid in document.component_order if indegree[cid] == 0])
    layer = {cid: 0 for cid in queue}
    while queue:
        current = queue.popleft()
        for nxt in outgoing[current]:
            layer[nxt] = max(layer.get(nxt, 0), layer[current] + 1)
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                queue.append(nxt)
    groups: dict[int, list[str]] = defaultdict(list)
    for cid in document.component_order:
        groups[layer.get(cid, 0)].append(cid)
    positions: dict[str, Point] = {}
    for layer_index, ids in sorted(groups.items()):
        for row, cid in enumerate(ids):
            if direction in ('RIGHT', 'LEFT'):
                x = layer_index * layer_spacing * (-1 if direction == 'LEFT' else 1)
                y = row * node_spacing
            else:
                x = row * node_spacing
                y = layer_index * layer_spacing * (-1 if direction == 'UP' else 1)
            positions[cid] = Point(x, y)
    return positions


def apply_layered_layout(engine, **options):
    positions = layered_layout(engine.document, **options)
    return engine.execute('Layered auto-layout', lambda draft, impact: _apply(draft, impact, positions))


def _apply(draft, impact, positions):
    for cid, position in positions.items():
        if cid in draft.components:
            draft.components[cid].position = position
            impact.changed_components.append(cid)
