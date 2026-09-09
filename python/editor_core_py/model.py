from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Side = Literal['north', 'east', 'south', 'west']
ElectricalClass = Literal[
    'passive', 'power-input', 'power-output', 'signal-input', 'signal-output',
    'bidirectional', 'ground', 'shield', 'unknown'
]


@dataclass(slots=True, frozen=True)
class Point:
    x: float
    y: float


@dataclass(slots=True, frozen=True)
class Rect:
    x: float
    y: float
    width: float
    height: float


@dataclass(slots=True)
class ConnectionPolicy:
    maximum_connections: int = 1
    allow_self_connection: bool = False
    allowed_electrical_classes: set[str] | None = None


@dataclass(slots=True)
class Port:
    id: str
    label: str
    side: Side
    order: int = 0
    electrical_class: ElectricalClass = 'unknown'
    visible: bool = True
    side_fraction: float | None = None
    connection_policy: ConnectionPolicy = field(default_factory=ConnectionPolicy)


@dataclass(slots=True)
class Component:
    id: str
    position: Point
    width: float = 100.0
    height: float = 60.0
    ports: list[Port] = field(default_factory=list)
    designator: str = ''
    locked: bool = False
    hidden: bool = False
    z_index: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class WireEndpoint:
    kind: Literal['port', 'free']
    component_id: str | None = None
    port_id: str | None = None
    point: Point | None = None

    @classmethod
    def port(cls, component_id: str, port_id: str) -> 'WireEndpoint':
        return cls('port', component_id=component_id, port_id=port_id)

    @classmethod
    def free(cls, point: Point) -> 'WireEndpoint':
        return cls('free', point=point)


@dataclass(slots=True)
class RoutingOptions:
    pattern: str = 'orthogonal'
    clearance: float = 12.0
    grid: float = 8.0
    lead_in: float = 20.0
    bend_penalty: float = 32.0
    crossing_penalty: float = 100.0
    proximity_penalty: float = 4.0
    max_search_nodes: int = 20_000
    allow_crossings: bool = True


@dataclass(slots=True)
class RouteResult:
    points: list[Point]
    length: float
    bends: int
    crossings: int = 0
    obstacle_violations: list[str] = field(default_factory=list)
    status: Literal['valid', 'fallback', 'invalid'] = 'valid'
    diagnostics: list[str] = field(default_factory=list)
    generated_at_revision: int | None = None


@dataclass(slots=True)
class Wire:
    id: str
    source: WireEndpoint
    target: WireEndpoint
    routing: RoutingOptions = field(default_factory=RoutingOptions)
    route: RouteResult | None = None
    locked: bool = False
    hidden: bool = False
    z_index: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class Label:
    id: str
    text: str
    owner_kind: Literal['component', 'wire', 'free'] = 'free'
    owner_id: str | None = None
    position: Point = field(default_factory=lambda: Point(0.0, 0.0))
    visible: bool = True


@dataclass(slots=True)
class Document:
    id: str = 'document-1'
    revision: int = 0
    components: dict[str, Component] = field(default_factory=dict)
    wires: dict[str, Wire] = field(default_factory=dict)
    labels: dict[str, Label] = field(default_factory=dict)
    component_order: list[str] = field(default_factory=list)
    wire_order: list[str] = field(default_factory=list)
    label_order: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ComponentGeometry:
    component_id: str
    body: Rect
    port_centers: dict[str, Point]
    port_sides: dict[str, Side]


@dataclass(slots=True)
class MutationImpact:
    changed_components: list[str] = field(default_factory=list)
    changed_ports: list[str] = field(default_factory=list)
    rerouted_wires: list[str] = field(default_factory=list)
    invalidated_wires: list[str] = field(default_factory=list)
    moved_labels: list[str] = field(default_factory=list)
    added_components: list[str] = field(default_factory=list)
    removed_components: list[str] = field(default_factory=list)
    added_wires: list[str] = field(default_factory=list)
    removed_wires: list[str] = field(default_factory=list)
    added_labels: list[str] = field(default_factory=list)
    removed_labels: list[str] = field(default_factory=list)
    changed_obstacles: list[str] = field(default_factory=list)
    dependency_rerouted_wires: list[str] = field(default_factory=list)
    routing_obstacle_revision: int = 0
    routing_topology_revision: int = 0
    routing_environment_revision: int = 0
    full_rebuild: bool = False


@dataclass(slots=True)
class Scene:
    document: Document
    geometries: dict[str, ComponentGeometry]
    routes: dict[str, RouteResult]
    connectivity: Any
    spatial_index: Any
    content_bounds: Rect
    incremental_impact: MutationImpact | None = None
