import {getFlattenStyleTraceEvents} from './convert_trace_event_style';

let crypto: any = null;
let fs: any = null;
let os: any = null;
let path: any = null;
let http: any = null;
let url: any = null;

if (
  typeof process !== 'undefined' &&
  process.versions &&
  process.versions.node
) {
  try {
    crypto = require('crypto');
    fs = require('fs');
    os = require('os');
    path = require('path');
    http = require('http');
    url = require('url');
  } catch (e) {
    // ignore type error in browser environment
  }
}

export async function pipelineOverviewCharts(
  traceResult: any,
): Promise<string[]> {
  const timingFlagsAll = traceResult.timing_flags_all || [];
  const overviewTraceChartUrls: string[] = [];
  for (const timingFlag of timingFlagsAll) {
    const traceEvents = timingFlag.trace_events;
    const chartUrl = await overviewTraceToChartUrl(traceEvents);
    if (chartUrl) {
      overviewTraceChartUrls.push(chartUrl);
    }
  }
  return overviewTraceChartUrls;
}

export async function overviewTraceToChartUrl(
  overviewTrace: any,
): Promise<string | null> {
  const overviewChartUrlPrefix =
    'https://trace-overview-diagram.gf.bytedance.net?traceData=';

  if (typeof overviewTrace === 'string') {
    overviewTrace = JSON.parse(overviewTrace);
  }
  overviewTrace = getFlattenStyleTraceEvents(overviewTrace);
  const charEvents = convertToChartTraceEvent(overviewTrace);
  // save to local file
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const chartEventsStr = JSON.stringify(charEvents);

  if (!crypto || !fs || !os || !path) {
    // for browser environment
    const randomNum = Math.random() * 100000 + 1;
    const pipelineFileName = `trace_pipeline-${randomNum}-${timestamp}.log`;
    const pipelineFile = new File([chartEventsStr], pipelineFileName, {
      type: 'text/plain',
    });
    const pipelineFileUrl = await uploadContentToTos(
      pipelineFile,
      pipelineFileName,
    );
    return overviewChartUrlPrefix + encodeURIComponent(pipelineFileUrl);
  } else {
    // for node.js environment
    const chartEventsHash = crypto
      .createHash('md5')
      .update(chartEventsStr)
      .digest('hex');
    const fileName = `${timestamp}_${chartEventsHash}.json`;
    const localFilePath = path.join(os.tmpdir(), fileName);
    fs.writeFileSync(localFilePath, chartEventsStr);
    const tosUrl = await uploadFileToTos(localFilePath);
    if (!tosUrl) {
      return null;
    }
    return overviewChartUrlPrefix + encodeURIComponent(tosUrl);
  }
}

async function uploadContentToTos(
  file: File,
  filename: string,
): Promise<string> {
  const requestUrl = 'https://y65nq31v.fn.bytedance.net';
  const formData = new FormData();
  formData.append('file', file);
  formData.append('relativePath', 'trace_files');
  formData.append('filename', filename);

  const response = await fetchWithTimeout(
    `${requestUrl}/uploadToTOS`,
    {
      method: 'post',
      body: formData,
    },
    -1,
  );
  const res = await response.json();
  if (res['code'] === 0) {
    return res['message'];
  }
  return '';
}

function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit,
  timeoutMs: number,
) {
  return new Promise<Response>((resolve, reject) => {
    let timer = undefined;
    if (timeoutMs > 0) {
      timer = setTimeout(
        () =>
          reject(new Error(`fetch(${input}) timed out after ${timeoutMs} ms`)),
        timeoutMs,
      );
    }
    fetch(input, init)
      .then((response) => resolve(response))
      .catch((err) => reject(err))
      .finally(() => {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      });
  });
}

