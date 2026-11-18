import "server-only";
import sanitizeHtml from "sanitize-html";

/**
 * Library articles are republished as delivered (The Conversation requires
 * no edits), so we only strip what could run code. Links open in a new tab;
 * embeds are limited to https iframes and sandboxed.
 */
export function cleanArticleHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: ["h1", "h2", "h3", "h4", "p", "a", "em", "strong", "b", "i", "u", "span", "div", "ul", "ol", "li",
      "blockquote", "figure", "figcaption", "img", "hr", "br", "iframe", "table", "thead", "tbody", "tr", "th", "td", "sup", "sub"],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "width", "height", "style", "referrerpolicy"],
      iframe: ["src", "width", "height", "title", "allowfullscreen"],
      "*": ["class"],
    },
    allowedSchemes: ["https", "http", "mailto"],
    allowedSchemesByTag: { img: ["https"], iframe: ["https"] },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
      iframe: sanitizeHtml.simpleTransform("iframe", { sandbox: "allow-scripts allow-same-origin allow-presentation", loading: "lazy" }),
    },
    allowedStyles: { img: { "*": [/^.*$/] } },
  });
}

export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export function levelRange(min: string | null, max: string | null) {
  if (!min) return max ?? "";
  return max && max !== min ? `${min}–${max}` : min;
}

export type Question = { id: string; type: string; prompt: string; options?: string[] };
export type AnswerKey = Record<string, { answer: number | string; explanation?: string | null }>;
