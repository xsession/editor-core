from __future__ import annotations

import copy
import time
from .connectivity import MutableConnectivityIndex
from .geometry import inflate_rect, point_segment_distance, rect_contains_point, segment_bounds, union_rects
from .model import Component, ComponentGeometry, Document, MutationImpact, Point, Rect, Scene
from .routing import RoutingObstacle, route_wire
from .spatial import AdaptiveSpatialIndex, SpatialItem


def _component_geometry(component: Component) -> ComponentGeometry:
    body = Rect(component.position.x - component.width / 2, component.position.y - component.height / 2,
                component.width, component.height)
    centers: dict[str, Point] = {}
    sides: dict[str, str] = {}
    grouped: dict[str, list] = {'north': [], 'east': [], 'south': [], 'west': []}
    for port in sorted((p for p in component.ports if p.visible), key=lambda p: (p.side, p.order)):
        grouped[port.side].append(port)
    for side, ports in grouped.items():
        for index, port in enumerate(ports):
            fraction = port.side_fraction if port.side_fraction is not None else (index + 1) / (len(ports) + 1)
            if side == 'north':
                p = Point(body.x + body.width * fraction, body.y)
            elif side == 'south':
                p = Point(body.x + body.width * fraction, body.y + body.height)
            elif side == 'west':
                p = Point(body.x, body.y + body.height * fraction)
            else:
                p = Point(body.x + body.width, body.y + body.height * fraction)
            centers[port.id] = p
            sides[port.id] = side
    return ComponentGeometry(component.id, body, centers, sides)


def _content_bounds(geometries: dict[str, ComponentGeometry], document: Document) -> Rect:
    rects = [g.body for g in geometries.values()]
    for wire in document.wires.values():
        if wire.route and wire.route.points:
            xs = [p.x for p in wire.route.points]
            ys = [p.y for p in wire.route.points]
            rects.append(Rect(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)))
    return inflate_rect(union_rects(rects), 80)


class SceneSpatialIndex:
    def __init__(self):
        self.index = AdaptiveSpatialIndex[dict]()
        self.owner_items: dict[str, set[str]] = {}

    def _replace_owner(self, owner: str, items: list[SpatialItem[dict]]) -> None:
        for item_id in self.owner_items.get(owner, ()):
            self.index.remove(item_id)
        ids: set[str] = set()
        for item in items:
            self.index.insert(item)
            ids.add(item.id)
        self.owner_items[owner] = ids

    def upsert_component(self, component: Component | None, geometry: ComponentGeometry | None) -> None:
        owner = f'component:{component.id if component else geometry.component_id if geometry else "?"}'
        if component is None or geometry is None or component.hidden:
            self._replace_owner(owner, [])
            return
        items = [SpatialItem(owner, geometry.body, {'kind': 'component', 'id': component.id}, 600 + component.z_index)]
        for port_id, center in geometry.port_centers.items():
            items.append(SpatialItem(f'port:{component.id}:{port_id}', Rect(center.x - 8, center.y - 8, 16, 16),
                                     {'kind': 'port', 'id': component.id, 'sub_id': port_id}, 900 + component.z_index))
        self._replace_owner(owner, items)

    def upsert_wire(self, wire) -> None:
        owner = f'wire:{wire.id}'
        if wire.hidden or not wire.route or len(wire.route.points) < 2:
            self._replace_owner(owner, [])
            return
        items: list[SpatialItem[dict]] = []
        xs = [p.x for p in wire.route.points]
        ys = [p.y for p in wire.route.points]
        items.append(SpatialItem(owner, Rect(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)), {'kind': 'wire', 'id': wire.id}, 500 + wire.z_index))
        for i in range(len(wire.route.points) - 1):
            items.append(SpatialItem(f'segment:{wire.id}:{i}', segment_bounds(wire.route.points[i], wire.route.points[i + 1], 2),
                                     {'kind': 'segment', 'id': wire.id, 'sub_id': i}, 800 + wire.z_index))
        self._replace_owner(owner, items)

    def rebuild(self, document: Document, geometries: dict[str, ComponentGeometry]) -> 'SceneSpatialIndex':
        self.index = AdaptiveSpatialIndex()
        self.owner_items.clear()
        for cid in document.component_order:
            self.upsert_component(document.components.get(cid), geometries.get(cid))
        for wid in document.wire_order:
            wire = document.wires.get(wid)
            if wire:
                self.upsert_wire(wire)
        return self

    def hit_test(self, document: Document, geometries: dict[str, ComponentGeometry], point: Point, tolerance: float = 7.0) -> list[dict]:
        hits: list[dict] = []
        for item in self.index.query_point(point, tolerance):
            value = item.value
            if value['kind'] == 'component':
                geometry = geometries.get(value['id'])
                if geometry and rect_contains_point(geometry.body, point):
                    hits.append({'kind': 'component', 'id': value['id'], 'distance': 0.0, 'z_index': item.z_index})
            elif value['kind'] == 'port':
                center = geometries[value['id']].port_centers[value['sub_id']]
                d = ((center.x - point.x) ** 2 + (center.y - point.y) ** 2) ** 0.5
                if d <= tolerance + 8:
                    hits.append({'kind': 'port', 'id': value['id'], 'sub_id': value['sub_id'], 'distance': d, 'z_index': item.z_index})
            elif value['kind'] == 'segment':
                wire = document.wires[value['id']]
                i = value['sub_id']
                d = point_segment_distance(point, wire.route.points[i], wire.route.points[i + 1])
                if d <= tolerance + 2:
                    hits.append({'kind': 'wire', 'id': value['id'], 'sub_id': i, 'distance': d, 'z_index': item.z_index})
        hits.sort(key=lambda hit: (-hit['z_index'], hit['distance'], hit['id']))
        return hits


