// Copyright 2025 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

// Values corresponding to the QueryResponse message at
// protos/perfetto/trace_processor/trace_processor.proto
const QUERY_CELL_VARINT_FIELD_ID = 2;
const QUERY_CELL_FLOAT64_FIELD_ID = 3;
const QUERY_CELL_STRING_FIELD_ID = 4;
const QUERY_CELL_BLOB_FIELD_ID = 5;

/**
 * Represents a single row in the query result.
 * Each column name is stored as a property of this class.
 */
export class Row {
  [key: string]: any;

  constructor(data: Record<string, any>) {
    Object.assign(this, data);
  }

  toString(): string {
    return JSON.stringify(this);
  }
}

/**
 * Iterator for query results from trace processor.
 * Corresponds to Python's QueryResultIterator.
 */
export class QueryResultIterator implements Iterable<Row> {
  private columnNames: string[];
  private batches: any[];
  // private currentBatchIndex: number = 0;
  // private currentRowIndex: number = 0;
  private totalRows: number = 0;

  constructor(columnNames: string[], batches: any[]) {
    this.columnNames = columnNames;
    this.batches = batches;

    // Calculate total rows across all batches
    this.totalRows = batches.reduce((total, batch) => {
      // Handle both array format and object format
      if (Array.isArray(batch)) {
        // Each batch is an array of cell batches
        // For the new format, calculate rows from the first cell batch
        if (batch.length > 0) {
          const cellBatch = batch[0];
          // Count rows by finding the maximum number of values in any cell type
          const varintCount = cellBatch.varintCells
            ? cellBatch.varintCells.length
            : 0;
          const stringCount = cellBatch.stringCells
            ? cellBatch.stringCells.split('\0').filter((s: string) => s).length
            : 0;
          const float64Count = cellBatch.float64Cells
            ? cellBatch.float64Cells.length
            : 0;
          const blobCount = cellBatch.blobCells
            ? cellBatch.blobCells.length
            : 0;

          // Calculate rows based on column types
          const cells = cellBatch.cells || [];
          let rowCount = 0;
          let varintIndex = 0;
          let stringIndex = 0;
          let float64Index = 0;
          let blobIndex = 0;

          // Count how many complete rows we can form
          for (let i = 0; i < cells.length; i += columnNames.length) {
            let canFormRow = true;
            for (
              let j = 0;
              j < columnNames.length && i + j < cells.length;
              j++
            ) {
              const cellType = cells[i + j];
              if (
                cellType === 'CELL_VARINT' ||
                cellType === QUERY_CELL_VARINT_FIELD_ID
              ) {
                if (varintIndex >= varintCount) canFormRow = false;
                else varintIndex++;
              } else if (
                cellType === 'CELL_STRING' ||
                cellType === QUERY_CELL_STRING_FIELD_ID
              ) {
                if (stringIndex >= stringCount) canFormRow = false;
                else stringIndex++;
              } else if (
                cellType === 'CELL_FLOAT64' ||
                cellType === QUERY_CELL_FLOAT64_FIELD_ID
              ) {
                if (float64Index >= float64Count) canFormRow = false;
                else float64Index++;
              } else if (
                cellType === 'CELL_BLOB' ||
                cellType === QUERY_CELL_BLOB_FIELD_ID
              ) {
                if (blobIndex >= blobCount) canFormRow = false;
                else blobIndex++;
              }
            }
            if (canFormRow) rowCount++;
            else break;
          }

          return total + rowCount;
        }
        return total;
      } else {
        // Legacy format with numRecords
        return total + (batch.numRecords || 0);
      }
    }, 0);
  }

  /**
   * Get the number of rows in the result set.
   */
  get length(): number {
    return this.totalRows;
  }

  /**
   * Convert the result to a simple array of objects.
   * Similar to Python's as_pandas_dataframe() but returns plain objects.
   */
  toArray(): Row[] {
    const results: Row[] = [];
    for (const row of this) {
      results.push(row);
    }
    return results;
  }

