from __future__ import annotations

from typing import Any, Protocol
from .model import Scene


class RoutingBackend(Protocol):
    def route_scene(self, scene: Scene, **options: Any): ...


class InjectedLibavoidBackend:
    """Adapter for optional SWIG/ctypes libavoid bindings supplied by the host."""
    def __init__(self, adapter: Any):
        self.adapter = adapter

    def route_scene(self, scene: Scene, **options: Any):
        if not hasattr(self.adapter, 'route_scene'):
            raise TypeError('Injected libavoid adapter must implement route_scene(scene, **options)')
        return self.adapter.route_scene(scene, **options)
