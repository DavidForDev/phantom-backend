export const VisitorChannel = {
  WIDGET: "widget",
} as const;

export type VisitorChannel = (typeof VisitorChannel)[keyof typeof VisitorChannel];

export interface IVisitorInformation {
  name?: string;
  email?: string;
  phone?: string;
}
