// src/tools/searchWeb.ts
// A tool that searches the web using the Tavily API
//
// HOW IT WORKS:
// 1. The Research Agent decides it needs information on a topic
// 2. It calls this tool with a search query
// 3. This tool sends that query to Tavily
// 4. Tavily returns relevant web results (title, url, snippet)
// 5. The agent reads those results and uses them as evidence
//
// WHY TAVILY and not Google?
// Tavily is built specifically for AI agents — it returns clean,
// structured results without ads or JavaScript-heavy pages.
// Google's API is expensive. Tavily free tier = 1000 searches/month.

import { tool } from "@openai/agents";
import { z } from "zod";
import axios from "axios";
import "dotenv/config";

// Define what inputs this tool accepts
// The agent must provide a search query
const SearchInputSchema = z.object({
  query: z.string().describe("The search query to look up on the web"),
});

// Define what one search result looks like
type SearchResult = {
  title: string;
  url: string;
  snippet: string; // A short excerpt from the page
};

// The actual tool — this is what gets attached to an agent
export const searchWebTool = tool({
  name: "search_web",
  description:
    "Search the web for information about a topic. " +
    "Returns a list of relevant results with titles, URLs, and snippets. " +
    "Use this to find facts, statistics, and evidence.",

  // What inputs the agent must provide when calling this tool
  parameters: SearchInputSchema,

  // The function that runs when the agent calls this tool
  execute: async ({ query }) => {
    const apiKey = process.env.TAVILY_API_KEY;

    if (!apiKey) {
      return "Error: TAVILY_API_KEY is not set in your .env file.";
    }

    try {
      // Call the Tavily search API
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

      // Extract just the parts we need from Tavily's response
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results: SearchResult[] = (response.data.results as any[]).map((r) => ({
        title:   r.title   ?? "No title",
        url:     r.url     ?? "No url",
        snippet: r.content ?? "No content",
      }));

      if (results.length === 0) {
        return `No results found for: "${query}"`;
      }

      // Return results as a formatted string
      // Agents read text — so we format this clearly
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
      // If the API call fails, return an error message
      // The agent will see this and decide what to do
      if (axios.isAxiosError(error)) {
        return `Search failed: ${error.response?.data?.message ?? error.message}`;
      }
      return `Search failed with an unexpected error.`;
    }
  },
});
