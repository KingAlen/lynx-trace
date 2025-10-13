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
import * as crypto from 'crypto';
import {URL} from 'url';
import {v4 as uuidv4} from 'uuid';
import {VerboseLogger} from './utils/interface/verbose_logger';
import {trace_analysis_impl} from './trace_analysis_impl';
import {generate_feishu_doc} from './utils/feishu_doc';
import {OverviewChart} from './utils/interface/overview_chart';
import {pipelineOverviewCharts} from './utils/pipeline_overview_chart';
import {ReportLanguage} from './utils/interface/language';

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
router.get('/v1/ping', async (ctx: Koa.DefaultContext) => {
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
  const reportLanguage = new ReportLanguageImpl();
  const logger = new VerboseLoggerImpl(request.verbose);
  const trace_analysis_results = await trace_analysis_impl(
    request.trace_url,
    new TraceProcessorImpl(),
    agent_config,
    logger,
    new OverviewChartImpl(),
    reportLanguage,
  );
  const feishu_doc = await generate_feishu_doc(
    request,
    trace_analysis_results,
    logger,
  );
  return feishu_doc;
};

class TraceProcessorImpl implements TraceQuery {
  private tp: TraceProcessor | undefined;

  async initProcessor(_trace_url: string): Promise<void> {
    // Determine the correct binary path based on the current system
    const binPath = await this.getBinaryPath();

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

  private async getBinaryPath(): Promise<string> {
    const trace_processor_shell = {
      darwin: {
        url: 'https://tosv.byted.org/obj/lynx-testing/trace_processor_shell_v50_mac_arm64',
        sha256:
          'f8a545f177853ef459e9b799bb1980db7a7a77e156de8d9fe61ff006175563bb',
      },
      linux: {
        url: 'https://tosv.byted.org/obj/lynx-testing/trace_processor_shell_v50_linux_amd64',
        sha256:
          '5024f2bf0d3324d3a80b49a44ac3e1fa680890946765586dc6fac7a5fdf66173',
      },
    };

    const platform = os.platform();
    let config: {url: string; sha256: string};

    if (platform === 'darwin') {
      config = trace_processor_shell.darwin;
    } else if (platform === 'linux') {
      config = trace_processor_shell.linux;
    } else {
      // Default fallback to linux
      config = trace_processor_shell.linux;
    }

    // Generate local file path in tmp directory
    const fileName = path.basename(config.url);
    const localPath = path.join(os.tmpdir(), 'lynx-trace', fileName);

    // Check if file already exists and has correct SHA256
    if (await this.fileExistsAndValid(localPath, config.sha256)) {
      return localPath;
    }

    // Download file from remote URL
    await this.downloadBinary(config.url, localPath, config.sha256);

    return localPath;
  }

  private async fileExistsAndValid(
    filePath: string,
    expectedSha256: string,
  ): Promise<boolean> {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const fileBuffer = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha256');
      hash.update(fileBuffer);
      const actualSha256 = hash.digest('hex');

      return actualSha256 === expectedSha256;
    } catch (error) {
      console.error('Error checking file validity:', error);
      return false;
    }
  }

  private async downloadFile(url: string, filePath: string): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, {recursive: true});
    }

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

  private async downloadBinary(
    url: string,
    localPath: string,
    expectedSha256: string,
  ): Promise<void> {
    await this.downloadFile(url, localPath);

    // Verify SHA256
    try {
      const fileBuffer = fs.readFileSync(localPath);
      const hash = crypto.createHash('sha256');
      hash.update(fileBuffer);
      const actualSha256 = hash.digest('hex');

      if (actualSha256 !== expectedSha256) {
        fs.unlinkSync(localPath); // Remove invalid file
        throw new Error(
          `SHA256 mismatch. Expected: ${expectedSha256}, Got: ${actualSha256}`,
        );
      }

      // Make file executable
      fs.chmodSync(localPath, 0o755);
    } catch (error) {
      fs.unlink(localPath, () => {}); // Clean up on error
      throw new Error(`Error verifying downloaded file: ${error}`);
    }
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
    await this.downloadFile(url, filePath);
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
      console.debug(`DEBUG: ${message}`);
    }
  }

  info(message: string): void {
    this.writeToFile(`INFO: ${message}`);
    console.info(`INFO: ${message}`);
  }

  warning(message: string): void {
    this.writeToFile(`WARNING: ${message}`);
    console.warn(`WARNING: ${message}`);
  }

  error(message: string): void {
    this.writeToFile(`ERROR: ${message}`);
    console.error(`ERROR: ${message}`);
  }

  verbose_debug(message: string): void {
    if (this.verbose) {
      this.writeToFile(`VERBOSE: ${message}`);
      console.debug(`VERBOSE: ${message}`);
    }
  }

  get_log_file_path(): string | undefined {
    return this.logFile;
  }
}

class OverviewChartImpl implements OverviewChart {
  async generateCharts(traceResult: any): Promise<string[]> {
    return await pipelineOverviewCharts(traceResult);
  }
}

class ReportLanguageImpl implements ReportLanguage {
  localLanguage(): string {
    return 'zh';
  }
}

export {koaApp, trace_analysis};
