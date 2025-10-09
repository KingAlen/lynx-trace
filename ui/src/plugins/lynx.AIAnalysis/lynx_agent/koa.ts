import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from 'koa-router';
import {AgentConfig} from './utils/config';
import {TraceQuery} from './tools/trace_query';
import TraceProcessor, {
  TraceProcessorConfig,
  TraceProcessorException,
} from './node/src';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import {URL} from 'url';
import {v4 as uuidv4} from 'uuid';
import {VerboseLogger} from './utils/cli/verbose_logger';
import {trace_analysis_impl} from './trace_analysis_impl';
import {generate_feishu_doc} from './utils/feishu_doc';

export interface TraceAnalysisRequest {
  trace_url: string;
  chat_id: string;
  email: string | undefined;
  union_id: string | undefined;
  overview: boolean;
  message_id: string;
  verbose: boolean;
  evaluate: boolean;
  prompt: string | undefined;
}

const koaApp = new Koa();
const router = new Router();
koaApp.use(bodyParser());

koaApp.use(async (ctx: Koa.DefaultContext, next) => {
  const origin = ctx.headers.origin || '';
  ctx.set('Access-Control-Allow-Origin', origin);
  ctx.set('Access-Control-Allow-Credentials', 'true');
  ctx.set('Access-Control-Allow-Methods', 'GET, POST');
  await next();
});

router.post('/chat/message', async (ctx: Koa.DefaultContext) => {
  ctx.set('Access-Control-Allow-Headers', 'x-tt-logid, Authorization');
  ctx.set('Content-Type', 'text/event-stream');
  ctx.set('Cache-Control', 'no-cache');
  ctx.set('Connection', 'keep-alive');
  ctx.set('Access-Control-Allow-Origin', '*');
  if (!ctx.request.body.trace_url) {
    ctx.body = {
      error: 'trace_url is required',
    };
    ctx.status = 400;
    return;
  }

  const result = await trace_analysis(ctx.request.body as TraceAnalysisRequest);
  ctx.body = result;
  console.log('trace analysis result is: ', result);
  ctx.status = 200;
});

// Health check endpoint
router.get('/v1/ping', async (ctx) => {
  ctx.body = 'ok';
});

// Use router
koaApp.use(router.routes());
koaApp.use(router.allowedMethods());

const trace_analysis = async (request: TraceAnalysisRequest) => {
  const agent_config: AgentConfig = {
    max_steps: 20,
    model: {
      model: process.env.MODEL_NAME || '',
      model_provider: {
        api_key: process.env.API_KEY || '',
        provider: process.env.MODEL_PROVIDER || '',
        base_url: process.env.BASE_URL || '',
      },
      parallel_tool_calls: true,
      max_retries: 2,
    },
    tools: [],
  };
  const trace_analysis_results = await trace_analysis_impl(
    request.trace_url,
    new TraceProcessorImpl(),
    agent_config,
    new VerboseLoggerImpl(request.verbose),
  );
  const feishu_doc = generate_feishu_doc(trace_analysis_results);
  return feishu_doc;
};

class TraceProcessorImpl implements TraceQuery {
  private tp: TraceProcessor | undefined;

  async initProcessor(_trace_url: string): Promise<void> {
    // Determine the correct binary path based on the current system
    const binPath = this.getBinaryPath();

    // Initialize the trace processor with the determined binary path
    const config = new TraceProcessorConfig({
      binPath: binPath,
      verbose: true,
      uniquePort: true,
      loadTimeout: 5,
    });

    // Download trace file and get local path
    const traceFile = await this.downloadTraceFile(_trace_url);

    this.tp = await TraceProcessor.create(traceFile, undefined, config);
  }

  private getBinaryPath(): string {
    const platform = os.platform();

    let binaryName: string;
    if (platform === 'darwin') {
      // macOS
      binaryName = 'trace_processor_shell_v50_mac_arm64';
    } else if (platform === 'linux') {
      binaryName = 'trace_processor_shell_v50_linux_amd64';
    } else {
      // Default fallback
      binaryName = 'trace_processor_shell_v50_linux_amd64';
    }

    return path.join(__dirname, 'resources', binaryName);
  }

