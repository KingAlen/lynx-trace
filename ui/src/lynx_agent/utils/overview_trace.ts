// Copyright 2025 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import {TraceQuery} from '../tools/trace_query';
import {getReadableTrace, TraceEvent} from './readable_trace';

/**
 * Interface for overview trace result
 */
export interface OverviewTraceResult {
  bundle_url: string;
  overview_all: any[];
  timing_flags_all: TimingFlagsItem[];
  timing_flags_crop: TimingFlagsItem[];
}

interface TimingFlagsItem {
  timing_flags: string;
  trace_events: any[];
}

interface InstanceData {
  unique_pipeline_id_set: Set<string>;
  unique_timing_flags_set: Set<string>;
  pipeline_id_overview_event_ids: {[key: string]: Set<number>};
  overview_event_ids: Set<number>;
}

/**
 * Query flowId related traces
 * @param tp TraceProcessor instance
 * @param sliceId Slice ID to find related traces
 * @returns Array of related trace events
 */
async function queryFlowIdRelatedTrace(
  tp: TraceQuery,
  sliceId: number,
): Promise<Array<Record<string, any>>> {
  const sql = `
    WITH connected_flows AS (
      SELECT slice_out AS slice_id FROM directly_connected_flow(${sliceId})
      UNION ALL
      SELECT slice_in AS slice_id FROM directly_connected_flow(${sliceId})
      UNION ALL
      SELECT slice_out AS slice_id FROM preceding_flow(${sliceId})
      UNION ALL
      SELECT slice_in AS slice_id FROM preceding_flow(${sliceId})
    ),
    unique_slice_ids AS ( 
      SELECT DISTINCT slice_id FROM connected_flows 
    )
    SELECT s.id, s.track_id, s.ts, s.dur, s.name,
    '{' || GROUP_CONCAT(printf('\"%s\": \"%s\"', a.key, a.display_value), ', ') || '}' AS args
    FROM unique_slice_ids usi
    JOIN slice s ON usi.slice_id = s.id
    LEFT JOIN args a ON s.arg_set_id = a.arg_set_id AND a.key != 'debug.url'
    GROUP BY s.id ORDER BY s.ts
  `;

  return tp.query(sql);
}

/**
 * Check if an event name is a Lynx update event
 * @param eventName Event name to check
 * @returns True if it's a Lynx update event
 */
function lynxUpdateEvent(eventName: string): boolean {
  return (
    eventName === 'TemplateAssembler::CallLepusMethod' ||
    eventName === 'LynxUpdateData' ||
    eventName === 'UpdateComponentData' ||
    eventName === 'LynxLoadTemplate' ||
    eventName === 'UpdateData'
  );
}

/**
 * Get instance info map from trace processor
 * @param tp TraceProcessor instance
 * @returns Map of instance ID to URL
 */
async function getInstanceInfoMap(
  tp: TraceQuery,
): Promise<{[key: string]: string}> {
  const instanceInfoMap: {[key: string]: string} = {};
  const instanceInfoSql = `
    SELECT
      args.key as key,
      args.display_value as value
    FROM slice
    JOIN args ON slice.arg_set_id=args.arg_set_id
    WHERE slice.name='LynxLoadTemplate'
    ORDER BY slice.ts
  `;

  const instanceInfoResult = await tp.query(instanceInfoSql);
  let url = '';
  let instanceId = '';

  for (const instanceInfo of instanceInfoResult) {
    if (instanceInfo.key === 'debug.url') {
      url = instanceInfo.value as string;
    } else if (instanceInfo.key === 'debug.instance_id') {
      instanceId = instanceInfo.value as string;
    }

    if (url && instanceId) {
      instanceInfoMap[instanceId] = url;
      url = '';
      instanceId = '';
    }
  }

  return instanceInfoMap;
}

/**
 * Overview the trace file and generate a readable trace file
 * @param url The URL of the trace file
 * @returns A readable trace file and trace processor instance
 */
