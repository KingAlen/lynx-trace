import {getTreeStyleTraceEvents} from '../utils/convert_trace_event_style';
import {getTraceEventDesc} from '../utils/get_trace_event_desc';
import {Tool, ToolCallArguments, ToolExecResult, ToolParameter} from './base';
import {TraceQuery} from './trace_query';

const context_window_size_threshold = 128 * 1024 * 0.8;

function isNotEmptyJson(jsonStr: string): boolean {
  try {
    const data = JSON.parse(jsonStr);
    // 检查是否是空字典，或者只有空键值对的字典
    if (
      JSON.stringify(data) === JSON.stringify({'': ''}) ||
      !data ||
      (typeof data === 'object' && Object.keys(data).length === 0)
    ) {
      return false;
    }
    return true;
  } catch (error) {
    // 如果不是有效的JSON，也视为需要过滤
    return false;
  }
}

// 过滤一些 trace 事件
const filterTraceEvents = [
  (s: string) => s.startsWith('LynxEngine::Invoke'),
  (s: string) => s.startsWith('LynxRuntime::Invoke'),
  (s: string) => s.startsWith('NativeFacade::Invoke'),
  (s: string) => s.startsWith('LayoutContext::Invoke'),
  (s: string) => s === 'QuickContext::GetAndCall',
  (s: string) => s === 'RunningInJS',
  (s: string) => s === 'GetStringEnv',
  (s: string) => s === 'GetBoolEnv',
  (s: string) => s === 'GetExternalEnv',
];

function isFilterTraceEvents(eventName: string): boolean {
  for (const rule of filterTraceEvents) {
    if (rule(eventName)) {
      return true;
    }
  }
  return false;
}

const vitalTraceEvents = [
  // 精确匹配规则
  (s: string) => s === 'evaluateJavaScriptBytecode',
];

function isVitalTraceEvent(eventName: string): boolean {
  /**
   * 检查事件名称是否匹配任何 vital_trace 规则
   *
   * @param eventName - 要检查的事件名称
   * @returns 如果匹配任一规则则返回 true，否则返回 false
   */
  for (const rule of vitalTraceEvents) {
    if (rule(eventName)) {
      return true;
    }
  }
  return false;
}

export class TraceQueryTool extends Tool {
  private _traceProcessor: TraceQuery;
  constructor(provider: string, traceProcessor: TraceQuery) {
    super(provider);
    this._traceProcessor = traceProcessor;
  }

  get_name(): string {
    return 'trace_query';
  }

  get_description(): string {
    return `trace_query 工具用于查询 trace 数据库中的事件信息。支持以下查询模式：

1. **time_window_query**: 时间窗口查询
   - 查询指定时间范围内的所有 trace 事件
   - 必需参数: start_ts, end_ts
   - 可选参数: track_id (指定轨道ID)

2. **descendants_query**: 后代查询
   - 查询指定事件的所有子事件
   - 必需参数: slice_id

3. **ancestor_query**: 祖先查询
   - 查询指定事件的所有父事件
   - 必需参数: slice_id

4. **name_query**: 名称查询
   - 根据事件名称查询匹配的事件
   - 必需参数: name
   - 可选参数: slice_id (精确查询特定ID的事件)

5. **id_query**: ID查询
   - 根据事件ID查询特定事件
   - 必需参数: slice_id

6. **flow_query**: 流查询
   - 查询与指定事件相关的流事件
   - 必需参数: slice_id

所有查询都会返回事件的详细信息，包括ID、名称、时间戳、持续时间、轨道ID和参数。`;
  }

