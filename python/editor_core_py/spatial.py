from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Generic, TypeVar
from .geometry import rect_bottom, rect_right, rects_intersect
from .model import Point, Rect

T = TypeVar('T')


@dataclass(slots=True)
class SpatialItem(Generic[T]):
    id: str
    bounds: Rect
    value: T
    z_index: int = 0


class UniformGridIndex(Generic[T]):
    def __init__(self, cell_size: float = 128.0):
        if cell_size <= 0:
            raise ValueError('cell_size must be positive')
        self.cell_size = float(cell_size)
        self.buckets: dict[tuple[int, int], set[str]] = {}
        self.items: dict[str, SpatialItem[T]] = {}

    def _cell(self, value: float) -> int:
        return int(value // self.cell_size)

    def _keys(self, bounds: Rect):
        min_x, min_y = self._cell(bounds.x), self._cell(bounds.y)
        max_x, max_y = self._cell(rect_right(bounds)), self._cell(rect_bottom(bounds))
        for y in range(min_y, max_y + 1):
            for x in range(min_x, max_x + 1):
                yield (x, y)

    def insert(self, item: SpatialItem[T]) -> None:
        self.remove(item.id)
        self.items[item.id] = item
        for key in self._keys(item.bounds):
            self.buckets.setdefault(key, set()).add(item.id)

    def remove(self, item_id: str) -> bool:
        old = self.items.pop(item_id, None)
        if old is None:
            return False
        for key in self._keys(old.bounds):
            bucket = self.buckets.get(key)
            if bucket is None:
                continue
            bucket.discard(item_id)
            if not bucket:
                self.buckets.pop(key, None)
        return True

    def query_rect(self, bounds: Rect) -> list[SpatialItem[T]]:
        ids: set[str] = set()
        for key in self._keys(bounds):
            ids.update(self.buckets.get(key, ()))
        result = [self.items[item_id] for item_id in ids if rects_intersect(self.items[item_id].bounds, bounds)]
        result.sort(key=lambda item: (-item.z_index, item.id))
        return result

    def query_point(self, point: Point, tolerance: float = 0.0) -> list[SpatialItem[T]]:
        return self.query_rect(Rect(point.x - tolerance, point.y - tolerance, tolerance * 2, tolerance * 2))


class AdaptiveSpatialIndex(Generic[T]):
    """Multi-resolution grid that prevents giant objects from exploding fine-grid buckets."""

    def __init__(self, cell_sizes: tuple[float, ...] = (64, 256, 1024, 4096), max_cells_per_item: int = 64):
        self.levels = [UniformGridIndex[T](size) for size in sorted(cell_sizes)]
        self.max_cells_per_item = max_cells_per_item
        self.item_level: dict[str, int] = {}
        self.overflow: dict[str, SpatialItem[T]] = {}

    @staticmethod
    def _estimated_cells(bounds: Rect, cell_size: float) -> int:
        return max(1, int(bounds.width // cell_size) + 1) * max(1, int(bounds.height // cell_size) + 1)

    def insert(self, item: SpatialItem[T]) -> None:
        self.remove(item.id)
        for index, level in enumerate(self.levels):
            if self._estimated_cells(item.bounds, level.cell_size) <= self.max_cells_per_item:
                level.insert(item)
                self.item_level[item.id] = index
                return
        self.overflow[item.id] = item
        self.item_level[item.id] = -1

    def remove(self, item_id: str) -> bool:
        level = self.item_level.pop(item_id, None)
        if level is None:
            return False
        if level == -1:
            self.overflow.pop(item_id, None)
        else:
            self.levels[level].remove(item_id)
        return True

    def query_rect(self, bounds: Rect) -> list[SpatialItem[T]]:
        result: dict[str, SpatialItem[T]] = {}
        for level in self.levels:
            for item in level.query_rect(bounds):
                result[item.id] = item
        for item in self.overflow.values():
            if rects_intersect(item.bounds, bounds):
                result[item.id] = item
        return sorted(result.values(), key=lambda item: (-item.z_index, item.id))

    def query_point(self, point: Point, tolerance: float = 0.0) -> list[SpatialItem[T]]:
        return self.query_rect(Rect(point.x - tolerance, point.y - tolerance, tolerance * 2, tolerance * 2))

    @property
    def size(self) -> int:
        return len(self.item_level)
