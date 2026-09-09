from __future__ import annotations

import random
import time
from editor_core_py import Component, ConnectionPolicy, Document, IncrementalSceneRuntime, Point, Port, Rect


def make_document(count: int) -> Document:
    doc = Document(id=f'bench-{count}')
    columns = max(10, int((count * 1.6) ** 0.5))
    for i in range(count):
        cid = f'c{i}'
        c = Component(
            cid,
            Point((i % columns) * 140.0, (i // columns) * 80.0),
            86, 52,
            [
                Port(f'{cid}:in', 'IN', 'west', connection_policy=ConnectionPolicy(8)),
                Port(f'{cid}:out', 'OUT', 'east', connection_policy=ConnectionPolicy(8)),
            ],
        )
        doc.components[cid] = c
        doc.component_order.append(cid)
    return doc


def run(count: int, queries: int = 5000):
    doc = make_document(count)
    runtime = IncrementalSceneRuntime(auto_route=False)
    t0 = time.perf_counter()
    scene = runtime.reset(doc)
    build_ms = (time.perf_counter() - t0) * 1000
    t0 = time.perf_counter()
    hits = 0
    for _ in range(queries):
        p = Point(
            random.uniform(scene.content_bounds.x, scene.content_bounds.x + scene.content_bounds.width),
            random.uniform(scene.content_bounds.y, scene.content_bounds.y + scene.content_bounds.height),
        )
        hits += len(scene.spatial_index.hit_test(scene.document, scene.geometries, p))
    query_ms = (time.perf_counter() - t0) * 1000
    viewport = Rect(scene.content_bounds.x, scene.content_bounds.y, 1600, 900)
    t0 = time.perf_counter()
    plan = runtime.render_plan(viewport)
    plan_ms = (time.perf_counter() - t0) * 1000
    print(f'{count:>6} components | build {build_ms:8.2f} ms | {queries} queries {query_ms:8.2f} ms | plan {plan_ms:7.2f} ms | visible {len(plan["components"]):5} | hits {hits}')


if __name__ == '__main__':
    for size in (1_000, 10_000, 50_000):
        run(size, 2000 if size == 50_000 else 5000)