export function convertToChartTraceEvent(traceEvents: any[]): any[] {
  const flowStartId = new Set<string>();
  const flowEndId = new Set<string>();

  for (let i = 0; i < traceEvents.length; i++) {
    const traceEventBegin = traceEvents[i];
    // Add flow event for the same flow event
    if (traceEventBegin.args && traceEventBegin.args.flowId) {
      const flowId = traceEventBegin.args.flowId;

      // find the first trace event with same flowId/terminateFlowId
      let traceEventEnd = null;
      for (let j = i + 1; j < traceEvents.length; j++) {
        if (traceEvents[j].args) {
          if (
            traceEvents[j].args.flowId &&
            traceEvents[j].args.flowId === flowId
          ) {
            traceEventEnd = traceEvents[j];
            break;
          } else if (
            traceEvents[j].args.terminateFlowId &&
            traceEvents[j].args.terminateFlowId === flowId
          ) {
            traceEventEnd = traceEvents[j];
            break;
          }
        }
      }

      if (traceEventEnd) {
        flowStartId.add(traceEventBegin.id);
        flowEndId.add(traceEventEnd.id);
      }
    }
  }

  const chartTraceEvents: any[] = [];
  for (const traceEvent of traceEvents) {
    // Only the `paintEnd` event displays a bubble.
    if (traceEvent.name !== 'Timing::Mark.paintEnd') {
      // add flow end event
      if (flowEndId.has(traceEvent.id)) {
        chartTraceEvents.push({
          pid: traceEvent.thread_name,
          name: traceEvent.name,
          id: traceEvent.args.flowId || traceEvent.args.terminateFlowId,
          ph: 'f',
          ts: traceEvent.ts / 1000000,
        });
      }

      chartTraceEvents.push({
        pid: traceEvent.thread_name,
        name: traceEvent.name,
        ts: traceEvent.ts / 1000000,
        dur: traceEvent.dur / 1000000,
        ph: 'B',
        args: traceEvent.args,
      });

      // add flow start event for instant trace event
      if (flowStartId.has(traceEvent.id) && traceEvent.dur === 0) {
        chartTraceEvents.push({
          pid: traceEvent.thread_name,
          name: traceEvent.name,
          id: traceEvent.args.flowId,
          ph: 's',
          ts: traceEvent.ts / 1000000,
        });
      }

      chartTraceEvents.push({
        pid: traceEvent.thread_name,
        name: traceEvent.name,
        ts: (traceEvent.ts + traceEvent.dur) / 1000000,
        ph: 'E',
        args: traceEvent.args,
      });

      // add flow start event
      if (flowStartId.has(traceEvent.id) && traceEvent.dur > 0) {
        chartTraceEvents.push({
          pid: traceEvent.thread_name,
          name: traceEvent.name,
          id: traceEvent.args.flowId,
          ph: 's',
          ts: traceEvent.ts / 1000000,
        });
      }
    } else {
      if (flowEndId.has(traceEvent.id)) {
        chartTraceEvents.push({
          pid: traceEvent.thread_name,
          name: traceEvent.name,
          id: traceEvent.args.flowId || traceEvent.args.terminateFlowId,
          ph: 'f',
          ts: traceEvent.ts / 1000000,
        });
      }

      // show the timing_flags instead of trace event name
      chartTraceEvents.push({
        pid: traceEvent.thread_name,
        name: paintEndToTimingFlag(traceEvent),
        ts: traceEvent.ts / 1000000,
        ph: 'R',
        args: traceEvent.args,
      });

      if (flowStartId.has(traceEvent.id)) {
        chartTraceEvents.push({
          pid: traceEvent.thread_name,
          name: traceEvent.name,
          id: traceEvent.args.flowId,
          ph: 's',
          ts: traceEvent.ts / 1000000,
        });
      }
    }
  }

  chartTraceEvents.sort((a, b) => a.ts - b.ts);
  return chartTraceEvents;
}

export function paintEndToTimingFlag(traceEvent: any): string {
  if (traceEvent.args && traceEvent.args.timing_flags) {
    let flags = traceEvent.args.timing_flags;
    if (flags.includes(',')) {
      const flagSet = new Set(
        flags.split(',').map((flag: string) => flag.trim()),
      );
      flags = Array.from(flagSet).join(',');
    }
    return flags;
  }
  return traceEvent.name;
}

export async function uploadFileToTos(
  filePath: string,
  fileName?: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      if (!http || !url || !fs || !path) {
        console.warn(
          'uploadFileToTos: Node.js modules not available in browser environment',
        );
        resolve(null);
        return;
      }

      const fileContent = fs.readFileSync(filePath, 'utf-8');

      const boundary = '----formdata-' + Math.random().toString(36);
      const fileNameToUse = fileName || path.basename(filePath);

      const formData = [
        `--${boundary}`,
        `Content-Disposition: form-data; name="file"; filename="${fileNameToUse}"`,
        'Content-Type: application/json',
        '',
        fileContent,
        `--${boundary}--`,
        '',
      ].join('\r\n');

      const CDN_URL =
        'http://app.bytedance.net/UploadToInhouseTOS?relative_path=maoyu/lala/';
      const parsedUrl = url.parse(CDN_URL);

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 80,
        path: parsedUrl.path,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(formData),
        },
      };

      const req = http.request(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: any) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const jsonRes = JSON.parse(data);
            if (jsonRes.result !== 'success') {
              console.error(
                `upload_file_to_cdn failed, file_path: ${filePath}, file_name: ${fileName}, json_res:`,
                jsonRes,
              );
              resolve(null);
            } else {
              resolve(jsonRes.data);
            }
          } catch (parseError) {
            console.error('Error parsing response:', parseError);
            resolve(null);
          }
        });
      });

      req.on('error', (error: any) => {
        console.error('Error uploading file to TOS:', error);
        resolve(null);
      });

      req.write(formData);
      req.end();
    } catch (error) {
      console.error('Error uploading file to TOS:', error);
      resolve(null);
    }
  });
}