  get_parameters(): ToolParameter[] {
    return [
      {
        name: 'mode',
        type: 'string',
        description:
          '查询模式，支持: time_window_query, descendants_query, ancestor_query, name_query, id_query, flow_query',
        enum: [
          'time_window_query',
          'descendants_query',
          'ancestor_query',
          'name_query',
          'id_query',
          'flow_query',
        ],
        items: null,
        required: true,
      },
      {
        name: 'start_ts',
        type: 'number',
        description: '开始时间戳 (time_window_query 模式必需)',
        enum: null,
        items: null,
        required: false,
      },
      {
        name: 'end_ts',
        type: 'number',
        description: '结束时间戳 (time_window_query 模式必需)',
        enum: null,
        items: null,
        required: false,
      },
      {
        name: 'track_id',
        type: 'number',
        description: '轨道ID (time_window_query 模式可选)',
        enum: null,
        items: null,
        required: false,
      },
      {
        name: 'slice_id',
        type: 'number',
        description:
          'Slice ID (descendants_query, ancestor_query, id_query, flow_query 模式必需)',
        enum: null,
        items: null,
        required: false,
      },
      {
        name: 'name',
        type: 'string',
        description: '事件名称 (name_query 模式必需)',
        enum: null,
        items: null,
        required: false,
      },
      {
        name: 'limit',
        type: 'number',
        description: '返回结果数量限制 (默认: 1000)',
        enum: null,
        items: null,
        required: false,
      },
    ];
  }

  async execute(args: ToolCallArguments): Promise<ToolExecResult> {
    return await this.runSQLQuery(args);
  }

