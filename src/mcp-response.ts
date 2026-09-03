import { getEncoding } from "js-tiktoken";

import { recordDeliveredTokens } from "./sessions";

const encoding = getEncoding("cl100k_base");

export function createTextResponse(
  tool: string,
  text: string,
  sessionId?: string,
) {
  if (sessionId) {
    const tokens = encoding.encode(text).length;

    recordDeliveredTokens(
      sessionId,
      tool,
      tokens,
    );
  }

  return {
    content: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}