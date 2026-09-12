import { z } from "zod";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/**
 * Calls OpenRouter and parses the reply against `schema`.
 * Throws OpenRouterError on any transport, shape, or schema failure so callers
 * can degrade instead of shipping malformed model output into the UI.
 */
export async function completeJson<S extends z.ZodTypeAny>(
  messages: ChatMessage[],
  schema: S,
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<z.infer<S>> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OpenRouterError("OPENROUTER_API_KEY is not configured", 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "SCREENMATE",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 1400,
        response_format: { type: "json_object" },
        messages,
      }),
    });
  } catch (err) {
    throw new OpenRouterError(
      err instanceof Error && err.name === "AbortError"
        ? "Model request timed out"
        : "Could not reach OpenRouter",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OpenRouterError(
      `OpenRouter returned ${res.status}: ${body.slice(0, 200)}`,
    );
  }

  const payload = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
  } | null;

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new OpenRouterError("OpenRouter returned an empty completion");
  }

  const parsed = schema.safeParse(extractJson(content));
  if (!parsed.success) {
    throw new OpenRouterError(
      `Model output failed schema validation: ${parsed.error.issues
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")
        .slice(0, 240)}`,
    );
  }
  return parsed.data;
}

/** Tolerates fenced or prose-wrapped JSON without ever eval-ing model output. */
function extractJson(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}
