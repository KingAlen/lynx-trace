export interface VerboseLogger {
  debug(message: string): void;
  info(message: string): void;
  warning(message: string): void;
  error(message: string): void;
  verbose_debug(message: string): void;
  llm_feedback(message: string): void;
  get_log_file_path(): string | undefined;
}
