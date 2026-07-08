import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
config({ path: path.join(projectRoot, ".env") });
config({ path: path.join(projectRoot, ".env.local"), override: true });
