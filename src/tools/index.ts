// src/tools/index.ts
// Exports all tools in one place
//
// WHY: Instead of importing from individual files everywhere,
// you import from here. If you rename a file, you only fix it here.
//
// Usage in an agent:
//   import { searchWebTool, fetchPageTool } from "../tools/index.js";

export { searchWebTool } from "./searchWeb.js";
export { fetchPageTool } from "./fetchPage.js";