  async runSQLQuery(args: ToolCallArguments): Promise<ToolExecResult> {
    const mode = ((args.mode as string) || '').trim();
    let limit = (args.limit as number) || 1000;
    try {
      if (mode === 'time_window_query') {
        const start_ts = args.start_ts as number;
        const end_ts = args.end_ts as number;
        const track_id = args.track_id as number;
        if (start_ts === undefined || end_ts === undefined) {
          return {
            error: JSON.stringify({
              status: 'error',
              message:
                'trace_query tool time_window_query 模式未提供 start_ts 或者 end_ts 参数',
            }),
            error_code: -1,
          };
        }
        const filters = [`s.ts >= ${start_ts}`, `s.ts + s.dur <= ${end_ts}`];
        if (track_id) {
          filters.push(`s.track_id = ${track_id}`);
        }
        const constraints = `WHERE ${filters.join(' and ')}`;

        const sql =
          "SELECT s.id, s.track_id, s.ts, s.dur, s.name, '{' || GROUP_CONCAT( printf('\"%s\": \"%s\"', a.key, a.display_value), ', ') || '}' AS args " +
          'FROM slice s ' +
          'LEFT JOIN args a ON s.arg_set_id = a.arg_set_id ' +
          `${constraints} AND a.key != 'debug.url' ` +
          `GROUP BY s.id ORDER BY s.depth, s.ts`;
        const qr_it = await this._traceProcessor.query(sql);
        const trace_event: any[] = [];
        // const name_set = new Set<string>();
        for (const row of qr_it) {
          if (isFilterTraceEvents(row.name)) {
            continue;
          }
          const event: any = {
            id: row.id,
            name: row.name,
            ts: row.ts,
            dur: row.dur,
            track_id: row.track_id,
          };
          const args = row.args;
          if (isNotEmptyJson(args)) {
            event['args'] = args;
          }
          const desc = await getTraceEventDesc(event.name);
          if (desc) {
            event['description'] = desc;
          }
          trace_event.push(event);
        }
        // const trace_event_desc: any[] = [];
        // for (const name of name_set) {
        //   const desc = await getTraceEventDesc(name);
        //   if (desc) {
        //     trace_event_desc.push({
        //       "name": name,
        //       "desc": desc
        //     });
        //   }
        // }

        const simplified_trace_event = await this._simplifyResult(
          trace_event,
          start_ts,
          end_ts,
        );
        const result = {
          'Trace 事件列表': simplified_trace_event,
          // "Trace 事件对应的描述": trace_event_desc,
        };
        return {
          output: JSON.stringify({'trace_query 查询结果': result}),
        };
      } else if (mode === 'descendants_query' || mode === 'ancestor_query') {
        const slice_id = args.slice_id as number;
        if (slice_id === undefined) {
          return {
            error: JSON.stringify({
              status: 'error',
              message: `trace_query tool ${mode} 模式未提供 slice_id 参数`,
            }),
            error_code: -1,
          };
        }
        const result = await this._recursiveQuery(slice_id, mode, limit);
        return {
          output: JSON.stringify({'trace_query 查询结果': result}),
        };
      } else if (mode === 'name_query') {
        const name = args.name as string;
        const slice_id = args.slice_id as number;
        const filters = [`s.name LIKE "${name}"`, 'a.key != "debug.url"'];
        if (slice_id) {
          filters.push(` s.id = ${slice_id} `);
          limit = 1;
        } else if (limit > 64) {
          limit = 64;
        }
        const constraints = `WHERE ${filters.join(' and ')}`;
        if (name === undefined) {
          return {
            error: JSON.stringify({
              status: 'error',
              message: `trace_query tool ${mode} 模式未提供 name 参数`,
            }),
            error_code: -1,
          };
        }
        let trace_event_json = '{}';
        while (limit >= 1) {
          const sql =
            "SELECT s.id, s.track_id, s.ts, s.dur, s.name, '{' || GROUP_CONCAT( printf('\"%s\": \"%s\"', a.key, a.display_value), ', ') || '}' AS args " +
            'FROM slice s ' +
            'LEFT JOIN args a ON s.arg_set_id = a.arg_set_id ' +
            `${constraints} ` +
            'GROUP BY s.id ORDER BY s.ts ' +
            `LIMIT ${limit}`;
          const qr_it = await this._traceProcessor.query(sql);
          const trace_event: any[] = [];
          for (const row of qr_it) {
            const event: any = {
              id: row.id,
              name: row.name,
              ts: row.ts,
              dur: row.dur,
              track_id: row.track_id,
            };
            const args = row.args;
            if (isNotEmptyJson(args)) {
              event['args'] = args;
            }
            const desc = await getTraceEventDesc(event.name);
            if (desc) {
              event['description'] = desc;
            }
            trace_event.push(event);
          }
          trace_event_json = JSON.stringify(trace_event);
          if (trace_event_json.length > context_window_size_threshold) {
            limit = Math.floor(limit / 2);
          } else {
            break;
          }
        }
        return {
          output: JSON.stringify({
            'trace_query 查询结果': JSON.parse(trace_event_json),
          }),
        };
      } else if (mode === 'id_query') {
        const slice_id = args.slice_id as number;
        if (slice_id === undefined) {
          return {
            error: JSON.stringify({
              status: 'error',
              message: `trace_query tool ${mode} 模式未提供 slice_id 参数`,
            }),
            error_code: -1,
          };
        }
        const sql =
          "SELECT s.id, s.ts, s.dur, s.track_id, s.name,'{' || GROUP_CONCAT( printf('\"%s\": \"%s\"', a.key, a.display_value), ', ') || '}' AS args " +
          `FROM slice s LEFT JOIN args a ON s.arg_set_id = a.arg_set_id WHERE s.id = ${slice_id}`;
        const qr_it = await this._traceProcessor.query(sql);
        const trace_event: any[] = [];
        for (const row of qr_it) {
          if (isFilterTraceEvents(row.name)) {
            continue;
          }
          const event: any = {
            id: row.id,
            name: row.name,
            ts: row.ts,
            dur: row.dur,
            track_id: row.track_id,
          };
          const args = row.args;
          if (isNotEmptyJson(args)) {
            event['args'] = args;
          }
          const desc = await getTraceEventDesc(event.name);
          if (desc) {
            event['description'] = desc;
          }
          trace_event.push(event);
        }
        const trace_event_json = JSON.stringify(trace_event);
        return {
          output: JSON.stringify({'trace_query 查询结果': trace_event_json}),
        };
      } else if (mode === 'flow_query') {
        const slice_id = args.slice_id as number;
        if (slice_id === undefined) {
          return {
            error: JSON.stringify({
              status: 'error',
              message: `trace_query ${mode} 模式未提供 slice_id 参数`,
            }),
            error_code: -1,
          };
        }
        const sql =
          'WITH connected_flows AS ( ' +
          `SELECT slice_out AS slice_id FROM directly_connected_flow(${slice_id}) ` +
          'UNION ALL ' +
          `SELECT slice_in AS slice_id FROM directly_connected_flow(${slice_id}) ` +
          'UNION ALL ' +
          `SELECT slice_out AS slice_id FROM preceding_flow(${slice_id}) ` +
          'UNION ALL ' +
          `SELECT slice_in AS slice_id FROM preceding_flow(${slice_id}) ` +
          '), ' +
          'unique_slice_ids AS ( SELECT DISTINCT slice_id FROM connected_flows ) ' +
          "SELECT s.id,  s.track_id,  s.ts,  s.dur,  s.name, '{' || GROUP_CONCAT(printf('\"%s\": \"%s\"', a.key, a.display_value), ', ') || '}' AS args " +
          'FROM unique_slice_ids usi ' +
          'JOIN slice s ON usi.slice_id = s.id ' +
          "LEFT JOIN args a ON s.arg_set_id = a.arg_set_id AND a.key != 'debug.url' " +
          'GROUP BY s.id ORDER BY s.ts';
        const qr_it = await this._traceProcessor.query(sql);
        const trace_event: any[] = [];
        const name_set = new Set<string>();
        for (const row of qr_it) {
          if (isFilterTraceEvents(row.name)) {
            continue;
          }
          name_set.add(row.name);
          const event: any = {
            id: row.id,
            name: row.name,
            ts: row.ts,
            dur: row.dur,
            track_id: row.track_id,
          };
          const args = row.args;
          if (isNotEmptyJson(args)) {
            event['args'] = args;
          }
          const desc = await getTraceEventDesc(event.name);
          if (desc) {
            event['description'] = desc;
          }
          trace_event.push(event);
        }
        // const trace_event_desc: any[] = [];
        // for (const name of name_set) {
        //   const desc = await getTraceEventDesc(name);
        //   if (desc) {
        //     trace_event_desc.push({
        //       name: name,
        //       desc: desc,
        //     });
        //   }
        // }
        return {
          output: JSON.stringify({
            'trace_query 查询结果': {
              'Trace 事件列表': trace_event,
              // 'Trace 事件对应的描述': trace_event_desc,
            },
          }),
        };
      } else {
        return {
          error: `trace_query mode: ${mode}参数无效。请使用 'time_window_query', 'descendants_query', 'ancestor_query', 'name_query', 'id_query'`,
          error_code: -1,
        };
      }
    } catch (e: any) {
      return {
        error: `trace_query 执行错误: ${e.message}`,
        error_code: -1,
      };
    }
  }

