import { tool } from "@openai/agents";
import { z } from "zod";
import axios from "axios";
import "dotenv/config";

// The agent must provide a search query
const SearchInputSchema = z.object({
  query: z.string().describe("The search query to look up on the web"),
});

type SearchResult = {
  title: string;
  url: string;
  snippet: string; // A short excerpt from the page
};

export const searchWebTool = tool({
  name: "search_web",
  description:
    "Search the web for information about a topic. " +
    "Returns a list of relevant results with titles, URLs, and snippets. " +
    "Use this to find facts, statistics, and evidence.",

  parameters: SearchInputSchema,

  execute: async ({ query }) => {
    const apiKey = process.env.TAVILY_API_KEY;

    if (!apiKey) {
      return "Error: TAVILY_API_KEY is not set in your .env file.";
    }

    try {
      const response = await axios.post(
        "https://api.tavily.com/search",
        {
          query,
          max_results: 5,          // Get top 5 results to keep costs low
          search_depth: "basic",   // "basic" is faster and cheaper than "advanced"
          include_answer: false,   // We want raw results, not a pre-generated answer
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      const results: SearchResult[] = (response.data.results as any[]).map((r) => ({
        title: r.title ?? "No title",
        url: r.url ?? "No url",
        snippet: r.content ?? "No content",
      }));

      if (results.length === 0) {
        return `No results found for: "${query}"`;
      }

      const formatted = results
        .map((r, i) =>
          `Result ${i + 1}:\n` +
          `Title: ${r.title}\n` +
          `URL: ${r.url}\n` +
          `Snippet: ${r.snippet}\n`
        )
        .join("\n---\n");

      return `Found ${results.length} results for "${query}":\n\n${formatted}`;

    } catch (error) {
      if (axios.isAxiosError(error)) {
        return `Search failed: ${error.response?.data?.message ?? error.message}`;
      }
      return `Search failed with an unexpected error.`;
    }
  },
});
