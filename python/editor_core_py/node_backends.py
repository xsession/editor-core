from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any
from .model import Point, RouteResult, Scene
from .geometry import polyline_length


def scene_to_elk_graph(scene: Scene) -> dict[str, Any]:
    children = []
    for cid in scene.document.component_order:
        component = scene.document.components.get(cid)
        geometry = scene.geometries.get(cid)
        if not component or not geometry or component.hidden:
            continue
        body = geometry.body
        children.append({
            'id': cid, 'x': body.x, 'y': body.y, 'width': body.width, 'height': body.height,
            'ports': [
                {'id': f'{cid}:{pid}', 'x': p.x - body.x, 'y': p.y - body.y, 'width': 1, 'height': 1}
                for pid, p in geometry.port_centers.items()
            ],
        })
    edges = []
    for wid in scene.document.wire_order:
        wire = scene.document.wires.get(wid)
        if not wire or wire.hidden or wire.source.kind != 'port' or wire.target.kind != 'port':
            continue
        edges.append({
            'id': wid,
            'source': wire.source.component_id,
            'target': wire.target.component_id,
            'sourcePort': f'{wire.source.component_id}:{wire.source.port_id}',
            'targetPort': f'{wire.target.component_id}:{wire.target.port_id}',
        })
    return {'id': scene.document.id, 'children': children, 'edges': edges}


class NodeBackendBridge:
    def __init__(self, bridge_path: str | Path | None = None, node_executable: str = 'node'):
        self.bridge_path = Path(bridge_path) if bridge_path else Path(__file__).resolve().parent.parent / 'node_bridge' / 'bridge.mjs'
        self.node_executable = node_executable

    def call(self, request: dict[str, Any]) -> Any:
        completed = subprocess.run(
            [self.node_executable, str(self.bridge_path)],
            input=json.dumps(request), text=True, capture_output=True, check=False,
        )
        try:
            response = json.loads(completed.stdout or '{}')
        except json.JSONDecodeError as exc:
            raise RuntimeError(f'Node backend returned invalid JSON: {completed.stderr}') from exc
        if completed.returncode != 0 or not response.get('ok'):
            error = response.get('error', {})
            raise RuntimeError(error.get('message') or completed.stderr or 'Node backend failed')
        return response['result']


class ElkJsBackend:
    def __init__(self, bridge: NodeBackendBridge | None = None):
        self.bridge = bridge or NodeBackendBridge()

    def layout_scene(self, scene: Scene, *, direction: str = 'RIGHT', **options: Any) -> dict[str, Any]:
        graph = scene_to_elk_graph(scene)
        graph['layoutOptions'] = {
            'elk.algorithm': options.pop('algorithm', 'layered'),
            'elk.direction': direction,
            'elk.edgeRouting': options.pop('edge_routing', 'ORTHOGONAL'),
            'elk.spacing.nodeNode': str(options.pop('node_spacing', 32)),
            'elk.layered.spacing.nodeNodeBetweenLayers': str(options.pop('layer_spacing', 48)),
            **options.pop('layout_options', {}),
        }
        return self.bridge.call({'action': 'elk-layout', 'graph': graph, **options})


class LibavoidNodeBackend:
    def __init__(self, bridge: NodeBackendBridge | None = None, wasm_path: str | None = None):
        self.bridge = bridge or NodeBackendBridge()
        self.wasm_path = wasm_path

    def route_scene(self, scene: Scene, **options: Any) -> dict[str, RouteResult]:
        graph = scene_to_elk_graph(scene)
        raw = self.bridge.call({
            'action': 'libavoid-route', 'graph': graph, 'wasmPath': options.pop('wasm_path', self.wasm_path),
            'options': {
                'routingType': options.pop('routing_type', 'orthogonal'),
                'shapeBufferDistance': options.pop('shape_buffer_distance', 8),
                'segmentPenalty': options.pop('segment_penalty', 10),
                'crossingPenalty': options.pop('crossing_penalty', 100),
                'idealNudgingDistance': options.pop('ideal_nudging_distance', 6),
                **options,
            },
        })
        routes: dict[str, RouteResult] = {}
        for wid, route in raw.items():
            points = [Point(**route['sourcePoint']), *[Point(**p) for p in route.get('bendPoints', [])], Point(**route['targetPoint'])]
            routes[wid] = RouteResult(points, polyline_length(points), max(0, len(points) - 2), diagnostics=['Routed by libavoid WebAssembly through Node bridge.'], generated_at_revision=scene.document.revision)
        return routes
