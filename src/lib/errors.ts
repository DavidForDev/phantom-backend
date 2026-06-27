export interface HttpError extends Error {
  statusCode: number;
}

export const httpError = (message: string, statusCode: number): HttpError => {
  const err = new Error(message) as HttpError;
  err.statusCode = statusCode;
  err.name = "HttpError";
  return err;
};

export const isHttpError = (value: unknown): value is HttpError =>
  value instanceof Error && typeof (value as HttpError).statusCode === "number";
