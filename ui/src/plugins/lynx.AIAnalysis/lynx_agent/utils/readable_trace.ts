// Copyright 2025 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import {TraceQuery} from '../tools/trace_query';
import {getTraceEventDesc} from './get_trace_event_desc';

/**
 * Interface for trace event
 */
export interface TraceEvent {
  id: number;
  ts: number;
  dur: number;
  track_id: number;
  name: string;
  depth?: number;
  arg_set_id?: number;
  thread_name?: string;
  thread_tid?: number;
  args?: {[key: string]: any};
  description?: string;
}

/**
 * Interface for readable trace event
 */
interface ReadableTraceEvent {
  id: number;
  ts: number;
  dur: number;
  track_id: number;
  name: string;
  args: {[key: string]: any};
  thread_name: string;
  description: string;
}

/**
 * Convert trace events to tree style format
 * @param traces Array of trace events
 * @returns Tree-styled trace events
 */
function getTreeStyleTraceEvents(
  traces: ReadableTraceEvent[],
): ReadableTraceEvent[] {
  // Simple implementation - in a full implementation, this would
  // organize events into a hierarchical tree structure based on
  // timing relationships and call stacks
  return traces.sort((a, b) => a.ts - b.ts);
}

/**
 * Process traces array and return simplified format with args
 * @param tp Trace processor instance
 * @param traces Array of trace events with fields like id, ts, dur, track_id, name, depth, arg_set_id, etc.
 * @returns Array with simplified trace events containing id, ts, dur, track_id, name, depth, and args
 */
export async function getReadableTrace(
  tp: TraceQuery,
  traces: TraceEvent[],
): Promise<ReadableTraceEvent[]> {
  if (!traces || traces.length === 0) {
    return [];
  }

  // Get all arg_set_id values from traces
  const argSetIds = traces
    .filter((trace) => trace.arg_set_id != null)
    .map((trace) => trace.arg_set_id!);

  if (argSetIds.length === 0) {
    // No args to fetch, return basic info
    return Promise.all(
      traces.map(async (trace) => ({
        id: trace.id,
        ts: trace.ts,
        dur: trace.dur,
        track_id: trace.track_id,
        name: trace.name,
        args: {},
        thread_name: trace.thread_name || `Thread ${trace.thread_tid || ''}`,
        description: (await getTraceEventDesc(trace.name)) || '',
      })),
    );
  }

  // Query args for all arg_set_ids
  const argSetIdsStr = argSetIds.join(',');
  const argsSql = `
    SELECT arg_set_id, key, display_value
    FROM args
    WHERE arg_set_id IN (${argSetIdsStr})
      AND key LIKE 'debug.%'
  `;

  const argsResult = await tp.query(argsSql);

  // Group args by arg_set_id
  const argsBySetId: {[key: number]: {[key: string]: any}} = {};
  for (const arg of argsResult) {
    const argSetId = arg.arg_set_id as number;
    const key = arg.key as string;
    const value = arg.display_value;

    if (!(argSetId in argsBySetId)) {
      argsBySetId[argSetId] = {};
    }

    // Remove 'debug.' prefix from key
    const cleanKey = key.startsWith('debug.') ? key.substring(6) : key;
    if (cleanKey === 'url') {
      continue;
    }
    argsBySetId[argSetId][cleanKey] = value;
  }

  // Build result array
  const result: ReadableTraceEvent[] = [];
  for (const trace of traces) {
    const argSetId = trace.arg_set_id;
    const args = argSetId ? argsBySetId[argSetId] || {} : {};
    let threadName = trace.thread_name || '';
    if (!threadName) {
      threadName = `Thread ${trace.thread_tid || ''}`;
    }

    result.push({
      id: trace.id,
      ts: trace.ts,
      dur: trace.dur,
      track_id: trace.track_id,
      name: trace.name,
      args: args,
      thread_name: threadName,
      description: (await getTraceEventDesc(trace.name)) || '',
    });
  }

  // Apply tree styling
  const styledResult = getTreeStyleTraceEvents(result);

  return styledResult;
}
