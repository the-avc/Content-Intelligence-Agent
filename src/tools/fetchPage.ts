// src/tools/fetchPage.ts
// A tool that fetches and reads the full content of a web page
//
// HOW IT WORKS:
// 1. The Research Agent finds an interesting URL from search results
// 2. It calls this tool with that URL
// 3. This tool downloads the raw HTML of the page
// 4. We strip all the HTML tags to get just the readable text
// 5. The agent reads that text and extracts evidence from it
//
// WHY DO WE NEED THIS?
// Search results only give you a short snippet (2-3 sentences).
// That's not enough to verify facts properly.
// This tool fetches the FULL article so the agent has complete context.

import { tool } from "@openai/agents";
import { z } from "zod";
import axios from "axios";

// How much text to return — we limit this to save tokens
// A full article can be 10,000+ words — we only need the key parts
const MAX_TEXT_LENGTH = 3000;

// Define what input this tool accepts
const FetchPageInputSchema = z.object({
  url: z.string().url().describe("The full URL of the web page to fetch and read"),
});

// Remove HTML tags and clean up the text
// This turns "<h1>Hello <b>World</b></h1>" into "Hello World"
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "") // remove script blocks
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")   // remove style blocks
    .replace(/<[^>]+>/g, " ")                          // remove all other HTML tags
    .replace(/\s+/g, " ")                              // collapse multiple spaces
    .trim();
}

export const fetchPageTool = tool({
  name: "fetch_page",
  description:
    "Fetch and read the full text content of a web page by URL. " +
    "Use this when you need more detail than a search snippet provides. " +
    "Returns the cleaned text content of the page.",

  parameters: FetchPageInputSchema,

  execute: async ({ url }) => {
    try {
      // Fetch the raw HTML from the URL
      const response = await axios.get(url, {
        timeout: 10000, // Give up after 10 seconds
        headers: {
          // Pretend to be a normal browser so sites don't block us
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/120.0.0.0 Safari/537.36",
        },
        // Only accept HTML pages — skip PDFs, images, etc.
        maxContentLength: 2 * 1024 * 1024, // Max 2MB
      });

      // Make sure we got HTML back (not a PDF or image)
      const contentType = String(response.headers["content-type"] ?? "");
      if (!contentType.includes("text/html")) {
        return `Could not read this page — it is not an HTML page (type: ${contentType}).`;
      }

      // Strip HTML tags to get plain text
      const cleanText = stripHtml(response.data as string);

      if (!cleanText || cleanText.length < 50) {
        return `Page was fetched but contained no readable text.`;
      }

      // Trim to our max length to avoid using too many tokens
      const trimmed = cleanText.length > MAX_TEXT_LENGTH
        ? cleanText.substring(0, MAX_TEXT_LENGTH) + "... [content trimmed to save tokens]"
        : cleanText;

      return `Content from ${url}:\n\n${trimmed}`;

    } catch (error) {
      // Handle common errors clearly
      if (axios.isAxiosError(error)) {
        if (error.code === "ECONNABORTED") {
          return `Timed out trying to load: ${url}`;
        }
        if (error.response?.status === 403) {
          return `Access denied to: ${url} (the site blocked the request)`;
        }
        if (error.response?.status === 404) {
          return `Page not found: ${url}`;
        }
        return `Failed to fetch ${url}: ${error.message}`;
      }
      return `Failed to fetch page with an unexpected error.`;
    }
  },
});
