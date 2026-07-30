import { tmpdir } from "node:os";
import { join } from "node:path";

export const SUBAGENT_RUNS_ROOT = join(tmpdir(), "my-pi-toolkit-subagents");
