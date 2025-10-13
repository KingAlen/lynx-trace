import {koaApp} from './koa';
import * as http from 'http';

// Export for external use
export {trace_analysis, TraceAnalysisRequest} from './koa';
export {koaApp};

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  console.info(`Starting local development Server on port ${PORT}...`);
  try {
    const server = http.createServer((req: any, res: any) => {
      const callback = koaApp.callback();
      callback(req, res);
    });

    server.listen(PORT, () => {
      console.info(`Server is listening on port ${PORT}`);
    });

    server.on('error', (error: Error) => {
      console.error('Server error:', error);
      process.exit(1);
    });
  } catch (error) {
    console.error('Initialization failed, server not started:', error);
    process.exit(1);
  }
}
