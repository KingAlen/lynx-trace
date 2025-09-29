/**
 * CLI Console class for handling console interactions.
 */
export class CLIConsole {
  /**
   * Log a message to the console.
   *
   * @param message Message to log
   */
  log(message: string): void {
    console.log(message);
  }

  /**
   * Log an error message to the console.
   *
   * @param message Error message to log
   */
  error(message: string): void {
    console.error(message);
  }

  /**
   * Log a warning message to the console.
   *
   * @param message Warning message to log
   */
  warn(message: string): void {
    console.warn(message);
  }
}