  /**
   * Iterator implementation
   */
  [Symbol.iterator](): Iterator<Row> {
    let batchIndex = 0;
    let rowIndex = 0;
    const batches = this.batches;
    const columnNames = this.columnNames;

    return {
      next(): IteratorResult<Row> {
        // Check if we've exhausted all batches
        if (batchIndex >= batches.length) {
          return {done: true, value: undefined};
        }

        const currentBatch = batches[batchIndex];
        let numRecords = 0;
        let cellBatches: any[] = [];

        // Handle different batch formats
        if (Array.isArray(currentBatch)) {
          // New format: batch is an array of cell batches
          cellBatches = currentBatch;
          // Calculate number of rows from the first cell batch
          if (cellBatches.length > 0) {
            const cellBatch = cellBatches[0];
            const cells = cellBatch.cells || [];
            const numColumns = columnNames.length;
            numRecords = Math.floor(cells.length / numColumns);
          } else {
            numRecords = 0;
          }
        } else {
          // Legacy format
          numRecords = currentBatch.numRecords || 0;
          cellBatches = currentBatch.cells || [];
        }

        // Check if we've exhausted current batch
        if (rowIndex >= numRecords) {
          batchIndex++;
          rowIndex = 0;
          return this.next(); // Recursively check next batch
        }

        // Extract row data
        const rowData: Record<string, any> = {};

        for (let colIndex = 0; colIndex < columnNames.length; colIndex++) {
          const columnName = columnNames[colIndex];

          if (Array.isArray(currentBatch)) {
            // New format: extract from cell batches
            const cellBatch = cellBatches[0]; // All data is in the first cell batch
            if (cellBatch) {
              const cells = cellBatch.cells || [];
              const numColumns = columnNames.length;
              const cellIndex = rowIndex * numColumns + colIndex;

              if (cellIndex < cells.length) {
                const cellType = cells[cellIndex];

                // Count how many values of each type we've seen before this cell
                let varintIndex = 0;
                let stringIndex = 0;
                let float64Index = 0;
                let blobIndex = 0;

                for (let i = 0; i < cellIndex; i++) {
                  const prevCellType = cells[i];
                  if (prevCellType === 'CELL_VARINT' || prevCellType === 2) {
                    varintIndex++;
                  } else if (
                    prevCellType === 'CELL_STRING' ||
                    prevCellType === 4
                  ) {
                    stringIndex++;
                  } else if (
                    prevCellType === 'CELL_FLOAT64' ||
                    prevCellType === 3
                  ) {
                    float64Index++;
                  } else if (
                    prevCellType === 'CELL_BLOB' ||
                    prevCellType === 5
                  ) {
                    blobIndex++;
                  }
                }

                if (cellType === 'CELL_VARINT' || cellType === 2) {
                  if (
                    cellBatch.varintCells &&
                    varintIndex < cellBatch.varintCells.length
                  ) {
                    const longValue = cellBatch.varintCells[varintIndex];
                    // Handle Long objects (from protobuf)
                    if (
                      typeof longValue === 'object' &&
                      longValue.low !== undefined
                    ) {
                      rowData[columnName] =
                        longValue.low + longValue.high * 0x100000000;
                    } else {
                      rowData[columnName] = Number(longValue);
                    }
                  } else {
                    rowData[columnName] = null;
                  }
                } else if (cellType === 'CELL_STRING' || cellType === 4) {
                  if (cellBatch.stringCells) {
                    const stringValues = cellBatch.stringCells
                      .split('\0')
                      .filter((s: string) => s);
                    if (stringIndex < stringValues.length) {
                      rowData[columnName] = stringValues[stringIndex];
                    } else {
                      rowData[columnName] = null;
                    }
                  } else {
                    rowData[columnName] = null;
                  }
                } else if (cellType === 'CELL_FLOAT64' || cellType === 3) {
                  if (
                    cellBatch.float64Cells &&
                    float64Index < cellBatch.float64Cells.length
                  ) {
                    rowData[columnName] = cellBatch.float64Cells[float64Index];
                  } else {
                    rowData[columnName] = null;
                  }
                } else if (cellType === 'CELL_BLOB' || cellType === 5) {
                  if (
                    cellBatch.blobCells &&
                    blobIndex < cellBatch.blobCells.length
                  ) {
                    rowData[columnName] = cellBatch.blobCells[blobIndex];
                  } else {
                    rowData[columnName] = null;
                  }
                } else {
                  rowData[columnName] = null;
                }
              } else {
                rowData[columnName] = null;
              }
            } else {
              rowData[columnName] = null;
            }
          } else {
            // Legacy format
            const cellBatch = cellBatches[colIndex];
            if (
              cellBatch &&
              cellBatch.values &&
              rowIndex < cellBatch.values.length
            ) {
              const cellValue = cellBatch.values[rowIndex];
              rowData[columnName] =
                QueryResultIterator.extractCellValue(cellValue);
            } else {
              rowData[columnName] = null;
            }
          }
        }

        rowIndex++;
        return {done: false, value: new Row(rowData)};
      },
    };
  }

  /**
   * Extract the actual value from a cell based on its type.
   */
  private static extractCellValue(cell: any): any {
    if (!cell) return null;

    // Check which field is set in the cell
    if (cell.varintValue !== undefined) {
      return Number(cell.varintValue);
    }
    if (cell.float64Value !== undefined) {
      return cell.float64Value;
    }
    if (cell.stringValue !== undefined) {
      return cell.stringValue;
    }
    if (cell.blobValue !== undefined) {
      return cell.blobValue;
    }
    if (cell.isNull) {
      return null;
    }

    return null;
  }
}