  private async _recursiveQuery(
    slice_id: number,
    direction: string,
    limit: number,
  ): Promise<any> {
    const func =
      direction === 'descendants_query' ? 'descendant_slice' : 'ancestor_slice';
    const sql =
      "SELECT s.id, s.ts, s.dur, s.track_id, s.name, s.depth,'{' || GROUP_CONCAT( printf('\"%s\": \"%s\"', a.key, a.display_value), ', ') || '}' AS args " +
      `FROM slice s LEFT JOIN args a ON s.arg_set_id = a.arg_set_id WHERE s.id = ${slice_id} ` +
      'UNION ALL ' +
      "SELECT d_s.id, d_s.ts, d_s.dur, d_s.track_id, d_s.name, d_s.depth, '{' || GROUP_CONCAT( printf('\"%s\": \"%s\"', a.key, a.display_value), ', ') || '}' AS args " +
      `FROM ${func}(${slice_id}) d_s LEFT JOIN args a ON d_s.arg_set_id = a.arg_set_id AND a.key != "debug.instance_id" GROUP BY d_s.id ORDER BY d_s.depth, d_s.ts LIMIT ${limit}`;
    const qr_it = await this._traceProcessor.query(sql);
    const trace_event: any[] = [];
    // const name_set = new Set<string>();
    for (const row of qr_it) {
      if (isFilterTraceEvents(row.name)) {
        continue;
      }
      const event: any = {
        id: row.id,
        name: row.name,
        ts: row.ts,
        dur: row.dur,
        track_id: row.track_id,
      };
      const args = row.args;
      if (isNotEmptyJson(args)) {
        event['args'] = args;
      }
      const desc = await getTraceEventDesc(event.name);
      if (desc) {
        event['description'] = desc;
      }
      trace_event.push(event);
      // name_set.add(row.name);
    }
    // const trace_event_desc: any[] = [];
    // for (const name of name_set) {
    //   const desc = await getTraceEventDesc(name);
    //   if (desc) {
    //     trace_event_desc.push({
    //       "name": name,
    //       "desc": desc
    //     });
    //   }
    // }
    const query = `select dur, ts from slice where id = ${slice_id}`;
    const query_it = await this._traceProcessor.query(query);
    let start_ts: number | null = null;
    let end_ts: number | null = null;
    for (const row of query_it) {
      start_ts = row.ts;
      end_ts = row.dur + start_ts;
    }
    const simplified_trace_event = await this._simplifyResult(
      trace_event,
      start_ts,
      end_ts,
    );
    if (typeof simplified_trace_event === 'string') {
      return simplified_trace_event;
    }
    return {
      'Trace 事件列表': simplified_trace_event,
      // "Trace 事件对应的描述": trace_event_desc
    };
  }

