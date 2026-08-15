// src/utils/logger.ts
// A simple logger that prints colored messages to the terminal
// and saves them to a log file

import fs from "fs";
import path from "path";

// Where to save log files
let logFilePath = "";

// Create the logs folder if it doesn't exist
function ensureLogsFolder() {
  const logsDir = path.join(process.cwd(), "logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }
  return logsDir;
}

// Set up logger for a new pipeline run
export function initLogger(runId: string) {
  const logsDir = ensureLogsFolder();
  logFilePath = path.join(logsDir, `run_${runId}.log`);
  console.log("\n========================================");
  console.log(`  Pipeline Run | ID: ${runId}`);
  console.log("========================================\n");
}

// Write a line to the log file
function writeToFile(level: string, message: string) {
  if (!logFilePath) return;
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  fs.appendFileSync(logFilePath, line);
}

// Basic log functions — each prints a colored prefix
export function logInfo(message: string) {
  console.log(`\x1b[36m[INFO]\x1b[0m ${message}`);
  writeToFile("INFO", message);
}

export function logSuccess(message: string) {
  console.log(`\x1b[32m[OK]\x1b[0m ${message}`);
  writeToFile("OK", message);
}

export function logWarn(message: string) {
  console.log(`\x1b[33m[WARN]\x1b[0m ${message}`);
  writeToFile("WARN", message);
}

export function logError(message: string) {
  console.log(`\x1b[31m[ERROR]\x1b[0m ${message}`);
  writeToFile("ERROR", message);
}

// Agent-specific log — shows which agent is currently running
export function logAgent(agentName: string, message: string) {
  console.log(`\x1b[35m[AGENT: ${agentName}]\x1b[0m ${message}`);
  writeToFile(`AGENT:${agentName}`, message);
}

// Cost-specific log — shows token usage and cost
export function logCost(message: string) {
  console.log(`\x1b[34m[COST]\x1b[0m ${message}`);
  writeToFile("COST", message);
}

// Loop-specific log — shows when a retry loop is triggered
export function logLoop(loopName: string, iteration: number, message: string) {
  console.log(`\x1b[33m[LOOP: ${loopName} | try ${iteration}]\x1b[0m ${message}`);
  writeToFile(`LOOP:${loopName}`, message);
}

// Print a section header — makes terminal output easy to read
export function logSection(title: string) {
  console.log(`\n\x1b[36m--- ${title} ---\x1b[0m\n`);
}

// Save the final pipeline result as a JSON file
export function saveResultToFile(runId: string, data: unknown) {
  const dir = ensureLogsFolder();
  const filePath = path.join(dir, `result_${runId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  logSuccess(`Result saved → ${filePath}`);
}
