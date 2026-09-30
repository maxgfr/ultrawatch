import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach } from "vitest";

// Every run and cache the suite touches lives in a throwaway directory: a test
// must never read, or overwrite, a video a user already fetched.
const scratch = mkdtempSync(join(tmpdir(), "ultrawatch-tests-"));
beforeEach(() => {
  process.env.ULTRAWATCH_VIDEO_DIR = join(scratch, "video");
  process.env.ULTRAWATCH_CACHE_DIR = join(scratch, "cache");
});
