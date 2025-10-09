# Perfetto Trace Processor Node.js SDK

This is a Node.js SDK for the Perfetto trace processor, providing similar functionality to the Python SDK.

## Installation

### From npm (when published)
```bash
npm install @perfetto/trace-processor
```

### Local development
```bash
# Clone the repository and navigate to the node directory
cd /path/to/lynx-trace/node

# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Run basic tests
node test-basic.js
```

## Prerequisites

**Prerequisites:**
- Node.js 16.0.0 or higher
- Download `trace_processor_shell` binary from [Perfetto releases](https://github.com/google/perfetto/releases) or [get.perfetto.dev](https://get.perfetto.dev/trace_processor)

You can also:

1. Build it from source following the [Perfetto build instructions](https://perfetto.dev/docs/contributing/build-instructions)
2. Use the prebuilt binaries in the Perfetto repository

## Usage

The Node.js SDK provides two ways to interact with Perfetto trace processor:

1. **Local Binary Mode** - Spawns a local trace_processor_shell process
2. **HTTP Client Mode** - Connects to a running trace processor HTTP server

### HTTP Client Mode

The HTTP client connects to a running Perfetto trace processor server:

```javascript
const { TraceProcessorHttpClient } = require('@perfetto/trace-processor');

async function analyzeTrace() {
  const client = new TraceProcessorHttpClient('http://localhost:9001');
  
  try {
    // Parse a trace file
    await client.parse({ source: 'FILE', file: '/path/to/trace.pb' });
    await client.notifyEof();
    
    // Execute queries
    const result = await client.executeQuery('SELECT COUNT(*) FROM slice');
    console.log('Slice count:', result);
    
    // Compute metrics
    const metrics = await client.computeMetric(['android_batt']);
    console.log('Battery metrics:', metrics);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}
```

#### HTTP Client API

- `parse(trace)` - Parse trace file
- `executeQuery(sql)` - Execute SQL query
- `computeMetric(metrics)` - Compute metrics
- `notifyEof()` - Signal end of trace data
- `getStatus()` - Get server status
- `enableMetatrace()` - Enable metatrace
- `disableAndReadMetatrace()` - Read metatrace data

### Local Binary Mode

**Important:** The TraceProcessor initialization is asynchronous. Use `TraceProcessor.create()` instead of the constructor for proper async initialization.

#### Async vs Sync API

- **Recommended:** `TraceProcessor.create()` - Properly waits for initialization
- **Legacy:** `new TraceProcessor()` - May not wait for initialization to complete

#### Basic Usage

```javascript
const { TraceProcessor, TraceProcessorConfig } = require('@perfetto/trace-processor');

async function analyzeTrace() {
  // Create configuration
  const config = new TraceProcessorConfig({
    binPath: "/path/to/trace_processor_shell",
    verbose: true
  });

  // Load trace and create processor (async)
  const tp = await TraceProcessor.create("trace.pb", undefined, config);

  try {
    // Execute SQL query
    const result = await tp.query('SELECT name, dur FROM slice LIMIT 10');

    // Iterate through results
    for (const row of result) {
      console.log(`Slice: ${row.name}, Duration: ${row.dur}`);
    }
  } finally {
    // Clean up
    tp.close();
  }
}

analyzeTrace().catch(console.error);
```

### Python to Node.js Migration

Here's how the Python code translates to Node.js:

**Python:**
```python
config = TraceProcessorConfig(bin_path="/path/to/trace_processor_binary")
tp = TraceProcessor(trace=args.file, config=config)
res_it = tp.query('select * from slice limit 10')
for row in res_it:
    print(row.name)
```

**Node.js:**
```javascript
async function main() {
  const config = new TraceProcessorConfig({
    binPath: '/path/to/trace_processor_binary'
  });
  const tp = await TraceProcessor.create(args.file, undefined, config);
  
  try {
    const resIt = await tp.query('select * from slice limit 10');
    for (const row of resIt) {
      console.log(row.name);
    }
  } finally {
    tp.close();
  }
}

main().catch(console.error);
```

### Configuration Options

```javascript
const config = new TraceProcessorConfig({
  binPath: '/path/to/trace_processor_shell',  // Path to binary
  uniquePort: true,                           // Use unique port
  verbose: false,                             // Enable verbose logging
  ingestFtraceInRaw: false,                   // Ingest ftrace in raw format
  enableDevFeatures: false,                   // Enable dev features
  loadTimeout: 2,                             // Timeout in seconds
  extraFlags: []                              // Additional command line flags
});
```

### Connecting to Existing Instance

```javascript
async function connectToExisting() {
  // Connect to already running trace processor
  const tp = await TraceProcessor.create(undefined, 'localhost:9001');

  try {
    const results = await tp.query('SELECT COUNT(*) FROM slice');
    for (const row of results) {
      console.log(`Total slices: ${row.count}`);
    }
  } finally {
    tp.close();
  }
}

connectToExisting().catch(console.error);
```

### Working with Results

```javascript
const resultIterator = await tp.query('SELECT name, dur FROM slice LIMIT 5');

// Method 1: Iterate directly
for (const row of resultIterator) {
  console.log(`${row.name}: ${row.dur}`);
}

// Method 2: Convert to array
const results = resultIterator.toArray();
console.log(`Found ${results.length} rows`);

// Method 3: Access individual properties
for (const row of resultIterator) {
  console.log(row.toString()); // JSON representation
}
```

### Metrics

```javascript
// Compute metrics
const metrics = await tp.metric(['android_cpu', 'android_mem']);
console.log(metrics);
```

### Metatrace

```javascript
// Enable metatrace
await tp.enableMetatrace();

// ... perform operations ...

// Get metatrace data
const metatrace = await tp.disableAndReadMetatrace();
```

## API Reference

### TraceProcessor

Main class for interacting with trace data.

#### Constructor

```javascript
new TraceProcessor(trace?, addr?, config?, filePath?)
```

- `trace`: Path to trace file, Buffer, or stream
- `addr`: Address of existing trace processor instance
- `config`: TraceProcessorConfig instance
- `filePath`: (deprecated) Use `trace` parameter instead

#### Methods

- `query(sql: string): Promise<QueryResultIterator>` - Execute SQL query
- `metric(metrics: string[]): Promise<any>` - Compute metrics
- `enableMetatrace(): Promise<void>` - Enable metatrace
- `disableAndReadMetatrace(): Promise<any>` - Get metatrace data
- `close(): void` - Clean up resources

### QueryResultIterator

Iterator for query results.

#### Methods

- `toArray(): Row[]` - Convert to array
- `length: number` - Number of rows
- Implements `Iterable<Row>` for `for...of` loops

### Row

Represents a single row in query results.

#### Properties

- Dynamic properties based on query columns
- `toString(): string` - JSON representation

## Error Handling

```javascript
try {
  const tp = new TraceProcessor('trace.pb', undefined, config);
  const results = await tp.query('SELECT * FROM slice');
  // ... process results
} catch (error) {
  if (error instanceof TraceProcessorException) {
    console.error('Trace processor error:', error.message);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Examples

We provide several examples to help you get started:

### Basic API Test
```bash
# Test the API without requiring trace files or binaries
node test-basic.js
```

### Simple Usage Example
```bash
# Basic usage example (requires trace file and binary)
node example.js /path/to/your/trace.pb
```

### Advanced Usage Example
```bash
# Advanced analysis with metrics and error handling
node example-advanced.js /path/to/your/trace.pb /path/to/trace_processor_shell
```

### Setting up trace_processor_shell

```bash
# Download the binary
wget https://get.perfetto.dev/trace_processor -O trace_processor_shell
chmod +x trace_processor_shell

# Or for macOS
curl -o trace_processor_shell https://get.perfetto.dev/trace_processor
chmod +x trace_processor_shell
```

## Building

```bash
npm run build    # Build TypeScript to JavaScript
npm run dev      # Watch mode for development
npm test         # Run tests
```

## License

Apache License 2.0