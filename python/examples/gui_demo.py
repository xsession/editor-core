"""
tkinter GUI test harness for the ``editor_core_py`` package.

Demonstrates and exercises:
  * mutation-authoritative ``HarnessEditorEngine`` (add / move / connect / remove,
    generic ``execute()`` API);
  * live component dragging with dependency-driven wire rerouting
    (incremental runtime updates, no full rebuild);
  * undo / redo (Ctrl+Z / Ctrl+Y);
  * port-to-port wire creation with connection-policy validation;
  * dependency-free ``layered_layout`` auto-layout;
  * optional ELK (elkjs) and libavoid (WASM) backends through the Node bridge;
  * adaptive spatial index viewport culling + LOD;
  * mutation-impact / routing-revision / metrics status panel;
  * a 100-node stress scene to feel the scaling behaviour.

Run:
    cd python
    python examples/gui_demo.py

Smoke test (no main loop):
    python examples/gui_demo.py --smoke
"""
from __future__ import annotations

import copy
import sys
import threading
import time
from itertools import chain
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import tkinter as tk
import tkinter.font as tkfont
import queue
from tkinter import messagebox

from editor_core_py import (
    Component,
    ConnectionPolicy,
    Document,
    HarnessEditorEngine,
    MutationImpact,
    Point,
    Port,
    Rect,
    Wire,
    WireEndpoint,
    apply_layered_layout,
)
from editor_core_py.node_backends import ElkJsBackend, LibavoidNodeBackend

BG = '#f8fafc'
WIRE = '#64748b'
WIRE_SELECTED = '#e11d48'
COMP_FILL = '#dbeafe'
COMP_FILL_SELECTED = '#bfdbfe'
COMP_OUTLINE = '#1e40af'
COMP_OUTLINE_SELECTED = '#dc2626'
PORT_OUTLINE = '#334155'
PORT_CONNECTED = '#3b82f6'
PENDING = '#f59e0b'


def make_block(cid: str, x: float, y: float) -> Component:
    return Component(
        id=cid,
        position=Point(x, y),
        width=120.0,
        height=70.0,
        designator=cid,
        ports=[
            Port(f'{cid}:in', 'IN', 'west', electrical_class='signal-input',
                 connection_policy=ConnectionPolicy(4)),
            Port(f'{cid}:out', 'OUT', 'east', electrical_class='signal-output',
                 connection_policy=ConnectionPolicy(4)),
        ],
    )


def make_sample_document() -> Document:
    doc = Document(id='sample')
    layout = {
        'U1': (0, 0), 'U2': (300, -140), 'U3': (300, 140),
        'U4': (600, 0), 'U5': (900, -90), 'U6': (1200, 0),
    }
    for cid, (x, y) in layout.items():
        doc.components[cid] = make_block(cid, x, y)
    doc.component_order = list(layout)
    pairs = [('U1', 'U2'), ('U1', 'U3'), ('U2', 'U4'), ('U3', 'U4'), ('U4', 'U5'), ('U5', 'U6')]
    for i, (a, b) in enumerate(pairs, 1):
        doc.wires[f'w{i}'] = Wire(f'w{i}', WireEndpoint.port(a, f'{a}:out'), WireEndpoint.port(b, f'{b}:in'))
        doc.wire_order.append(f'w{i}')
    return doc


class GuiApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title('editor_core_py — GUI test harness')
        root.geometry('1280x820')
        root.configure(bg=BG)

        self.engine = HarnessEditorEngine(make_sample_document())
        self.zoom = 1.0
        self.ox, self.oy = 0.0, 0.0

        self.selected_component: str | None = None
        self.selected_wire: str | None = None
        self.pending: tuple[str, str] | None = None
        self.pending_anchor: Point | None = None
        self._mouse = (0, 0)
        self._drag: dict | None = None
        self._drag_impact: MutationImpact | None = None
        self._pan: tuple[float, float, float, float] | None = None
        self._wire_counter = len(self.engine.document.wires) + 1
        self._comp_counter = len(self.engine.document.components)
        self._last_action = 'sample scene (full rebuild)'
        self._backend_status = 'not checked'
        self._backend_queue: queue.Queue = queue.Queue()
        self._backend_kind: str | None = None
        self._backend_job = None

        self.font = tkfont.Font(family='Segoe UI', size=10)
        self.small_font = tkfont.Font(family='Segoe UI', size=9)

        self._build_toolbar()
        paned = tk.PanedWindow(root, orient=tk.HORIZONTAL, bg=BG)
        paned.pack(fill=tk.BOTH, expand=True, padx=6, pady=(0, 4))
        self.canvas = tk.Canvas(paned, bg=BG, highlightthickness=0, cursor='crosshair')
        paned.add(self.canvas, stretch='always')
        stats_frame = tk.Frame(paned, bg=BG, width=320)
        paned.add(stats_frame, stretch='never')
        tk.Label(stats_frame, text='Scene / engine status', font=self.font, bg=BG, anchor='w').pack(fill=tk.X, padx=8, pady=(8, 2))
        self.stats = tk.Text(stats_frame, width=44, height=26, state=tk.DISABLED, bg='#0f172a',
                             fg='#e2e8f0', font=tkfont.Font(family='Consolas', size=9), relief=tk.FLAT, wrap=tk.NONE)
        self.stats.pack(fill=tk.BOTH, expand=True, padx=8, pady=(0, 8))
        self.msg = tk.Label(root, text='', font=self.small_font, bg=BG, anchor='w',
                            textvariable=None, foreground='#334155')
        self.msg.pack(fill=tk.X, padx=10, pady=(0, 6))
        self._set_msg('left-drag component = move (live re-route) · click two ports = connect · '
                      'click wire + Del = remove · Ctrl+Z / Ctrl+Y · wheel = zoom · right/middle-drag = pan')

        self.canvas.bind('<ButtonPress-1>', self.on_press)
        self.canvas.bind('<B1-Motion>', self.on_motion)
        self.canvas.bind('<ButtonRelease-1>', self.on_release)
        self.canvas.bind('<ButtonPress-2>', self.on_pan_start)
        self.canvas.bind('<ButtonPress-3>', self.on_pan_start)
        self.canvas.bind('<B2-Motion>', self.on_pan_move)
        self.canvas.bind('<B3-Motion>', self.on_pan_move)
        self.canvas.bind('<ButtonRelease-2>', self.on_pan_end)
        self.canvas.bind('<ButtonRelease-3>', self.on_pan_end)
        self.canvas.bind('<MouseWheel>', self.on_wheel)
        self.root.bind('<Escape>', self.on_escape)
        self.root.bind('<Delete>', self.on_delete)
        self.root.bind('<BackSpace>', self.on_delete)
        self.root.bind('<Control-z>', lambda e: self.do_undo())
        self.root.bind('<Control-y>', lambda e: self.do_redo())
        self.root.bind('<Control-Shift-Z>', lambda e: self.do_redo())

        self._fitted = False
        self.canvas.bind('<Configure>', self._on_configure)
        self.redraw()
        self.refresh_stats()
        self.root.after(50, self._poll_backend_queue)

    def _on_configure(self, _event) -> None:
        if not self._fitted and self.canvas.winfo_width() > 100:
            self._fitted = True
            self.fit_view()

    # ------------------------------------------------------------------ view

    def _build_toolbar(self) -> None:
        bar = tk.Frame(self.root, bg=BG)
        bar.pack(fill=tk.X, padx=6, pady=6)
        buttons = [
            ('Add block', self.add_component),
            ('Layered layout', self.do_layered),
            ('ELK layout (Node)', self.do_elk),
            ('libavoid route (Node)', self.do_libavoid),
            ('Stress: 100 nodes', self.do_stress),
            ('Fit view', self.fit_view),
            ('Undo', self.do_undo),
            ('Redo', self.do_redo),
        ]
        self._buttons: dict[str, tk.Button] = {}
        for label, cmd in buttons:
            b = tk.Button(bar, text=label, font=self.small_font, command=cmd)
            b.pack(side=tk.LEFT, padx=(0, 6))
            self._buttons[label] = b

    def w2s(self, p: Point) -> tuple[float, float]:
        return ((p.x - self.ox) * self.zoom, (p.y - self.oy) * self.zoom)

    def s2w(self, sx: float, sy: float) -> tuple[float, float]:
        return (sx / self.zoom + self.ox, sy / self.zoom + self.oy)

    def viewport(self) -> Rect:
        return Rect(self.ox, self.oy, self.canvas.winfo_width() / self.zoom, self.canvas.winfo_height() / self.zoom)

    def fit_view(self) -> None:
        b = self.engine.scene.content_bounds
        w = max(10, self.canvas.winfo_width())
        h = max(10, self.canvas.winfo_height())
        if b.width <= 0 or b.height <= 0:
            return
        self.zoom = max(0.05, min(2.0, min(w / b.width, h / b.height) * 0.92))
        self.ox = (b.x + b.width / 2) - (w / 2) / self.zoom
        self.oy = (b.y + b.height / 2) - (h / 2) / self.zoom
        self.redraw()
        self.refresh_stats()

    def on_wheel(self, event) -> None:
        factor = 1.1 ** (event.delta / 120)
        new_zoom = max(0.05, min(10.0, self.zoom * factor))
        if new_zoom == self.zoom:
            return
        wx, wy = self.s2w(event.x, event.y)
        self.zoom = new_zoom
        self.ox = wx - event.x / new_zoom
        self.oy = wy - event.y / new_zoom
        self.redraw()
        self.refresh_stats()

    def on_pan_start(self, event) -> None:
        self._pan = (event.x, event.y, self.ox, self.oy)

    def on_pan_move(self, event) -> None:
        if not self._pan:
            return
        sx, sy, ox0, oy0 = self._pan
        self.ox = ox0 - (event.x - sx) / self.zoom
        self.oy = oy0 - (event.y - sy) / self.zoom
        self.redraw()

    def on_pan_end(self, _event) -> None:
        self._pan = None

    def on_escape(self, _event) -> None:
        self.pending = None
        self.pending_anchor = None
        self.selected_component = None
        self.selected_wire = None
        self.redraw()
        self.refresh_stats()

    # ------------------------------------------------------------------ hits

    def _hit(self, sx: float, sy: float):
        scene = self.engine.scene
        wx, wy = self.s2w(sx, sy)
        hits = scene.spatial_index.hit_test(scene.document, scene.geometries, Point(wx, wy), 7.0)
        return hits[0] if hits else None

    # ------------------------------------------------------------------ press

    def on_press(self, event) -> None:
        hit = self._hit(event.x, event.y)
        if hit is None:
            self.selected_component = None
            self.selected_wire = None
            self.redraw()
            self.refresh_stats()
            return
        scene = self.engine.scene
        if hit['kind'] == 'port':
            cid, pid = hit['id'], hit['sub_id']
            if self.pending is None:
                self.pending = (cid, pid)
                self.pending_anchor = scene.geometries[cid].port_centers[pid]
                self._set_msg(f'connecting from {cid}.{pid} — click a target port (Esc cancels)')
            elif self.pending == (cid, pid):
                self.pending = None
                self.pending_anchor = None
                self._set_msg('connection cancelled')
            else:
                src = self.pending
                self.pending = None
                self.pending_anchor = None
                self.connect_ports(src, (cid, pid))
            self.redraw()
            return
        if hit['kind'] == 'wire':
            self.selected_wire = hit['id']
            self.selected_component = None
            self.redraw()
            self.refresh_stats()
            return
        if hit['kind'] == 'component':
            self.selected_component = hit['id']
            self.selected_wire = None
            p0 = self.engine.document.components[hit['id']].position
            self._drag = {
                'cids': [hit['id']],
                'orig': {hit['id']: Point(p0.x, p0.y)},
                'sx': event.x,
                'sy': event.y,
                'active': False,
                'pre': copy.deepcopy(self.engine.document),
            }
            self.redraw()
            self.refresh_stats()
            return

    # ------------------------------------------------------------------ motion

    def on_motion(self, event) -> None:
        self._mouse = (event.x, event.y)
        if self._pan:
            self.on_pan_move(event)
            return
        if self.pending:
            self.redraw()
            return
        drag = self._drag
        if drag is None:
            return
        if not drag['active'] and abs(event.x - drag['sx']) + abs(event.y - drag['sy']) > 4:
            drag['active'] = True
        if not drag['active']:
            return
        dx = (event.x - drag['sx']) / self.zoom
        dy = (event.y - drag['sy']) / self.zoom
        doc = copy.deepcopy(self.engine.document)
        impact = MutationImpact()
        for cid, orig in drag['orig'].items():
            doc.components[cid].position = Point(orig.x + dx, orig.y + dy)
            impact.changed_components.append(cid)
        scene = self.engine.runtime.update(doc, impact)
        self.engine.scene = scene
        self.engine.document = copy.deepcopy(scene.document)
        self._drag_impact = impact
        self.redraw()

    def on_release(self, _event) -> None:
        drag = self._drag
        self._drag = None
        if drag is None:
            return
        if drag['active']:
            post = copy.deepcopy(self.engine.document)
            self.engine.undo_stack.append(('Drag components', drag['pre'], post))
            if len(self.engine.undo_stack) > self.engine.history_limit:
                self.engine.undo_stack.pop(0)
            self.engine.redo_stack.clear()
            self.engine.last_impact = self._drag_impact
            self._last_action = 'Drag components (live incremental re-route)'
            self._set_msg('drag committed as one history entry — Ctrl+Z undoes the whole drag')
            self.refresh_stats()

    # ------------------------------------------------------------------ actions

    def connect_ports(self, src: tuple[str, str], dst: tuple[str, str]) -> None:
        wid = f'w{self._wire_counter}'
        self._wire_counter += 1
        wire = Wire(wid, WireEndpoint.port(*src), WireEndpoint.port(*dst))
        try:
            self.engine.connect_wire(wire)
        except ValueError as exc:
            messagebox.showerror('Connection rejected', str(exc))
            self._set_msg(f'connect failed: {exc}')
            self.refresh_stats()
            return
        self._last_action = f'Connect wire {wid} ({src[0]}.{src[1]} → {dst[0]}.{dst[1]})'
        self._set_msg(f'wire {wid} created and routed by the visibility/A* router')
        self.refresh_stats()

    def add_component(self) -> None:
        self._comp_counter += 1
        cid = f'U{self._comp_counter}'
        wx, wy = self.s2w(self.canvas.winfo_width() / 2, self.canvas.winfo_height() / 2)
        self.engine.add_component(make_block(cid, wx, wy))
        self.selected_component = cid
        self.selected_wire = None
        self._last_action = f'Add component {cid}'
        self.redraw()
        self.refresh_stats()

    def do_layered(self) -> None:
        apply_layered_layout(self.engine)
        self._last_action = 'Layered auto-layout (dependency-free)'
        self.selected_component = None
        self.selected_wire = None
        self.fit_view()
        self._set_msg('dependency-free layered layout applied as a single history entry')

    def do_undo(self) -> None:
        impact = self.engine.undo()
        if impact is None:
            self._set_msg('nothing to undo')
            return
        self._last_action = f'Undo (revisions: obstacle={impact.routing_obstacle_revision} ' \
                            f'topology={impact.routing_topology_revision})'
        self.selected_component = None
        self.selected_wire = None
        self.redraw()
        self.refresh_stats()

    def do_redo(self) -> None:
        impact = self.engine.redo()
        if impact is None:
            self._set_msg('nothing to redo')
            return
        self._last_action = 'Redo'
        self.redraw()
        self.refresh_stats()

    def on_delete(self, _event) -> None:
        doc = self.engine.document
        if self.selected_wire and self.selected_wire in doc.wires:
            wid = self.selected_wire
            self.engine.remove_wire(wid)
            self.selected_wire = None
            self._last_action = f'Remove wire {wid}'
        elif self.selected_component and self.selected_component in doc.components:
            cid = self.selected_component

            def mutate(draft: Document, impact: MutationImpact) -> None:
                for w in list(draft.wires.values()):
                    if w.source.component_id == cid or w.target.component_id == cid:
                        draft.wires.pop(w.id, None)
                        draft.wire_order = [x for x in draft.wire_order if x != w.id]
                        impact.removed_wires.append(w.id)
                draft.components.pop(cid, None)
                draft.component_order = [x for x in draft.component_order if x != cid]
                impact.changed_components.append(cid)
                impact.removed_components.append(cid)

            self.engine.execute(f'Remove component {cid}', mutate)
            self.selected_component = None
            self._last_action = f'Remove component {cid} + attached wires (generic execute())'
        else:
            return
        self.redraw()
        self.refresh_stats()

    # ------------------------------------------------------- Node backends

    def _run_backend(self, kind: str) -> None:
        for b in self._buttons.values():
            b.configure(state=tk.DISABLED)
        self._set_msg(f'{kind}: calling Node backend (subprocess, may take a few seconds)...')
        self._backend_kind = kind
        self._backend_job = self._backend_elk if kind == 'elk' else self._backend_libavoid
        threading.Thread(target=self._backend_worker, daemon=True).start()

    def _backend_worker(self) -> None:
        kind = self._backend_kind
        t0 = time.perf_counter()
        try:
            result = self._backend_job()
            ms = (time.perf_counter() - t0) * 1000
            self._backend_queue.put((True, kind, result, ms))
        except Exception as exc:  # noqa: BLE001 — surface any bridge failure
            err = str(exc).splitlines()[0] if str(exc) else exc.__class__.__name__
            self._backend_queue.put((False, kind, err, 0.0))

    def _backend_elk(self) -> dict[str, Point]:
        scene = self.engine.scene
        result = ElkJsBackend().layout_scene(scene)
        return {c['id']: Point(c['x'] + c['width'] / 2, c['y'] + c['height'] / 2)
                for c in result['children'] if c.get('width')}

    def _backend_libavoid(self) -> dict:
        scene = self.engine.scene
        return LibavoidNodeBackend().route_scene(scene)

    def _poll_backend_queue(self) -> None:
        try:
            ok, kind, result, ms = self._backend_queue.get_nowait()
        except queue.Empty:
            ok = None
        if ok is not None:
            for b in self._buttons.values():
                b.configure(state=tk.NORMAL)
            if ok:
                self._apply_backend_result(kind, result, ms)
            else:
                self._backend_status = f'{kind} unavailable'
                self._set_msg(f'{kind} failed: {result} (run: cd python/node_bridge && npm install)')
                self.refresh_stats()
        self.root.after(50, self._poll_backend_queue)

    def _apply_backend_result(self, kind: str, result, ms: float) -> None:
        self._backend_status = f'{kind} ok in {ms:.0f} ms'
        if kind == 'elk':
            positions = result

            def mutate(draft: Document, impact: MutationImpact) -> None:
                for cid, pos in positions.items():
                    if cid in draft.components:
                        draft.components[cid].position = pos
                        impact.changed_components.append(cid)

            self.engine.execute('ELK auto-layout (elkjs via Node bridge)', mutate)
            self._last_action = 'ELK auto-layout (elkjs via Node bridge)'
            self.selected_component = None
            self.selected_wire = None
            self.fit_view()
        else:
            routes = result

            def mutate(draft: Document, impact: MutationImpact) -> None:
                for wid, route in routes.items():
                    if wid in draft.wires:
                        draft.wires[wid].route = copy.deepcopy(route)

            self.engine.execute(f'libavoid route ×{len(routes)} (WASM via Node bridge)', mutate)
            self._last_action = f'libavoid routed {len(routes)} wires (WASM via Node bridge)'
            self.redraw()
        self._set_msg(f'{kind} ok in {ms:.0f} ms')
        self.refresh_stats()

    def do_elk(self) -> None:
        self._run_backend('elk')

    def do_libavoid(self) -> None:
        self._run_backend('libavoid')

    # ------------------------------------------------------------- stress

    def do_stress(self) -> None:
        import random
        rng = random.Random(42)
        count = 100
        cols = 14
        doc = Document(id='stress')
        grid: list[list[str]] = []
        n = 0
        for row in range(8):
            grid.append([])
            for col in range(cols):
                if n >= count:
                    break
                n += 1
                cid = f'U{n}'
                doc.components[cid] = make_block(cid, col * 170, row * 120)
                doc.component_order.append(cid)
                grid[-1].append(cid)
        seen: set[frozenset] = set()
        wid = 0
        for row in range(len(grid)):
            for col in range(len(grid[row])):
                src = grid[row][col]
                candidates = []
                if row + 1 < len(grid) and col < len(grid[row + 1]):
                    candidates.append(grid[row + 1][col])
                if col + 1 < len(grid[row]):
                    candidates.append(grid[row][col + 1])
                if row + 1 < len(grid) and col + 1 < len(grid[row + 1]):
                    candidates.append(grid[row + 1][col + 1])
                for dst in rng.sample(candidates, min(len(candidates), rng.choice([1, 1, 2, 3]))):
                    key = frozenset((src, dst))
                    if key in seen:
                        continue
                    seen.add(key)
                    wid += 1
                    doc.wires[f'w{wid}'] = Wire(f'w{wid}', WireEndpoint.port(src, f'{src}:out'),
                                                 WireEndpoint.port(dst, f'{dst}:in'))
                    doc.wire_order.append(f'w{wid}')
        t0 = time.perf_counter()
        self.engine = HarnessEditorEngine(doc)
        build_ms = (time.perf_counter() - t0) * 1000
        self.selected_component = None
        self.selected_wire = None
        self.pending = None
        self._wire_counter = len(doc.wires) + 1
        self._comp_counter = len(doc.components)
        self._last_action = f'Stress scene: {count} blocks, {wid} wires'
        self.fit_view()
        self._set_msg(f'built {count} components / {wid} wires + full route set in {build_ms:.0f} ms — '
                      'drag a block to watch dependency-driven local rerouting')

    # -------------------------------------------------------------- render

    def redraw(self) -> None:
        c = self.canvas
        c.delete('all')
        scene = self.engine.scene
        doc = self.engine.document
        geo = scene.geometries
        plan = scene.spatial_index is not None and self.engine.runtime.render_plan(self.viewport(), self.zoom) or None
        vis_c = set(plan['components']) if plan else None
        vis_w = set(plan['wires']) if plan else None
        z = self.zoom

        for wid in doc.wire_order:
            if vis_w is not None and wid not in vis_w:
                continue
            wire = doc.wires.get(wid)
            if not wire or wire.hidden or not wire.route or len(wire.route.points) < 2:
                continue
            flat = list(chain.from_iterable(self.w2s(p) for p in wire.route.points))
            selected = self.selected_wire == wid
            if z < 0.15 and not selected:
                continue
            c.create_line(*flat, fill=WIRE_SELECTED if selected else WIRE,
                          width=2.4 if selected else 1.3, joinstyle='miter')
        for cid in doc.component_order:
            comp = doc.components[cid]
            if comp.hidden or (vis_c is not None and cid not in vis_c):
                continue
            g = geo.get(cid)
            if g is None:
                continue
            x1, y1 = self.w2s(Point(g.body.x, g.body.y))
            x2, y2 = self.w2s(Point(g.body.x + g.body.width, g.body.y + g.body.height))
            selected = self.selected_component == cid
            c.create_rectangle(x1, y1, x2, y2,
                               fill=COMP_FILL_SELECTED if selected else COMP_FILL,
                               outline=COMP_OUTLINE_SELECTED if selected else COMP_OUTLINE,
                               width=2 if selected else 1)
            if z > 0.18:
                c.create_text((x1 + x2) / 2, (y1 + y2) / 2 - 6, text=comp.designator or cid, font=self.font)
                if z > 0.35:
                    c.create_text((x1 + x2) / 2, (y1 + y2) / 2 + 12, text=cid, font=self.small_font, fill='#64748b')
            if z > 0.12:
                connected = scene.connectivity.connected_port_ids(cid) if scene.connectivity else set()
                for pid, p in g.port_centers.items():
                    sx, sy = self.w2s(p)
                    is_src = self.pending is not None and self.pending == (cid, pid)
                    c.create_oval(sx - 5, sy - 5, sx + 5, sy + 5,
                                  fill=PENDING if is_src else (PORT_CONNECTED if pid in connected else 'white'),
                                  outline=PORT_OUTLINE)
        if self.pending and self.pending_anchor is not None:
            ax, ay = self.w2s(self.pending_anchor)
            c.create_line(ax, ay, self._mouse[0], self._mouse[1], fill=PENDING, width=2, dash=(6, 3))

    # ---------------------------------------------------------------- stats

    def _set_msg(self, text: str) -> None:
        self.msg.configure(text=text)

    def refresh_stats(self) -> None:
        scene = self.engine.scene
        doc = self.engine.document
        m = self.engine.runtime.metrics
        impact = self.engine.last_impact
        plan = self.engine.runtime.render_plan(self.viewport(), self.zoom)
        connectivity = scene.connectivity
        lines = [
            f'revision          {doc.revision}',
            f'last action       {self._last_action}',
            '',
            f'update            {m["last_update_ms"]:.2f} ms',
            f'full rebuilds     {m["full_rebuilds"]}',
            f'incremental       {m["incremental_updates"]}',
            f'last rerouted     {m["last_rerouted_wires"]} wires',
            '',
            f'impact rerouted   {len(impact.rerouted_wires) if impact else 0}',
            f'impact dep-routed {len(impact.dependency_rerouted_wires) if impact else 0}',
            f'obstacle revision {impact.routing_obstacle_revision if impact else 0}',
            f'topology revision {impact.routing_topology_revision if impact else 0}',
            f'env revision      {impact.routing_environment_revision if impact else 0}',
            '',
            f'spatial items     {scene.spatial_index.index.size if scene.spatial_index else 0}',
            f'port links        {sum(len(v) for v in connectivity.port_wires.values()) if connectivity else 0}',
            f'LOD               {plan["lod"]}  (zoom {self.zoom:.2f})',
            f'visible now       {len(plan["components"])} comp / {len(plan["wires"])} wires',
            f'                    (of {len(doc.component_order)} / {len(doc.wire_order)} — spatial culling)',
            '',
            f'undo / redo       {len(self.engine.undo_stack)} / {len(self.engine.redo_stack)}',
            f'selected          '
            f'{self.selected_component or self.selected_wire or "-"}',
            f'node backends     {self._backend_status}',
        ]
        self.stats.configure(state=tk.NORMAL)
        self.stats.delete('1.0', tk.END)
        self.stats.insert(tk.END, '\n'.join(lines))
        self.stats.configure(state=tk.DISABLED)


def main() -> None:
    smoke = '--smoke' in sys.argv
    root = tk.Tk()
    app = GuiApp(root)
    if smoke:
        app.add_component()
        src_cid = app.selected_component
        app.connect_ports((src_cid, f'{src_cid}:out'), ('U1', 'U1:in'))
        app.engine.move_components(['U1'], Point(40, -20))
        app.do_undo()
        app.do_redo()
        app.do_stress()
        app.redraw()
        root.update_idletasks()
        print(f'SMOKE OK — revision={app.engine.document.revision}, '
              f'components={len(app.engine.document.component_order)}, '
              f'wires={len(app.engine.document.wire_order)}, '
              f'undo_depth={len(app.engine.undo_stack)}')
        root.destroy()
        return
    root.mainloop()


if __name__ == '__main__':
    main()