  private async _simplifyResult(
    trace_event: any[],
    start_ts: number | null = null,
    end_ts: number | null = null,
  ): Promise<any[] | string> {
    let json_result = JSON.stringify(trace_event);
    if (start_ts === null || end_ts === null) {
      return trace_event;
    }
    const duration = end_ts - start_ts;
    let call_stack_duration_threshold = duration * 0.01;
    let trace_event_duration_threshold = duration * 0.001;

    let prev_trace_event_len = trace_event.length;
    while (json_result.length > context_window_size_threshold) {
      console.debug('current json size: ', json_result.length);
      // simplify trace by remove useless callstack tree and keep the flow event
      const remove_trace_ids = await this.callStackIdsToRemove(
        call_stack_duration_threshold,
        start_ts,
        end_ts,
      );
      trace_event = trace_event.filter(
        (row) =>
          !remove_trace_ids.includes(row['id']) ||
          isVitalTraceEvent(row['name']) ||
          ('args' in row &&
            row['args'] &&
            typeof row['args'] === 'object' &&
            ('flow_id' in row['args'] || 'terminateFlowId' in row['args'])),
      );
      trace_event = getTreeStyleTraceEvents(trace_event);
      json_result = JSON.stringify(trace_event);
      if (json_result.length <= context_window_size_threshold) {
        break;
      }

      // simplify trace by remove useless trace event from call stack tree
      const remove_trace_ids2 = await this.traceEventsToRemove(
        trace_event_duration_threshold,
        start_ts,
        end_ts,
      );
      trace_event = trace_event.filter(
        (row) =>
          !remove_trace_ids2.includes(row['id']) ||
          isVitalTraceEvent(row['name']) ||
          ('args' in row &&
            row['args'] &&
            typeof row['args'] === 'object' &&
            ('flow_id' in row['args'] || 'terminateFlowId' in row['args'])),
      );
      trace_event = getTreeStyleTraceEvents(trace_event);
      json_result = JSON.stringify(trace_event);
      console.debug(
        'after simplify trace event, json size: ',
        json_result.length,
      );
      if (json_result.length <= context_window_size_threshold) {
        break;
      }

      if (prev_trace_event_len === trace_event.length) {
        // above tool can not remove any trace event, break
        console.debug(
          'simlify trace tool can not remove any more trace events',
        );
        return '当前查询范围过大，简化 trace 工具无法继续移除 trace 事件，请缩小查询范围';
      }
      prev_trace_event_len = trace_event.length;
      call_stack_duration_threshold *= 2;
      trace_event_duration_threshold *= 2;
    }
    return trace_event;
  }

  private async callStackIdsToRemove(
    threshold: number,
    start_ts: number,
    end_ts: number,
  ): Promise<number[]> {
    const query = `
      SELECT 
          s.id
      FROM slice s
      WHERE s.dur <= ${threshold} AND ((s.depth = 0 AND s.dur=-1) OR s.depth = 1) AND s.ts >= ${start_ts} AND s.ts <= ${end_ts}
    `;
    const results = await this._traceProcessor.query(query);
    const removeTraceIds = new Set<number>();

    for (const row of results) {
      removeTraceIds.add(row.id);
      const childQuery = `
        select id
        from descendant_slice(${row.id})
      `;
      const children = await this._traceProcessor.query(childQuery);
      for (const child of children) {
        removeTraceIds.add(child.id);
      }
    }
    return Array.from(removeTraceIds);
  }

  private async traceEventsToRemove(
    threshold: number,
    start_ts: number,
    end_ts: number,
  ): Promise<number[]> {
    const query = `
      SELECT 
          s.id
      FROM slice s
      WHERE s.dur <= ${threshold} AND s.ts >= ${start_ts} AND s.ts <= ${end_ts}
    `;
    const results = await this._traceProcessor.query(query);
    const removeTraceIds = new Set<number>();

    for (const row of results) {
      removeTraceIds.add(row.id);
    }
    return Array.from(removeTraceIds);
  }
}