  private getTraceUrl(url: string): string {
    try {
      const parsed = new URL(url);

      // Search from query parameters
      const urlParam = parsed.searchParams.get('url');
      if (urlParam) {
        return decodeURIComponent(urlParam);
      }

      // Search from fragment
      let fragment = parsed.hash;
      if (fragment.startsWith('#!')) {
        fragment = fragment.substring(2);
      } else if (fragment.startsWith('#')) {
        fragment = fragment.substring(1);
      }

      if (fragment) {
        try {
          const fragParsed = new URL(fragment, '');
          const fragUrlParam = fragParsed.searchParams.get('url');
          if (fragUrlParam) {
            return decodeURIComponent(fragUrlParam);
          }
        } catch {
          // Ignore fragment parsing errors
        }
      }

      return url;
    } catch {
      return url;
    }
  }

  private traceTmpPath(url: string): string {
    const tmpDir = os.tmpdir();
    const filename = path.basename(new URL(url).pathname) || 'trace_file';
    return path.join(tmpDir, filename);
  }

  private urlToFilenameExist(url: string): boolean {
    const filePath = this.traceTmpPath(url);
    return fs.existsSync(filePath);
  }

  private async downloadTrace(url: string): Promise<void> {
    const filePath = this.traceTmpPath(url);
    const file = fs.createWriteStream(filePath);

    return new Promise((resolve, reject) => {
      const request = url.startsWith('https:') ? https : http;

      request
        .get(url, (response) => {
          if (response.statusCode === 200) {
            response.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
          } else {
            reject(new Error(`Failed to download: ${response.statusCode}`));
          }
        })
        .on('error', (err) => {
          fs.unlink(filePath, () => {}); // Delete the file on error
          reject(err);
        });
    });
  }

  private async downloadTraceFile(url: string): Promise<string> {
    const traceUrl = this.getTraceUrl(url);

    if (!this.urlToFilenameExist(traceUrl)) {
      console.log(`Will download trace url: ${traceUrl}`);
      await this.downloadTrace(traceUrl);
    }

    return this.traceTmpPath(traceUrl);
  }

  async query(sql: string): Promise<Record<string, any>[]> {
    if (!this.tp) {
      throw new TraceProcessorException('TraceProcessor is not initialized.');
    }
    const result = await this.tp.query(sql);
    return result.toArray();
  }
  async detroyProcessor(): Promise<void> {
    if (this.tp) {
      this.tp.close();
      this.tp = undefined;
    }
  }
}

class VerboseLoggerImpl implements VerboseLogger {
  private logFile?: string;

  constructor(private verbose: boolean) {
    const id = uuidv4();
    const loggerName = `message_${id}`;

    // 文件处理器（如果指定了日志文件）
    if (verbose) {
      const tmpDir = os.tmpdir();
      this.logFile = path.join(tmpDir, `${loggerName}_${Date.now()}.log`);

      // 确保日志目录存在
      const logDir = path.dirname(this.logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, {recursive: true});
      }
    }
  }

  private writeToFile(message: string): void {
    if (this.logFile) {
      const timestamp = new Date().toISOString();
      const logEntry = `\n====================\n${timestamp} - ${message}\n====================\n`;
      try {
        fs.appendFileSync(this.logFile, logEntry);
      } catch (error) {
        console.error('Failed to write to log file:', error);
      }
    }
  }

  debug(message: string): void {
    if (this.verbose) {
      this.writeToFile(`DEBUG: ${message}`);
    }
  }

  info(message: string): void {
    this.writeToFile(`INFO: ${message}`);
  }

  warning(message: string): void {
    this.writeToFile(`WARNING: ${message}`);
  }

  error(message: string): void {
    this.writeToFile(`ERROR: ${message}`);
  }

  verbose_debug(message: string): void {
    if (this.verbose) {
      this.writeToFile(`VERBOSE: ${message}`);
    }
  }

  get_log_file_path(): string | undefined {
    return this.logFile;
  }
}

export {koaApp, trace_analysis};
