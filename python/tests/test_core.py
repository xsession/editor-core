from editor_core_py import (
    Component, ConnectionPolicy, Document, HarnessEditorEngine, Point, Port,
    Rect, Wire, WireEndpoint, AdaptiveSpatialIndex, SpatialItem,
)


def make_component(cid: str, x: float, y: float) -> Component:
    return Component(
        id=cid,
        position=Point(x, y),
        ports=[
            Port(f'{cid}:in', 'IN', 'west', electrical_class='signal-input', connection_policy=ConnectionPolicy(4)),
            Port(f'{cid}:out', 'OUT', 'east', electrical_class='signal-output', connection_policy=ConnectionPolicy(4)),
        ],
    )


def make_document() -> Document:
    doc = Document(id='test')
    a = make_component('a', 0, 0)
    b = make_component('b', 300, 0)
    doc.components = {'a': a, 'b': b}
    doc.component_order = ['a', 'b']
    wire = Wire('w1', WireEndpoint.port('a', 'a:out'), WireEndpoint.port('b', 'b:in'))
    doc.wires = {'w1': wire}
    doc.wire_order = ['w1']
    return doc


def test_engine_incremental_move_and_undo():
    engine = HarnessEditorEngine(make_document())
    old_route = list(engine.document.wires['w1'].route.points)
    impact = engine.move_components(['a'], Point(50, 20))
    assert 'a' in impact.changed_components
    assert 'w1' in impact.rerouted_wires
    assert impact.routing_obstacle_revision == 1
    assert engine.document.wires['w1'].route.points != old_route
    engine.undo()
    assert engine.document.components['a'].position == Point(0, 0)


def test_connectivity_limit():
    doc = make_document()
    engine = HarnessEditorEngine(doc)
    assert len(engine.runtime.connectivity.wires_for_port('a', 'a:out')) == 1


def test_adaptive_spatial_promotes_large_objects():
    index = AdaptiveSpatialIndex((64, 256, 1024), max_cells_per_item=16)
    index.insert(SpatialItem('small', Rect(0, 0, 20, 20), {'kind': 'small'}))
    index.insert(SpatialItem('large', Rect(-1000, -1000, 2000, 2000), {'kind': 'large'}))
    hits = {item.id for item in index.query_rect(Rect(-10, -10, 20, 20))}
    assert hits == {'small', 'large'}
