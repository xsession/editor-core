import type { ComponentGeometry, EditorDocument, EntityId, LabelPlacement, ValidationIssue, WireEndpoint } from './types.js';

function endpointKey(endpoint: WireEndpoint): string | undefined {
  if (endpoint.kind !== 'port') return undefined;
  return `${endpoint.componentId}:${endpoint.portId}`;
}

function endpointEntityIds(endpoint: WireEndpoint): EntityId[] {
  if (endpoint.kind === 'port') return [endpoint.componentId, endpoint.portId];
  if (endpoint.kind === 'junction') return [endpoint.junctionId];
  return [];
}

export function validateDocument(
  document: EditorDocument,
  componentGeometries: Record<EntityId, ComponentGeometry> = {},
  labelPlacements: Record<EntityId, LabelPlacement> = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const connectionCounts = new Map<string, number>();

  for (const componentId of document.componentOrder) {
    const component = document.components[componentId];
    if (!component) {
      issues.push({
        id: `missing-component-order:${componentId}`,
        severity: 'error',
        code: 'ORDER_REFERENCE_MISSING',
        message: `Component order references missing component ${componentId}.`,
        entityIds: [componentId],
        suggestedAction: 'Remove the stale order entry or restore the component.',
      });
      continue;
    }
    const portIds = new Set<string>();
    for (const port of component.ports) {
      if (portIds.has(port.id)) {
        issues.push({
          id: `duplicate-port:${component.id}:${port.id}`,
          severity: 'error',
          code: 'DUPLICATE_PORT_ID',
          message: `${component.designator} contains duplicate port identifier ${port.id}.`,
          entityIds: [component.id, port.id],
        });
      }
      portIds.add(port.id);
    }
    for (const bank of component.pinBanks) {
      for (const portId of bank.portIds) {
        if (!portIds.has(portId)) {
          issues.push({
            id: `bank-port-missing:${component.id}:${bank.id}:${portId}`,
            severity: 'error',
            code: 'BANK_PORT_MISSING',
            message: `Pin bank ${bank.id} references missing port ${portId}.`,
            entityIds: [component.id, portId],
          });
        }
      }
    }
    const geometry = componentGeometries[component.id];
    if (geometry && (geometry.worldBody.width <= 0 || geometry.worldBody.height <= 0)) {
      issues.push({
        id: `component-size:${component.id}`,
        severity: 'error',
        code: 'NON_POSITIVE_COMPONENT_SIZE',
        message: `${component.designator} resolves to a non-positive body size.`,
        entityIds: [component.id],
      });
    }
  }

  for (const wireId of document.wireOrder) {
    const wire = document.wires[wireId];
    if (!wire) {
      issues.push({
        id: `missing-wire-order:${wireId}`,
        severity: 'error',
        code: 'ORDER_REFERENCE_MISSING',
        message: `Wire order references missing wire ${wireId}.`,
        entityIds: [wireId],
      });
      continue;
    }
    for (const endpoint of [wire.source, wire.target]) {
      if (endpoint.kind === 'port') {
        const component = document.components[endpoint.componentId];
        const port = component?.ports.find((candidate) => candidate.id === endpoint.portId);
        if (!component || !port) {
          issues.push({
            id: `wire-endpoint-missing:${wire.id}:${endpoint.componentId}:${endpoint.portId}`,
            severity: 'error',
            code: 'WIRE_ENDPOINT_MISSING',
            message: `Wire ${wire.label ?? wire.id} references a missing component port.`,
            entityIds: [wire.id, ...endpointEntityIds(endpoint)],
            suggestedAction: 'Reconnect the endpoint or restore the removed port.',
          });
          continue;
        }
        const key = endpointKey(endpoint)!;
        connectionCounts.set(key, (connectionCounts.get(key) ?? 0) + 1);
      }
    }
    if (!wire.route || wire.route.points.length < 2) {
      issues.push({
        id: `wire-unrouted:${wire.id}`,
        severity: 'warning',
        code: 'WIRE_UNROUTED',
        message: `Wire ${wire.label ?? wire.id} has no usable visual route.`,
        entityIds: [wire.id],
        suggestedAction: 'Run auto-route or add route constraints.',
      });
    } else if (wire.route.status === 'invalid') {
      issues.push({
        id: `wire-route-invalid:${wire.id}`,
        severity: 'error',
        code: 'WIRE_ROUTE_INVALID',
        message: `Wire ${wire.label ?? wire.id} intersects an obstacle or has unresolved endpoint geometry.`,
        entityIds: [wire.id, ...wire.route.obstacleViolations],
        suggestedAction: 'Move the component, move a waypoint, or rerun the obstacle router.',
      });
    } else if (wire.route.status === 'fallback') {
      issues.push({
        id: `wire-route-fallback:${wire.id}`,
        severity: 'warning',
        code: 'WIRE_ROUTE_FALLBACK',
        message: `Wire ${wire.label ?? wire.id} uses a fallback route.`,
        entityIds: [wire.id],
        suggestedAction: 'Review keep-outs or raise the routing search budget.',
      });
    }
  }

  for (const component of Object.values(document.components)) {
    for (const port of component.ports) {
      const count = connectionCounts.get(`${component.id}:${port.id}`) ?? 0;
      if (count > port.connectionPolicy.maximumConnections) {
        issues.push({
          id: `port-overloaded:${component.id}:${port.id}`,
          severity: 'error',
          code: 'PORT_CONNECTION_LIMIT',
          message: `${component.designator}.${port.label} has ${count} connections; the limit is ${port.connectionPolicy.maximumConnections}.`,
          entityIds: [component.id, port.id],
          suggestedAction: 'Remove a connection, increase the explicit policy, or add a modeled splice.',
        });
      }
    }
  }

  for (const label of Object.values(document.labels)) {
    if (!label.visible) continue;
    if (label.anchor.ownerId) {
      const ownerExists =
        label.anchor.ownerKind === 'component' || label.anchor.ownerKind === 'group' || label.anchor.ownerKind === 'port'
          ? Boolean(document.components[label.anchor.ownerId])
          : label.anchor.ownerKind === 'wire'
            ? Boolean(document.wires[label.anchor.ownerId])
            : true;
      if (!ownerExists) {
        issues.push({
          id: `label-owner-missing:${label.id}`,
          severity: 'warning',
          code: 'LABEL_OWNER_MISSING',
          message: `Label ${label.id} references a missing owner.`,
          entityIds: [label.id, label.anchor.ownerId],
          suggestedAction: 'Reattach the label or convert it to a free label.',
        });
      }
    }
  }


  for (const wire of Object.values(document.wires)) {
    const route = wire.route;
    if (!route || route.points.length < 2) continue;
    for (const [segmentIndex, segment] of route.segments.entries()) {
      if (segment.axis === 'diagonal') {
        issues.push({
          id: `wire-diagonal:${wire.id}:${segmentIndex}`,
          severity: 'error',
          code: 'WIRE_NON_ORTHOGONAL_SEGMENT',
          message: `Wire ${wire.label ?? wire.id} contains a diagonal segment in an orthogonal route.`,
          entityIds: [wire.id],
          suggestedAction: 'Orthogonalize the route or replace the offending manual waypoint.',
        });
      }
      if (segment.length > 0 && segment.length < Math.max(0, wire.routing.minimumSegment)) {
        issues.push({
          id: `wire-short-segment:${wire.id}:${segmentIndex}`,
          severity: 'warning',
          code: 'WIRE_SEGMENT_BELOW_MINIMUM',
          message: `Wire ${wire.label ?? wire.id} has a ${segment.length.toFixed(2)} unit segment below its ${wire.routing.minimumSegment} unit minimum.`,
          entityIds: [wire.id],
          suggestedAction: 'Move the adjacent waypoint or reduce the route minimum segment rule.',
        });
      }
    }
    for (let pointIndex = 1; pointIndex < route.cornerRadii.length - 1; pointIndex += 1) {
      const radius = route.cornerRadii[pointIndex] ?? 0;
      const incoming = route.segments[pointIndex - 1]?.length ?? 0;
      const outgoing = route.segments[pointIndex]?.length ?? 0;
      const safeMaximum = Math.max(0, Math.min(incoming, outgoing) / 2);
      if (radius > safeMaximum + 1e-6) {
        issues.push({
          id: `wire-radius-unsafe:${wire.id}:${pointIndex}`,
          severity: 'error',
          code: 'WIRE_BEND_RADIUS_UNSAFE',
          message: `Wire ${wire.label ?? wire.id} has a bend radius larger than adjacent segments permit.`,
          entityIds: [wire.id],
          suggestedAction: 'Clamp the radius or increase spacing around the bend.',
        });
      }
      if (wire.routing.requestedRadius > radius + 0.01 && safeMaximum >= wire.routing.requestedRadius) {
        issues.push({
          id: `wire-radius-unexpected-clamp:${wire.id}:${pointIndex}`,
          severity: 'info',
          code: 'WIRE_BEND_RADIUS_CLAMPED',
          message: `Wire ${wire.label ?? wire.id} bend ${pointIndex} was clamped below the requested radius.`,
          entityIds: [wire.id],
        });
      }
    }
  }

  for (const placement of Object.values(labelPlacements)) {
    if (placement.status === 'invalid-anchor') {
      issues.push({
        id: `label-placement-invalid:${placement.labelId}`,
        severity: 'error',
        code: 'LABEL_PLACEMENT_INVALID',
        message: `Label ${placement.labelId} cannot resolve its anchor.`,
        entityIds: [placement.labelId],
        suggestedAction: 'Choose a valid component, port, wire, or free point anchor.',
      });
    } else if (placement.status === 'overlap') {
      issues.push({
        id: `label-placement-overlap:${placement.labelId}`,
        severity: 'warning',
        code: 'LABEL_OVERLAP',
        message: `Label ${placement.labelId} overlaps ${placement.collisions.length} visual object(s).`,
        entityIds: [placement.labelId, ...placement.collisions],
        suggestedAction: 'Drag the label, permit a leader, or rerun automatic label placement.',
      });
    }
  }

  return issues.sort((a, b) => {
    const rank = { error: 0, warning: 1, info: 2 } as const;
    return rank[a.severity] - rank[b.severity] || a.code.localeCompare(b.code) || a.id.localeCompare(b.id);
  });
}
