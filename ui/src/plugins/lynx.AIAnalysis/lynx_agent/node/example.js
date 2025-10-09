/**
 * Example usage of the Perfetto Trace Processor Node.js SDK
 *
 * This example demonstrates how to use the SDK similar to the Python version:
 *
 * config = TraceProcessorConfig(bin_path="/path/to/trace_processor_binary")
 * tp = TraceProcessor(trace=args.file, config=config)
 * res_it = tp.query('select * from slice limit 10')
 * for row in res_it:
 *   print(row.name)
 */

const {TraceProcessor, TraceProcessorConfig} = require('./dist/index.js');

async function main() {
  try {
    // Create configuration (similar to Python's TraceProcessorConfig)
    const config = new TraceProcessorConfig({
      binPath:
        '/Users/bytedancer/Downloads/trace_processor_shell_v50_mac_arm64',
      verbose: true,
      uniquePort: true,
      loadTimeout: 5,
    });

    // Create TraceProcessor instance with a trace file
    const traceFile = process.argv[2] || 'example_trace.pb';
    console.log(`Loading trace: ${traceFile}`);

    console.log('Initializing TraceProcessor...');
    const tp = await TraceProcessor.create(traceFile, undefined, config);

    // Execute SQL query (similar to Python's tp.query())
    console.log('Executing query...');
    const result = await tp.query(
      "select * from slice where slice.name='LynxLoadTemplate'",
    );

    // Alternative: Convert to array
    console.log('\nAs array:');
    const results = result.toArray();
    console.log(`Total rows: ${results.length}`);

    for (let i = 0; i < results.length; i++) {
      console.log(`Row ${i + 1}:`, results[i]);
    }

    // Clean up
    tp.close();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {main};
