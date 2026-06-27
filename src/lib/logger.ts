type LogArg = unknown;

const timestamp = (): string => new Date().toISOString();

const format = (level: string, message: string, args: LogArg[]): unknown[] => {
  const prefix = `[${timestamp()}] [${level}]`;
  return args.length === 0 ? [prefix, message] : [prefix, message, ...args];
};

const Logger = {
  info: (message: string, ...args: LogArg[]) => {
    console.log(...format("INFO", message, args));
  },
  warn: (message: string, ...args: LogArg[]) => {
    console.warn(...format("WARN", message, args));
  },
  error: (message: string, ...args: LogArg[]) => {
    console.error(...format("ERROR", message, args));
  },
  debug: (message: string, ...args: LogArg[]) => {
    if (process.env.NODE_ENV !== "production") {
      console.debug(...format("DEBUG", message, args));
    }
  },
};

export default Logger;
