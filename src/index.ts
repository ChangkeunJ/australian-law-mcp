#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { VERSION, createServer } from './server.js';
import { startUpdateCheck } from './update.js';

serveStdio(() => createServer(), {
  onerror: (error) => console.error('australian-law-mcp:', error.message),
});

// stdout is the wire; stderr is where a stdio server talks to its operator.
startUpdateCheck(VERSION).then((notice) => {
  if (notice) console.error(notice);
});
