type LogArg = unknown;

function ts() {
  return new Date().toISOString();
}

function format(level: string, message: string, args: LogArg[]) {
  const prefix = `[${ts()}] [${level}]`;
  if (args.length === 0) return [prefix, message];
  return [prefix, message, ...args];
}

const Logger = {
  info(message: string, ...args: LogArg[]) {
    console.log(...format("INFO", message, args));
  },
  warn(message: string, ...args: LogArg[]) {
    console.warn(...format("WARN", message, args));
  },
  error(message: string, ...args: LogArg[]) {
    console.error(...format("ERROR", message, args));
  },
  debug(message: string, ...args: LogArg[]) {
    if (process.env.NODE_ENV !== "production") {
      console.debug(...format("DEBUG", message, args));
    }
  },
};

export default Logger;