export async function overviewTraceImpl(
  tp: TraceQuery,
): Promise<OverviewTraceResult[]> {
  const instanceIdMap: {[key: string]: InstanceData} = {};

  // Step1: find all the trace events with name Timing::Mark.paintEnd and args contain timing_flags
  const timingPaintEndWithPipelineIdSql = `
    SELECT
      s.id AS id,
      MAX(CASE WHEN a2.key = 'debug.pipeline_id' THEN a2.display_value END) AS pipeline_id,
      MAX(CASE WHEN a1.key = 'debug.timing_flags' THEN a1.display_value END) AS timing_flags,
      MAX(CASE WHEN a3.key = 'debug.instance_id' THEN a3.display_value END) AS instance_id
    FROM slice s
    JOIN args a1 ON s.arg_set_id = a1.arg_set_id AND a1.key = 'debug.timing_flags' AND a1.display_value IS NOT NULL AND a1.display_value != ''
    LEFT JOIN args a2 ON s.arg_set_id = a2.arg_set_id AND a2.key = 'debug.pipeline_id'
    LEFT JOIN args a3 ON s.arg_set_id = a3.arg_set_id AND a3.key = 'debug.instance_id'
    WHERE s.name = 'Timing::Mark.paintEnd'
    GROUP BY s.id
  `;

  const timingPaintEndWithPipelineIdTraces = await tp.query(
    timingPaintEndWithPipelineIdSql,
  );

  for (const event of timingPaintEndWithPipelineIdTraces) {
    const instanceId = event.instance_id as string;

    if (!(instanceId in instanceIdMap)) {
      instanceIdMap[instanceId] = {
        // The same pipeline may have multiple paintEnd events, add a set to filter out duplicates.
        unique_pipeline_id_set: new Set<string>(),
        // The same timing_flag may encounter in multiple pipeline_id, add a set to filter out duplicates.
        unique_timing_flags_set: new Set<string>(),
        pipeline_id_overview_event_ids: {},
        overview_event_ids: new Set<number>(),
      };
    }

    const uniquePipelineIdSet =
      instanceIdMap[instanceId].unique_pipeline_id_set;
    const uniqueTimingFlagsSet =
      instanceIdMap[instanceId].unique_timing_flags_set;
    const pipelineIdOverviewEventIds =
      instanceIdMap[instanceId].pipeline_id_overview_event_ids;
    const overviewEventIds = instanceIdMap[instanceId].overview_event_ids;

    const pipelineId = event.pipeline_id as string;
    if (uniquePipelineIdSet.has(pipelineId)) {
      continue;
    }

    const timingFlagsList = (event.timing_flags as string).split(',');
    const filteredTimingFlagsList = timingFlagsList
      .map((flag) => flag.trim())
      .filter((flag) => flag && !uniqueTimingFlagsSet.has(flag));

    const uniqueFilteredTimingFlagsList = [...new Set(filteredTimingFlagsList)];

    if (uniqueFilteredTimingFlagsList.length === 0) {
      continue;
    }

    const filteredTimingFlagsStr = uniqueFilteredTimingFlagsList.join(',');

    for (const flag of uniqueFilteredTimingFlagsList) {
      uniqueTimingFlagsSet.add(flag);
    }
    uniquePipelineIdSet.add(pipelineId);

    pipelineIdOverviewEventIds[filteredTimingFlagsStr] = new Set<number>();
    const currentPipelineOverviewEventIds =
      pipelineIdOverviewEventIds[filteredTimingFlagsStr];
    overviewEventIds.add(event.id as number);

    // Find all the related trace events from `paintEnd` through `flowId`
    currentPipelineOverviewEventIds.add(event.id as number);

    const flowidRelatedTraces = await queryFlowIdRelatedTrace(
      tp,
      event.id as number,
    );

    for (let index = 0; index < flowidRelatedTraces.length; index++) {
      const trace = flowidRelatedTraces[index];
      overviewEventIds.add(trace.id as number);
      currentPipelineOverviewEventIds.add(trace.id as number);

      // We want to know more detail about the first event in the flow
      if (index === 0) {
        const ancestorUpdateDataSql = `
          select *
          FROM ancestor_slice(${trace.id})
          WHERE dur > 0
        `;

        const ancestorUpdateDatas = await tp.query(ancestorUpdateDataSql);

        for (const updateData of ancestorUpdateDatas) {
          if (lynxUpdateEvent(updateData.name as string)) {
            overviewEventIds.add(updateData.id as number);
            currentPipelineOverviewEventIds.add(updateData.id as number);
          }
        }
      }
    }
  }

  // handle each LynxView instance
  const overviewResult: OverviewTraceResult[] = [];
  const instanceInfoMap = await getInstanceInfoMap(tp);

  for (const [instanceId, eventsDetail] of Object.entries(instanceIdMap)) {
    const pipelineIdOverviewEventIds =
      eventsDetail.pipeline_id_overview_event_ids;
    const overviewEventIds = eventsDetail.overview_event_ids;

    const overviewEventIdsStr = Array.from(overviewEventIds).join(',');
    const overviewEventsSql = `
      SELECT s.*, t.name as thread_name, t.tid as thread_tid
      FROM slice s
      JOIN thread_track tt ON s.track_id = tt.id
      JOIN thread t ON tt.utid = t.utid
      WHERE s.id IN (${overviewEventIdsStr})
      ORDER BY s.ts
    `;

    const overviewEvents = await tp.query(overviewEventsSql);
    const readableTraces = await getReadableTrace(
      tp,
      overviewEvents as TraceEvent[],
    );

    const overviewResultInstance: OverviewTraceResult = {
      bundle_url: getBundleFromUrl(instanceInfoMap[instanceId] || ''),
      overview_all: readableTraces,
      timing_flags_all: [],
      timing_flags_crop: [],
    };

    const tracesTimingFlagsAll: TimingFlagsItem[] = [];
    const tracesTimingFlagsCrop: TimingFlagsItem[] = [];
    overviewResultInstance.timing_flags_all = tracesTimingFlagsAll;
    overviewResultInstance.timing_flags_crop = tracesTimingFlagsCrop;
    overviewResult.push(overviewResultInstance);

    const cropTraceIdSet = new Set<number>();

    for (const [pipelineId, eventIds] of Object.entries(
      pipelineIdOverviewEventIds,
    )) {
      const eventIdsStr = Array.from(eventIds).join(',');
      const overviewEventsSql = `
        SELECT s.*, t.name as thread_name, t.tid as thread_tid
        FROM slice s
        JOIN thread_track tt ON s.track_id = tt.id
        JOIN thread t ON tt.utid = t.utid
        WHERE s.id IN (${eventIdsStr})
        ORDER BY s.ts
      `;

      const overviewEvents = await tp.query(overviewEventsSql);
      const readableTraces = await getReadableTrace(
        tp,
        overviewEvents as TraceEvent[],
      );

      const tracesTimingFlags: TimingFlagsItem = {
        timing_flags: pipelineId,
        trace_events: readableTraces,
      };
      tracesTimingFlagsAll.push(tracesTimingFlags);

      const readableTracesCrop = await getReadableTrace(
        tp,
        overviewEvents as TraceEvent[],
      );
      const readableTracesCropFilter: any[] = [];

      // remove the trace event which is in crop_trace_id_set
      let needCrop = true;
      for (const trace of readableTracesCrop) {
        if (!cropTraceIdSet.has(trace.id) || !needCrop) {
          readableTracesCropFilter.push(trace);
          cropTraceIdSet.add(trace.id);
          needCrop = false;
        }
      }

      const tracesTimingFlagsCropItem: TimingFlagsItem = {
        timing_flags: pipelineId,
        trace_events: readableTracesCropFilter,
      };
      tracesTimingFlagsCrop.push(tracesTimingFlagsCropItem);
    }
  }

  // filter the overview_result if there exist more than 3 lynxview instances
  if (overviewResult.length > 3) {
    // sort the overview_result by the number of timing_flags_all
    overviewResult.sort(
      (a, b) => b.timing_flags_all.length - a.timing_flags_all.length,
    );
    return overviewResult.slice(0, 3);
  }

  return overviewResult;
}

function getBundleFromUrl(url: string): string {
  // match /xxx/xxx/template.js
  const pattern1 = /\/([^/]+\/[^/]+)\/template\.js/;
  const match1 = url.match(pattern1);

  if (match1) {
    return match1[1];
  }
  // match bundle=xxx&
  const pattern2 = /bundle=([^&]+)/;
  const match2 = url.match(pattern2);
  if (match2) {
    return match2[1];
  }
  return url;
}
