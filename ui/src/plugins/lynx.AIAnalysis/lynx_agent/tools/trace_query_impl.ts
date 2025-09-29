import {Tool, ToolCallArguments, ToolExecResult, ToolParameter} from './base';
import {TraceQuery} from './trace_query';

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
    return `
查询 Trace 数据，支持 6 种查询模式:
1. id_query: 根据 Trace 事件的 id 查询 Trace 数据
2. time_window_query：根据 start_ts(纳秒) 和 end_ts(纳秒) 查询指定时间窗口内的事件
3. descendants_query：查询某个 Trace 事件和其子孙事件（调用链下的事件）
4. ancestor_query: 查询某个 Trace 事件和其祖先事件
5. name_query: 查询根据 Trace 名称查询 Trace 数据, 支持 SQL 模式查询
6. flow_query: 查询某个 Trace 事件(根据 slice_id )关联的事件(包括直接关联和间接关联)

Tool 使用指南: 
- 尽量使用 time_window_query, descendants_query 和 ancestor_query, id_query
- name_query: 如果知道 Trace 事件的 id，要求 slice_id 参数

返回字段说明：
- Trace 事件列表: 查询到的 Trace 事件列表
- Trace 事件描述: Trace 事件对应的描述，可以根据 Trace 事件名称找到对应的描述
        `;
  }

  get_parameters(): ToolParameter[] {
    return [
      {
        name: 'mode',
        type: 'string',
        description:
          "查询模式，可选值：'id_query','time_window_query', 'descendants_query', 'ancestor_query', 'name_query'",
        enum: [
          'id_query',
          'time_window_query',
          'descendants_query',
          'ancestor_query',
          'name_query',
          'flow_query',
        ],
        required: true,
      },
      {
        name: 'start_ts',
        type: 'int',
        description:
          "仅在 mode='time_window_query' 时使用，查询开始时间（纳秒）。",
        required: false,
      },
      {
        name: 'end_ts',
        type: 'int',
        description:
          "仅在 mode='time_window_query' 时使用，查询结束时间（纳秒）。",
        required: false,
      },
      {
        name: 'track_id',
        type: 'int',
        description:
          "在 mode='time_window_query' 时使用，目标 Trace 事件的 track id。",
        required: false,
      },
      {
        name: 'name',
        type: 'string',
        description:
          "在 mode='name_query' 时使用，目标 Trace 事件的名称(支持 SQL 模糊查询)。名称可能不全局唯一",
        required: false,
      },
      {
        name: 'limit',
        type: 'int',
        description: '限制返回结果数量，默认 1000。',
        enum: null,
        items: null,
        required: false,
      },
    ];
  }

  async execute(args: ToolCallArguments): Promise<ToolExecResult> {
    try {
      const result = await this.runSQLQuery(args);
      return {
        output: result,
      };
    } catch (error: any) {
      return {
        error: error.message,
        error_code: -1,
      };
    }
  }

  async runSQLQuery(args: ToolCallArguments): Promise<string> {
    const mode = args.mode as string;
    const limitValue = args.limit || 1000;
    const start_ts = args.start_ts as number | undefined;
    const end_ts = args.end_ts as number | undefined;
    const track_id = args.track_id as number | undefined;
    const slice_id = args.slice_id as number | undefined;
    try {
      if (mode === 'time_window_query') {
        if (start_ts === undefined || end_ts === undefined) {
          throw new Error(
            'trace_query tool time_window_query 模式未提供 start_ts 或者 end_ts 参数',
          );
        }

        const filters = [`s.ts >= ${start_ts}`, `s.ts + s.dur <= ${end_ts}`];
        if (track_id !== undefined) {
          filters.push(`s.track_id = ${track_id}`);
        }
        const constraints = `WHERE ${filters.join(' and ')}`;

        const sql = `
                SELECT s.id, s.track_id, s.ts, s.dur, s.name, 
                '{' || GROUP_CONCAT( printf('\"%s\": \"%s\"', a.key, a.display_value), ', ') || '}' AS args 
                FROM slice s 
                LEFT JOIN args a ON s.arg_set_id = a.arg_set_id 
                ${constraints} AND a.key != 'debug.url' 
                GROUP BY s.id ORDER BY s.depth, s.ts
            `;

        return await this._traceProcessor.query(sql);
      } else if (mode === 'descendants_query' || mode === 'ancestor_query') {
        if (slice_id === undefined) {
          throw new Error(`trace_query tool ${mode} 模式未提供 slice_id 参数`);
        }

        const direction =
          mode === 'descendants_query' ? 'descendant' : 'ancestor';
        const sql = `
                WITH RECURSIVE trace_tree AS (
                SELECT id, parent_id, ts, dur, name, track_id, depth
                FROM slice
                WHERE id = ${slice_id}
                UNION ALL
                SELECT s.id, s.parent_id, s.ts, s.dur, s.name, s.track_id, s.depth
                FROM slice s
                INNER JOIN trace_tree t ON ${
                  direction === 'descendant'
                    ? 's.parent_id = t.id'
                    : 't.parent_id = s.id'
                }
                )
                SELECT s.id, s.track_id, s.ts, s.dur, s.name,
                '{' || GROUP_CONCAT( printf('\"%s\": \"%s\"', a.key, a.display_value), ', ') || '}' AS args
                FROM trace_tree tt
                JOIN slice s ON tt.id = s.id
                LEFT JOIN args a ON s.arg_set_id = a.arg_set_id AND a.key != 'debug.url'
                GROUP BY s.id ORDER BY s.ts
                LIMIT ${limitValue}
            `;

        return await this._traceProcessor.query(sql);
      } else if (mode === 'name_query') {
        if (name === undefined) {
          throw new Error(`trace_query tool ${mode} 模式未提供 name 参数`);
        }

        const filters = [`s.name LIKE "${name}"`, 'a.key != "debug.url"'];
        if (slice_id !== undefined) {
          filters.push(`s.id = ${slice_id}`);
        }
        const constraints = `WHERE ${filters.join(' and ')}`;

        const sql = `
                SELECT s.id, s.track_id, s.ts, s.dur, s.name,
                '{' || GROUP_CONCAT( printf('\"%s\": \"%s\"', a.key, a.display_value), ', ') || '}' AS args
                FROM slice s
                LEFT JOIN args a ON s.arg_set_id = a.arg_set_id
                ${constraints}
                GROUP BY s.id ORDER BY s.ts
                LIMIT ${limitValue}
            `;

        return await this._traceProcessor.query(sql);
      } else if (mode === 'id_query') {
        if (slice_id === undefined) {
          throw new Error(`trace_query tool ${mode} 模式未提供 slice_id 参数`);
        }

        const sql = `
                SELECT s.id, s.ts, s.dur, s.track_id, s.name,
                '{' || GROUP_CONCAT( printf('\"%s\": \"%s\"', a.key, a.display_value), ', ') || '}' AS args
                FROM slice s LEFT JOIN args a ON s.arg_set_id = a.arg_set_id
                WHERE s.id = ${slice_id}
            `;

        return await this._traceProcessor.query(sql);
      } else if (mode === 'flow_query') {
        if (slice_id === undefined) {
          throw new Error(`trace_query ${mode} 模式未提供 slice_id 参数`);
        }

        const sql = `
                WITH connected_flows AS (
                SELECT slice_out AS slice_id FROM directly_connected_flow(${slice_id})
                UNION ALL
                SELECT slice_in AS slice_id FROM directly_connected_flow(${slice_id})
                UNION ALL
                SELECT slice_out AS slice_id FROM preceding_flow(${slice_id})
                UNION ALL
                SELECT slice_in AS slice_id FROM preceding_flow(${slice_id})
                ),
                unique_slice_ids AS ( SELECT DISTINCT slice_id FROM connected_flows )
                SELECT s.id, s.track_id, s.ts, s.dur, s.name,
                '{' || GROUP_CONCAT(printf('\"%s\": \"%s\"', a.key, a.display_value), ', ') || '}' AS args
                FROM unique_slice_ids usi
                JOIN slice s ON usi.slice_id = s.id
                LEFT JOIN args a ON s.arg_set_id = a.arg_set_id AND a.key != 'debug.url'
                GROUP BY s.id ORDER BY s.ts
            `;
        return await this._traceProcessor.query(sql);
      } else {
        throw new Error(`不支持的查询模式: ${mode}`);
      }
    } catch (error) {
      throw new Error(
        `查询执行失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
