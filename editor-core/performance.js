function now() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function percentile(sorted, p) {
    if (sorted.length === 0)
        return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[index];
}

class MetricSeries {
    values = [];
    cursor = 0;
    capacity;

    constructor(capacity) {
        this.capacity = capacity;
    }

    push(value) {
        if (this.values.length < this.capacity)
            this.values.push(value);
        else {
            this.values[this.cursor] = value;
            this.cursor = (this.cursor + 1) % this.capacity;
        }
    }

    snapshot() {
        const sorted = [...this.values].sort((a, b) => a - b);
        const sum = sorted.reduce((total, value) => total + value, 0);
        return {
            count: sorted.length,
            average: sorted.length ? sum / sorted.length : 0,
            min: sorted[0] ?? 0,
            p50: percentile(sorted, 0.50),
            p95: percentile(sorted, 0.95),
            p99: percentile(sorted, 0.99),
            max: sorted[sorted.length - 1] ?? 0,
        };
    }
}

/** Lightweight phase/frame profiler with bounded memory. */
export class EditorPerformanceMonitor {
    capacity;
    series = new Map();
    active = new Map();
    counters = new Map();

    constructor(capacity = 240) {
        this.capacity = Math.max(16, capacity);
    }

    begin(name) {
        this.active.set(name, now());
    }

    end(name) {
        const started = this.active.get(name);
        if (started === undefined)
            return undefined;
        this.active.delete(name);
        const duration = now() - started;
        this.record(name, duration);
        return duration;
    }

    measure(name, fn) {
        const started = now();
        try {
            return fn();
        }
        finally {
            this.record(name, now() - started);
        }
    }

    async measureAsync(name, fn) {
        const started = now();
        try {
            return await fn();
        }
        finally {
            this.record(name, now() - started);
        }
    }

    record(name, milliseconds) {
        let series = this.series.get(name);
        if (!series) {
            series = new MetricSeries(this.capacity);
            this.series.set(name, series);
        }
        series.push(milliseconds);
    }

    increment(name, amount = 1) {
        this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
    }

    snapshot() {
        return {
            metrics: Object.fromEntries([...this.series.entries()].map(([name, series]) => [name, series.snapshot()])),
            counters: Object.fromEntries(this.counters),
        };
    }

    budgetReport(frameBudgetMs = 16.667) {
        const snapshot = this.snapshot();
        const frame = snapshot.metrics.frame;
        return {
            ...snapshot,
            frameBudgetMs,
            healthy60Fps: frame ? frame.p95 <= frameBudgetMs : undefined,
            p95HeadroomMs: frame ? frameBudgetMs - frame.p95 : undefined,
        };
    }

    clear() {
        this.series.clear();
        this.active.clear();
        this.counters.clear();
    }
}

/** Executes optional work only while the current frame remains under budget. */
export class FrameBudgetController {
    frameStarted = 0;
    budgetMs;
    reserveMs;

    constructor(budgetMs = 16.667, reserveMs = 2) {
        this.budgetMs = budgetMs;
        this.reserveMs = reserveMs;
    }

    beginFrame() {
        this.frameStarted = now();
    }

    elapsed() {
        return now() - this.frameStarted;
    }

    remaining() {
        return Math.max(0, this.budgetMs - this.elapsed());
    }

    canRun(estimatedCostMs = 0) {
        return this.remaining() >= estimatedCostMs + this.reserveMs;
    }
}
