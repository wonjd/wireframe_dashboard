import { z } from "zod";

export const dbOrmSchema = z.enum(["prisma", "drizzle", "typeorm", "unknown"]);
export const dbProviderSchema = z.enum(["sqlite", "postgresql", "mysql", "mongodb", "unknown"]);

export const dbSpecSchema = z.object({
  detected: z.boolean(),
  orm: dbOrmSchema.optional(),
  provider: dbProviderSchema.optional(),
  schemaPath: z.string().optional(),
  models: z.array(z.string()).optional(),
  envFiles: z.array(z.string()).optional(),
});

export const existingContextSchema = z.object({
  repoPath: z.string(),
  repoName: z.string(),
  domains: z.array(z.string()),
  relatedFiles: z.array(z.string()),
  theme: z.object({
    layout: z.string(),
    components: z.array(z.string()),
    tokens: z.record(z.string(), z.string()),
  }),
  framework: z.string(),
  bundler: z.string(),
  router: z.string(),
  packageManager: z.string(),
  database: dbSpecSchema,
  integration: z
    .object({
      kind: z.string(),
      file: z.string(),
      package: z.string(),
    })
    .optional(),
});

export type DbOrm = z.infer<typeof dbOrmSchema>;
export type DbProvider = z.infer<typeof dbProviderSchema>;
export type DbSpec = z.infer<typeof dbSpecSchema>;
export type ExistingContext = z.infer<typeof existingContextSchema>;
