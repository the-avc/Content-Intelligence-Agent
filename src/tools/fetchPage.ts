import { tool } from "@openai/agents";
import { z } from "zod";
import axios from "axios";

const MAX_TEXT_LENGTH = 3000;

const FetchPageInputSchema = z.object({
  url: z.string().url().describe("The full URL of the web page to fetch and read"),
});

// Remove HTML tags and clean up the text
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "") 
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")   
    .replace(/<[^>]+>/g, " ")                          
    .replace(/\s+/g, " ")                              
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
