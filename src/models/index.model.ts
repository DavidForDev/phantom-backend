import type { SchemaOptions } from "mongoose";

export const defaultConfig: SchemaOptions = {
  timestamps: true,
  versionKey: false,
  toJSON: {
    virtuals: true,
    transform: (_doc, ret) => {
      delete (ret as Record<string, unknown>).__v;
      return ret;
    },
  },
  toObject: {
    virtuals: true,
  },
};
