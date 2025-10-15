import {TraceEvent} from './readable_trace';

interface TreeStyleTraceEvent extends TraceEvent {
  children?: TreeStyleTraceEvent[];
}

function getTreeStyleTraceEvents(traces: TraceEvent[]): TreeStyleTraceEvent[] {
  /**
   * Convert a list of trace events into a tree structure.
   *
   * @param traces - A list of trace events, where each trace event is an object
   *                 containing at least 'ts' (timestamp), 'dur' (duration), 'name' (event name),
   *                 and optionally 'children' (a list of child trace events).
   *
   * @returns A tree structure of trace events, where each event is an object with the same keys
   *          as the input events, but with an additional 'children' key containing a list of child events.
   */
  // Add 'end_time' field and 'children' for each trace
  const processedTraces: TraceEvent[] = [];
  for (const trace of traces) {
    const traceItem: TreeStyleTraceEvent = {
      id: trace.id,
      ts: trace.ts,
      dur: trace.dur,
      track_id: trace.track_id,
      name: trace.name,
      thread_name: trace.thread_name || '',
      children: [],
    };
    const args = trace.args;
    const description = trace.description;
    if (args) {
      traceItem.args = args;
    }
    if (description) {
      traceItem.description = description;
    }

    processedTraces.push(traceItem);
  }
  processedTraces.sort((a, b) => a.ts - b.ts);

  // Build tree structure
  function buildTree(tracesList: TreeStyleTraceEvent[]): TreeStyleTraceEvent[] {
    if (!tracesList.length) {
      return [];
    }

    const result: TreeStyleTraceEvent[] = [];
    const usedIndices = new Set<number>();

    for (let i = 0; i < tracesList.length; i++) {
      const parent = tracesList[i];
      if (usedIndices.has(i)) {
        continue;
      }

      // Find all possible child nodes
      const children: [number, TraceEvent][] = [];
      for (let j = 0; j < tracesList.length; j++) {
        const child = tracesList[j];
        if (j <= i || usedIndices.has(j)) {
          continue;
        }

        // Check if child is completely contained within parent's time range
        if (
          child.ts > parent.ts &&
          child.ts + child.dur < parent.ts + parent.dur &&
          child.track_id === parent.track_id
        ) {
          children.push([j, child]);
        }
      }

      // If there are child nodes, need to further process nested relationships
      if (children.length > 0) {
        // Sort child nodes by start time
        children.sort((a, b) => a[1].ts - b[1].ts);

        // Recursively build child tree, ensuring correct nested levels
        const childTraces = children.map((child) => child[1]);
        const childIndices = children.map((child) => child[0]);

        // Mark these child nodes as used
        childIndices.forEach((index) => usedIndices.add(index));

        // Recursively build child tree, ensuring correct nested levels
        parent.children = buildTree(childTraces);
      }

      result.push(parent);
    }

    return result;
  }

  // Build tree structure
  const treeResult = buildTree(processedTraces);

  // Clean up temporary fields
  function cleanTempFields(node: TreeStyleTraceEvent): void {
    if ('end_time' in node) {
      delete node.end_time;
    }
    for (const child of node.children || []) {
      cleanTempFields(child);
    }
  }

  for (const node of treeResult) {
    cleanTempFields(node);
  }

  return treeResult;
}

function getFlattenStyleTraceEvents(
  traces: TreeStyleTraceEvent[],
): TraceEvent[] {
  /**
   * Flatten a tree structure of trace events into a list.
   *
   * @param traces - A list of trace events, where each trace event is an object
   *                 containing at least 'ts' (timestamp), 'dur' (duration), 'name' (event name),
   *                 and optionally 'children' (a list of child trace events).
   * @returns A flattened list of trace events, where each event is an object with the same keys
   *          as the input events, but without the 'children' key.
   */
  function flattenTree(node: TreeStyleTraceEvent): TraceEvent[] {
    // Create a copy of the current node, removing the 'children' field
    const flattenedNode: TreeStyleTraceEvent = {
      id: node.id,
      ts: node.ts,
      dur: node.dur,
      track_id: node.track_id,
      name: node.name,
      children: [], // Ensure 'children' field is empty in the flattened node
    };

    // Copy optional fields
    if (node.thread_name !== undefined) {
      flattenedNode.thread_name = node.thread_name;
    }
    if (node.args !== undefined) {
      flattenedNode.args = node.args;
    }
    if (node.description !== undefined) {
      flattenedNode.description = node.description;
    }

    const result: TraceEvent[] = [flattenedNode];

    // Recursively process all child nodes
    for (const child of node.children || []) {
      result.push(...flattenTree(child));
    }

    return result;
  }

  // Flatten all tree nodes
  const result: TraceEvent[] = [];
  for (const node of traces) {
    result.push(...flattenTree(node));
  }
  result.sort((a, b) => a.ts - b.ts);
  return result;
}

export {getTreeStyleTraceEvents, getFlattenStyleTraceEvents};
