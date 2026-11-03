#!/usr/bin/env node
import { main } from '../src/cli.mjs';

// Set exitCode instead of calling process.exit(): exit() drops stdout writes
// that are still queued when stdout is a pipe. Node drains the stream first.
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
