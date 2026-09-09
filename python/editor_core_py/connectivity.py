from __future__ import annotations

from .model import Document, Wire


class MutableConnectivityIndex:
    def __init__(self, document: Document | None = None):
        self.component_ports: dict[str, set[str]] = {}
        self.component_wires: dict[str, set[str]] = {}
        self.port_wires: dict[tuple[str, str], set[str]] = {}
        self.wire_endpoints: dict[str, list[tuple[str, str]]] = {}
        if document is not None:
            self.reset(document)

    def reset(self, document: Document) -> 'MutableConnectivityIndex':
        self.component_ports.clear()
        self.component_wires.clear()
        self.port_wires.clear()
        self.wire_endpoints.clear()
        for wire_id in document.wire_order:
            wire = document.wires.get(wire_id)
            if wire:
                self.upsert_wire(wire)
        return self

    @staticmethod
    def _endpoints(wire: Wire) -> list[tuple[str, str]]:
        result: list[tuple[str, str]] = []
        for endpoint in (wire.source, wire.target):
            if endpoint.kind == 'port' and endpoint.component_id and endpoint.port_id:
                result.append((endpoint.component_id, endpoint.port_id))
        return result

    def remove_wire(self, wire_id: str) -> bool:
        endpoints = self.wire_endpoints.pop(wire_id, None)
        if endpoints is None:
            return False
        for component_id, port_id in endpoints:
            wires = self.component_wires.get(component_id)
            if wires:
                wires.discard(wire_id)
                if not wires:
                    self.component_wires.pop(component_id, None)
            port_wires = self.port_wires.get((component_id, port_id))
            if port_wires:
                port_wires.discard(wire_id)
                if not port_wires:
                    self.port_wires.pop((component_id, port_id), None)
                    ports = self.component_ports.get(component_id)
                    if ports:
                        ports.discard(port_id)
                        if not ports:
                            self.component_ports.pop(component_id, None)
        return True

    def upsert_wire(self, wire: Wire) -> 'MutableConnectivityIndex':
        self.remove_wire(wire.id)
        endpoints = self._endpoints(wire)
        self.wire_endpoints[wire.id] = endpoints
        for component_id, port_id in endpoints:
            self.component_ports.setdefault(component_id, set()).add(port_id)
            self.component_wires.setdefault(component_id, set()).add(wire.id)
            self.port_wires.setdefault((component_id, port_id), set()).add(wire.id)
        return self

    def apply(self, document: Document, wire_ids: set[str] | list[str]) -> None:
        for wire_id in wire_ids:
            wire = document.wires.get(wire_id)
            if wire:
                self.upsert_wire(wire)
            else:
                self.remove_wire(wire_id)

    def connected_port_ids(self, component_id: str) -> set[str]:
        return self.component_ports.get(component_id, set())

    def wires_for_component(self, component_id: str) -> set[str]:
        return self.component_wires.get(component_id, set())

    def wires_for_port(self, component_id: str, port_id: str) -> set[str]:
        return self.port_wires.get((component_id, port_id), set())