class IncrementalSceneRuntime:
    def __init__(self, *, auto_route: bool = True):
        self.auto_route = auto_route
        self.scene: Scene | None = None
        self.connectivity: MutableConnectivityIndex | None = None
        self.spatial_index: SceneSpatialIndex | None = None
        self.metrics = {'full_rebuilds': 0, 'incremental_updates': 0, 'last_update_ms': 0.0, 'last_rerouted_wires': 0}

    def reset(self, source: Document) -> Scene:
        started = time.perf_counter()
        document = copy.deepcopy(source)
        connectivity = MutableConnectivityIndex(document)
        geometries = {cid: _component_geometry(document.components[cid]) for cid in document.component_order if cid in document.components and not document.components[cid].hidden}
        obstacles = [RoutingObstacle(cid, geometry.body) for cid, geometry in geometries.items()]
        routes = {}
        if self.auto_route:
            for wid in document.wire_order:
                wire = document.wires.get(wid)
                if wire and not wire.hidden:
                    wire.route = route_wire(wire, geometries, obstacles, document.revision)
                    routes[wid] = wire.route
        else:
            routes = {wid: wire.route for wid, wire in document.wires.items() if wire.route}
        spatial = SceneSpatialIndex().rebuild(document, geometries)
        impact = MutationImpact(changed_components=list(document.component_order), rerouted_wires=list(document.wire_order), full_rebuild=True)
        scene = Scene(document, geometries, routes, connectivity, spatial, _content_bounds(geometries, document), impact)
        self.scene, self.connectivity, self.spatial_index = scene, connectivity, spatial
        self.metrics['full_rebuilds'] += 1
        self.metrics['last_update_ms'] = (time.perf_counter() - started) * 1000
        return scene

    def update(self, source: Document, impact: MutationImpact) -> Scene:
        if self.scene is None:
            return self.reset(source)
        started = time.perf_counter()
        previous = self.scene
        if source.id != previous.document.id or source.component_order != previous.document.component_order or source.wire_order != previous.document.wire_order:
            return self.reset(source)
        document = copy.deepcopy(source)
        connectivity = self.connectivity or MutableConnectivityIndex(previous.document)
        wire_changes = set(impact.rerouted_wires) | set(impact.added_wires) | set(impact.removed_wires)
        connectivity.apply(document, wire_changes)
        geometries = dict(previous.geometries)
        changed_components = set(impact.changed_components)
        affected_wires = set(wire_changes)
        for cid in changed_components:
            component = document.components.get(cid)
            if component and not component.hidden:
                geometries[cid] = _component_geometry(component)
            else:
                geometries.pop(cid, None)
            affected_wires.update(connectivity.wires_for_component(cid))
        obstacles = [RoutingObstacle(cid, geometry.body) for cid, geometry in geometries.items()]
        routes = dict(previous.routes)
        rerouted = 0
        if self.auto_route:
            for wid in affected_wires:
                wire = document.wires.get(wid)
                if wire and not wire.hidden:
                    wire.route = route_wire(wire, geometries, obstacles, document.revision)
                    routes[wid] = wire.route
                    rerouted += 1
                else:
                    routes.pop(wid, None)
        for wid in document.wire_order:
            if wid not in affected_wires and wid in previous.document.wires:
                document.wires[wid].route = copy.deepcopy(previous.document.wires[wid].route)
        spatial = self.spatial_index or SceneSpatialIndex()
        for cid in changed_components:
            spatial.upsert_component(document.components.get(cid), geometries.get(cid))
        for wid in affected_wires:
            wire = document.wires.get(wid)
            if wire:
                spatial.upsert_wire(wire)
        derived = copy.deepcopy(impact)
        derived.dependency_rerouted_wires = sorted(affected_wires)
        for wid in affected_wires:
            if wid not in derived.rerouted_wires:
                derived.rerouted_wires.append(wid)
        scene = Scene(document, geometries, routes, connectivity, spatial, _content_bounds(geometries, document), derived)
        self.scene, self.connectivity, self.spatial_index = scene, connectivity, spatial
        self.metrics['incremental_updates'] += 1
        self.metrics['last_rerouted_wires'] = rerouted
        self.metrics['last_update_ms'] = (time.perf_counter() - started) * 1000
        return scene

    def render_plan(self, viewport: Rect, zoom: float = 1.0) -> dict:
        if self.scene is None:
            raise RuntimeError('reset() must be called first')
        visible_components: set[str] = set()
        visible_wires: set[str] = set()
        for item in self.scene.spatial_index.index.query_rect(viewport):
            if item.value['kind'] in ('component', 'port'):
                visible_components.add(item.value['id'])
            elif item.value['kind'] in ('wire', 'segment'):
                visible_wires.add(item.value['id'])
        lod = 'full' if zoom >= 0.8 else 'medium' if zoom >= 0.25 else 'low'
        return {'revision': self.scene.document.revision, 'lod': lod, 'components': sorted(visible_components), 'wires': sorted(visible_wires), 'viewport': viewport}
