// Entry point for `pnpm job <name>` (see cli.ts).
import { main } from './cli';

process.exitCode = await main(process.argv.slice(2));
