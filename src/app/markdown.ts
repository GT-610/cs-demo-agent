import { defaultUrlTransform } from "react-markdown";

export function markdownUrlTransform(url: string): string {
  return defaultUrlTransform(url);
}
