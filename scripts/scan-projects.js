#!/usr/bin/env node
// scan-projects.js — Auto-detect projects from ~/.claude/projects/
// Scans session JSONL files to extract real working directories.
// Usage: node scan-projects.js [--recent-days N]

const fs = require("fs");
const path = require("path");
const os = require("os");

const DATA_DIR = path.join(
  os.homedir(),
  ".claude",
  "wechat-plugin"
);
const PROJECTS_DIR = path.join(
  os.homedir(),
  ".claude",
  "projects"
);
const OUTPUT_FILE = path.join(DATA_DIR, "projects.json");
const DEFAULT_RECENT_DAYS = 30;

const recentDays = parseInt(
  (process.argv.find((a) => a.startsWith("--recent-days")) || "").split("=")[1] ||
  DEFAULT_RECENT_DAYS,
  10
);

function scanProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];

  const dirs = fs.readdirSync(PROJECTS_DIR).filter((d) => {
    try {
      return fs.statSync(path.join(PROJECTS_DIR, d)).isDirectory();
    } catch {
      return false;
    }
  });

  const projects = [];
  const now = Date.now();

  for (const d of dirs) {
    const fullDir = path.join(PROJECTS_DIR, d);
    const jsonlFiles = fs
      .readdirSync(fullDir)
      .filter((f) => f.endsWith(".jsonl"));
    if (!jsonlFiles.length) continue;

    // Find most recent session
    let latestFile = null;
    let latestMtime = 0;
    for (const f of jsonlFiles) {
      try {
        const mtime = fs.statSync(path.join(fullDir, f)).mtimeMs;
        if (mtime > latestMtime) {
          latestMtime = mtime;
          latestFile = f;
        }
      } catch {}
    }
    if (!latestFile) continue;

    const ageDays = (now - latestMtime) / 86400000;
    if (ageDays > recentDays) continue;

    // Extract working directory from session JSONL
    let workDir = "";
    try {
      const content = fs.readFileSync(path.join(fullDir, latestFile), "utf-8");
      const lines = content.split("\n").filter(Boolean);
      for (let i = 0; i < Math.min(20, lines.length); i++) {
        let match = lines[i].match(/"cwd":"([^"]+)"/);
        if (match) {
          workDir = match[1];
          break;
        }
        match = lines[i].match(/"workingDirectory":"([^"]+)"/);
        if (match) {
          workDir = match[1];
          break;
        }
      }
    } catch {}
    if (!workDir) continue;

    // Normalize path: backslashes to forward slashes, remove duplicates
    workDir = workDir.replace(/\\/g, "/").replace(/\/+/g, "/");

    // Extract project name from last path segment
    const segments = workDir.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1] || "unknown";

    // Generate a short key from the path
    const key = lastSegment
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    projects.push({
      key,
      name: lastSegment.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      workDir,
      ageDays: ageDays.toFixed(1),
    });
  }

  // Deduplicate by workDir (keep most recent)
  const seen = new Map();
  for (const p of projects) {
    const existing = seen.get(p.workDir);
    if (!existing || parseFloat(p.ageDays) < parseFloat(existing.ageDays)) {
      seen.set(p.workDir, p);
    }
  }

  return [...seen.values()].sort((a, b) => parseFloat(a.ageDays) - parseFloat(b.ageDays));
}

function updateProjectsFile(projects) {
  // Ensure data directory exists
  const dataDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Read existing config to preserve active setting
  let existing = { active: "", projects: {} };
  try {
    existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf-8"));
  } catch {}

  const newProjects = {};
  // Preserve projects that exist in config but not in scan (e.g. manually added)
  for (const [key, proj] of Object.entries(existing.projects)) {
    newProjects[key] = proj;
  }
  // Add/update scanned projects
  for (const p of projects) {
    if (existing.projects[p.key]) {
      // Update workDir if changed, preserve name/description
      existing.projects[p.key].workDir = p.workDir;
    } else {
      newProjects[p.key] = {
        name: p.name,
        workDir: p.workDir,
        description: "",
      };
    }
  }

  // Keep active if it still exists
  const active = newProjects[existing.active] ? existing.active : (projects[0]?.key || "");

  const config = { active, projects: newProjects };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(config, null, 2), "utf-8");
  return config;
}

// Main
const projects = scanProjects();
const config = updateProjectsFile(projects);

// Output summary
const lines = projects.map((p) => {
  const marker = p.key === config.active ? "* " : "  ";
  return `${marker}${p.key} — ${p.name} (${p.workDir}) [${p.ageDays}d ago]`;
});

process.stdout.write(`Found ${projects.length} projects (recent ${recentDays} days):\n`);
process.stdout.write(lines.join("\n") + "\n");
