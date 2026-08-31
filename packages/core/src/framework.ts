import { z } from "zod";

export const projectFrameworkSchema = z.enum(["next", "react", "unknown"]);
export const projectBundlerSchema = z.enum(["next", "vite", "webpack", "cra", "unknown"]);
export const projectRouterSchema = z.enum(["next-app", "next-pages", "react-router", "unknown"]);
export const packageManagerSchema = z.enum(["pnpm", "npm", "yarn", "bun", "unknown"]);
export const integrationKindSchema = z.enum(["next-page", "next-pages", "react-route"]);

export const projectIntegrationSchema = z.object({
  kind: integrationKindSchema,
  file: z.string(),
  template: z.string(),
  package: z.string(),
  extraSteps: z.array(z.string()),
});

export const projectSpecSchema = z.object({
  repoPath: z.string(),
  repoName: z.string(),
  framework: projectFrameworkSchema,
  bundler: projectBundlerSchema,
  router: projectRouterSchema,
  packageManager: packageManagerSchema,
  hasReact: z.boolean(),
  hasNext: z.boolean(),
  isMonorepo: z.boolean(),
  integration: projectIntegrationSchema,
});

export type ProjectFramework = z.infer<typeof projectFrameworkSchema>;
export type ProjectBundler = z.infer<typeof projectBundlerSchema>;
export type ProjectRouter = z.infer<typeof projectRouterSchema>;
export type PackageManager = z.infer<typeof packageManagerSchema>;
export type IntegrationKind = z.infer<typeof integrationKindSchema>;
export type ProjectIntegration = z.infer<typeof projectIntegrationSchema>;
export type ProjectSpec = z.infer<typeof projectSpecSchema>;
