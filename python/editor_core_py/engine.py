from __future__ import annotations

import copy
from collections.abc import Callable
from .model import Component, Document, MutationImpact, Point, Wire, WireEndpoint
from .runtime import IncrementalSceneRuntime


def _append_unique(target: list[str], values) -> None:
    seen = set(target)
    for value in values:
        if value not in seen:
            seen.add(value)
            target.append(value)


def _wire_semantic(wire: Wire | None):
    if wire is None:
        return None
    clone = copy.deepcopy(wire)
    clone.route = None
    return clone


class HarnessEditorEngine:
    def __init__(self, document: Document | None = None, *, history_limit: int = 200, auto_route: bool = True):
        self.document = copy.deepcopy(document or Document())
        self.history_limit = history_limit
        self.undo_stack: list[tuple[str, Document, Document]] = []
        self.redo_stack: list[tuple[str, Document, Document]] = []
        self.runtime = IncrementalSceneRuntime(auto_route=auto_route)
        self.scene = self.runtime.reset(self.document)
        self.document = copy.deepcopy(self.scene.document)
        self.routing_obstacle_revision = 0
        self.routing_topology_revision = 0
        self.routing_environment_revision = 0
        self.last_impact = MutationImpact(full_rebuild=True)

    def _diff(self, before: Document, after: Document) -> MutationImpact:
        impact = MutationImpact()
        for cid in set(before.components) | set(after.components):
            a, b = before.components.get(cid), after.components.get(cid)
            if a is None and b is not None:
                impact.added_components.append(cid)
            elif a is not None and b is None:
                impact.removed_components.append(cid)
            if a != b:
                impact.changed_components.append(cid)
                _append_unique(impact.changed_ports, [p.id for p in (a.ports if a else [])] + [p.id for p in (b.ports if b else [])])
        for wid in set(before.wires) | set(after.wires):
            a, b = before.wires.get(wid), after.wires.get(wid)
            if a is None and b is not None:
                impact.added_wires.append(wid)
            elif a is not None and b is None:
                impact.removed_wires.append(wid)
            if _wire_semantic(a) != _wire_semantic(b):
                impact.rerouted_wires.append(wid)
        for lid in set(before.labels) | set(after.labels):
            a, b = before.labels.get(lid), after.labels.get(lid)
            if a is None and b is not None:
                impact.added_labels.append(lid)
            elif a is not None and b is None:
                impact.removed_labels.append(lid)
            if a != b:
                impact.moved_labels.append(lid)
        return impact

    def _advance_revisions(self, impact: MutationImpact) -> None:
        obstacle_changed = bool(impact.changed_components or impact.changed_ports)
        topology_changed = bool(impact.added_wires or impact.removed_wires or impact.rerouted_wires)
        if obstacle_changed:
            self.routing_obstacle_revision += 1
            _append_unique(impact.changed_obstacles, impact.changed_components)
        if topology_changed:
            self.routing_topology_revision += 1
        if obstacle_changed or topology_changed:
            self.routing_environment_revision += 1
        impact.routing_obstacle_revision = self.routing_obstacle_revision
        impact.routing_topology_revision = self.routing_topology_revision
        impact.routing_environment_revision = self.routing_environment_revision

    def execute(self, label: str, mutator: Callable[[Document, MutationImpact], None]) -> MutationImpact:
        before = copy.deepcopy(self.document)
        draft = copy.deepcopy(self.document)
        hinted = MutationImpact()
        mutator(draft, hinted)
        authoritative = self._diff(before, draft)
        for name in authoritative.__dataclass_fields__:
            value = getattr(authoritative, name)
            if isinstance(value, list):
                _append_unique(getattr(hinted, name), value)
        self._advance_revisions(hinted)
        draft.revision += 1
        scene = self.runtime.update(draft, hinted)
        self.document = copy.deepcopy(scene.document)
        self.scene = scene
        if scene.incremental_impact:
            _append_unique(hinted.rerouted_wires, scene.incremental_impact.rerouted_wires)
            _append_unique(hinted.dependency_rerouted_wires, scene.incremental_impact.dependency_rerouted_wires)
        self.undo_stack.append((label, before, copy.deepcopy(self.document)))
        if len(self.undo_stack) > self.history_limit:
            self.undo_stack.pop(0)
        self.redo_stack.clear()
        self.last_impact = hinted
        return hinted

    def move_components(self, component_ids: list[str], delta: Point) -> MutationImpact:
        def mutate(draft: Document, impact: MutationImpact):
            for cid in component_ids:
                component = draft.components.get(cid)
                if not component or component.locked:
                    continue
                component.position = Point(component.position.x + delta.x, component.position.y + delta.y)
                impact.changed_components.append(cid)
        return self.execute('Move components', mutate)

    def add_component(self, component: Component) -> MutationImpact:
        def mutate(draft: Document, impact: MutationImpact):
            draft.components[component.id] = copy.deepcopy(component)
            draft.component_order.append(component.id)
            impact.changed_components.append(component.id)
        return self.execute('Add component', mutate)

    def connect_wire(self, wire: Wire) -> MutationImpact:
        self._validate_connection(wire.source, wire.target)
        def mutate(draft: Document, impact: MutationImpact):
            draft.wires[wire.id] = copy.deepcopy(wire)
            draft.wire_order.append(wire.id)
            impact.rerouted_wires.append(wire.id)
        return self.execute('Connect wire', mutate)

    def reconnect_wire(self, wire_id: str, end: str, endpoint: WireEndpoint) -> MutationImpact:
        wire = self.document.wires[wire_id]
        other = wire.target if end == 'source' else wire.source
        self._validate_connection(endpoint if end == 'source' else other, endpoint if end == 'target' else other, excluding_wire_id=wire_id)
        def mutate(draft: Document, impact: MutationImpact):
            setattr(draft.wires[wire_id], end, copy.deepcopy(endpoint))
            impact.rerouted_wires.append(wire_id)
        return self.execute('Reconnect wire', mutate)

    def remove_wire(self, wire_id: str) -> MutationImpact:
        def mutate(draft: Document, impact: MutationImpact):
            draft.wires.pop(wire_id, None)
            draft.wire_order = [wid for wid in draft.wire_order if wid != wire_id]
        return self.execute('Remove wire', mutate)

    def _validate_connection(self, source: WireEndpoint, target: WireEndpoint, excluding_wire_id: str | None = None) -> None:
        if source.kind == target.kind == 'port' and source.component_id == target.component_id and source.port_id == target.port_id:
            raise ValueError('A port cannot be connected to itself.')
        connectivity = self.runtime.connectivity
        for endpoint in (source, target):
            if endpoint.kind != 'port':
                continue
            component = self.document.components.get(endpoint.component_id or '')
            port = next((p for p in component.ports if p.id == endpoint.port_id), None) if component else None
            if port is None:
                raise ValueError(f'Missing port {endpoint.component_id}.{endpoint.port_id}')
            count = len(connectivity.wires_for_port(component.id, port.id)) if connectivity else 0
            if excluding_wire_id and excluding_wire_id in (connectivity.wires_for_port(component.id, port.id) if connectivity else set()):
                count -= 1
            if count >= port.connection_policy.maximum_connections:
                raise ValueError(f'{component.id}.{port.id} reached its connection limit')

    def undo(self) -> MutationImpact | None:
        if not self.undo_stack:
            return None
        label, before, after = self.undo_stack.pop()
        current = copy.deepcopy(self.document)
        impact = self._diff(current, before)
        self._advance_revisions(impact)
        self.document = copy.deepcopy(before)
        self.scene = self.runtime.update(self.document, impact)
        self.redo_stack.append((label, before, after))
        self.last_impact = impact
        return impact

    def redo(self) -> MutationImpact | None:
        if not self.redo_stack:
            return None
        label, before, after = self.redo_stack.pop()
        current = copy.deepcopy(self.document)
        impact = self._diff(current, after)
        self._advance_revisions(impact)
        self.document = copy.deepcopy(after)
        self.scene = self.runtime.update(self.document, impact)
        self.undo_stack.append((label, before, after))
        self.last_impact = impact
        return impact
