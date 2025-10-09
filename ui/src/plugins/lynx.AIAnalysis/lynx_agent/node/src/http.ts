// Copyright 2025 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

const protos = require('./protos.js');

// Use dynamic import for fetch to handle ESM
let fetch: any;
if (typeof globalThis !== 'undefined' && (globalThis as any).fetch) {
  fetch = (globalThis as any).fetch;
} else {
  // Fallback for older Node.js versions
  fetch = eval('require')('node-fetch');
}

export interface TraceReference {
  source: 'FILE' | 'URL';
  file?: string;
  url?: string;
}

/**
 * HTTP client for communicating with trace processor.
 * Corresponds to Python's TraceProcessorHttp.
 */
export class TraceProcessorHttpClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Execute a SQL query against the trace processor.
   */
  async executeQuery(sql: string): Promise<any> {
    const queryArgs = protos.perfetto.protos.QueryArgs.create({
      sqlQuery: sql,
    });

    const requestBuffer =
      protos.perfetto.protos.QueryArgs.encode(queryArgs).finish();

    const response = await fetch(`${this.baseUrl}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-protobuf',
      },
      body: requestBuffer,
    });

    if (!response.ok) {
      throw new Error(`Query failed: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const responseBuffer = new Uint8Array(arrayBuffer);

    if (responseBuffer.length === 0) {
      throw new Error('Empty response from server');
    }

    try {
      const queryResult =
        protos.perfetto.protos.QueryResult.decode(responseBuffer);
      if (queryResult.error) {
        throw new Error(`Query error: ${queryResult.error}`);
      }
      return queryResult;
    } catch (error) {
      throw new Error(`Failed to decode query response: ${error}`);
    }
  }

  /**
   * Compute metrics for the loaded trace.
   */
  async computeMetric(metrics: string[]): Promise<any> {
    const metricArgs = protos.perfetto.protos.ComputeMetricArgs.create({
      metricNames: metrics,
      format: protos.perfetto.protos.ComputeMetricArgs.ResultFormat.TEXTPROTO,
    });

    const requestBuffer =
      protos.perfetto.protos.ComputeMetricArgs.encode(metricArgs).finish();

    const response = await fetch(`${this.baseUrl}/compute_metric`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-protobuf',
      },
      body: requestBuffer,
    });

    if (!response.ok) {
      throw new Error(`Compute metric failed: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const responseBuffer = new Uint8Array(arrayBuffer);

    if (responseBuffer.length === 0) {
      throw new Error('Empty response from server');
    }

    try {
      const metricResult =
        protos.perfetto.protos.ComputeMetricResult.decode(responseBuffer);
      return metricResult;
    } catch (error) {
      throw new Error(`Failed to decode metric response: ${error}`);
    }
  }

  /**
   * Parse trace data.
   */
  async parse(trace: TraceReference): Promise<void> {
    if (trace.source === 'FILE' && trace.file) {
      const fs = await import('fs');
      const data = fs.readFileSync(trace.file);
      console.log('Sending trace file:', trace.file);
      const response = await fetch(`${this.baseUrl}/parse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: data,
      });

      if (!response.ok) {
        throw new Error(`Parse failed: ${response.statusText}`);
      }

      // Check if there's any response content
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > 0) {
        // Handle protobuf response if present
        const responseBuffer = new Uint8Array(arrayBuffer);
        try {
          const result =
            protos.perfetto.protos.AppendTraceDataResult.decode(responseBuffer);
          if (result.error) {
            throw new Error(`Parse failed: ${result.error}`);
          }
        } catch (error) {
          // If it's not a valid protobuf, that's okay for parse endpoint
          console.warn('Could not decode response as protobuf:', error);
        }
      }
    } else {
      throw new Error('Only FILE source is supported');
    }
  }

  /**
   * Notify trace processor that no more data will be sent.
   */
  async notifyEof(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/notify_eof`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Notify EOF failed: ${response.statusText}`);
    }
  }

  /**
   * Get status of the trace processor.
   */
  async getStatus(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/status`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Get status failed: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const responseBuffer = new Uint8Array(arrayBuffer);

    if (responseBuffer.length === 0) {
      return {};
    }

    try {
      const statusResult =
        protos.perfetto.protos.StatusResult.decode(responseBuffer);
      return statusResult;
    } catch (error) {
      throw new Error(`Failed to decode status response: ${error}`);
    }
  }

  /**
   * Enable metatrace.
   */
  async enableMetatrace(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/enable_metatrace`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`Enable metatrace failed: ${response.statusText}`);
    }
  }

  /**
   * Disable and read metatrace.
   */
  async disableAndReadMetatrace(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/disable_and_read_metatrace`, {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(
        `Disable and read metatrace failed: ${response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const responseBuffer = new Uint8Array(arrayBuffer);

    if (responseBuffer.length === 0) {
      return {};
    }

    try {
      const metatraceResult =
        protos.perfetto.protos.DisableAndReadMetatraceResult.decode(
          responseBuffer,
        );
      return metatraceResult;
    } catch (error) {
      throw new Error(`Failed to decode metatrace response: ${error}`);
    }
  }
}
