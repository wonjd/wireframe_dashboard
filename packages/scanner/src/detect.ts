import fs from "node:fs/promises";
import path from "node:path";
import { projectSpecSchema, type PackageManager, type ProjectBundler, type ProjectFramework, type ProjectIntegration, type ProjectRouter } from "@wireframe-studio/core";

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: unknown;
};

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readPkg(dir: string): Promise<PkgJson | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as PkgJson;
  } catch {
    return null;
  }
}

function deps(pkg: PkgJson | null) {
  if (!pkg) return {};
  return { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
}

async function detectPackageManager(dir: string): Promise<PackageManager> {
  if (await exists(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(dir, "bun.lock")) || (await exists(path.join(dir, "bun.lockb")))) return "bun";
  if (await exists(path.join(dir, "yarn.lock"))) return "yarn";
  if (await exists(path.join(dir, "package-lock.json"))) return "npm";
  return "unknown";
}

async function detectBundler(dir: string, hasNext: boolean, allDeps: Record<string, string>): Promise<ProjectBundler> {
  if (hasNext) return "next";
  if (allDeps.vite || (await exists(path.join(dir, "vite.config.ts"))) || (await exists(path.join(dir, "vite.config.js")))) {
    return "vite";
  }
  if (allDeps["react-scripts"]) return "cra";
  if (allDeps.webpack || (await exists(path.join(dir, "webpack.config.js")))) return "webpack";
  return "unknown";
}

async function detectRouter(dir: string, hasNext: boolean, allDeps: Record<string, string>): Promise<ProjectRouter> {
  if (hasNext) {
    if (await exists(path.join(dir, "app"))) return "next-app";
    if (await exists(path.join(dir, "src", "app"))) return "next-app";
    if (await exists(path.join(dir, "pages"))) return "next-pages";
    if (await exists(path.join(dir, "src", "pages"))) return "next-pages";
    return "unknown";
  }
  if (allDeps["react-router-dom"] || allDeps["react-router"]) return "react-router";
  return "unknown";
}

function buildIntegration(framework: ProjectFramework, router: ProjectRouter, bundler: ProjectBundler): ProjectIntegration {
  const common = ["create wireframe_issue on clone MySQL (integrations/mysql/wireframe_issue.sql)"];
  if (framework === "next" && router === "next-app") {
    return {
      kind: "next-page",
      file: "app/wireframe/[[...slug]]/page.tsx",
      template: "integrations/next/wireframe.page.tsx",
      package: "@wireframe-studio/next",
      extraSteps: [...common, "set transpilePackages"],
    };
  }
  if (framework === "next") {
    return {
      kind: "next-pages",
      file: "pages/wireframe/[[...slug]].tsx",
      template: "integrations/next-pages/wireframe.page.tsx",
      package: "@wireframe-studio/react",
      extraSteps: [...common, "add pages/api/wireframe/[...path].ts"],
    };
  }
  if (framework === "react") {
    const file = router === "react-router" ? "src/routes/wireframe.tsx" : "src/pages/Wireframe.tsx";
    return {
      kind: "react-route",
      file,
      template: "integrations/react/wireframe.route.tsx",
      package: "@wireframe-studio/react",
      extraSteps: [...common, "proxy /wireframe/api", "add /wireframe/* to Router"],
    };
  }
  return {
    kind: "react-route",
    file: "src/wireframe.tsx",
    template: "integrations/react/wireframe.route.tsx",
    package: "@wireframe-studio/react",
    extraSteps: ["confirm framework", ...common],
  };
}


export async function detectProjectSpec(repoPath: string) {
  const abs = path.resolve(repoPath);
  const repoName = path.basename(abs);
  const pkg = await readPkg(abs);
  const allDeps = deps(pkg);
  const hasNext = Boolean(allDeps.next);
  const hasReact = Boolean(allDeps.react);

  let framework: ProjectFramework = "unknown";
  if (hasNext) framework = "next";
  else if (hasReact) framework = "react";

  const bundler = await detectBundler(abs, hasNext, allDeps);
  const router = await detectRouter(abs, hasNext, allDeps);
  const packageManager = await detectPackageManager(abs);
  const isMonorepo = Boolean(
    pkg?.workspaces ||
      (await exists(path.join(abs, "pnpm-workspace.yaml"))) ||
      (await exists(path.join(abs, "lerna.json")))
  );
  const integration = buildIntegration(framework, router, bundler);

  return projectSpecSchema.parse({
    repoPath: abs,
    repoName,
    framework,
    bundler,
    router,
    packageManager,
    hasReact,
    hasNext,
    isMonorepo,
    integration,
  });
}
