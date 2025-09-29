import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from 'koa-router';
import {Agent} from './agent/agent';
import {AgentConfig} from './utils/config';
import {TraceQuery} from './tools/trace_query';

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
  const trace_processor = new TraceProcessorImpl();
  await trace_processor.initProcessor(request.trace_url);
  const config: AgentConfig = {
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
    trace_processor,
  };
  const agent = new Agent(config);
  const result = await agent.run(request.trace_url);
  await trace_processor.detroyProcessor();
  return result;
};

class TraceProcessorImpl implements TraceQuery {
  async initProcessor(_trace_url: string): Promise<void> {
    // Initialize the trace processor with the given trace URL
    // TODO
  }
  async query(_sql: string): Promise<string> {
    // Execute the given SQL query against the trace processor
    // TODO
    return '';
  }
  async detroyProcessor(): Promise<void> {
    // Destroy the trace processor
  }
}

export {koaApp, trace_analysis};
