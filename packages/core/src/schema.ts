import { z } from "zod";

export const wireframeModeSchema = z.enum(["new", "existing"]);
export const screenBadgeSchema = z.enum(["NEW", "MODIFY", "EXTEND"]);
export const prdStatusSchema = z.enum(["draft", "review", "approved"]);
export const primaryTabSchema = z.enum(["overview", "screens", "diff", "notes"]);

export const screenSchema = z.object({
  id: z.string(),
  no: z.number().int().positive(),
  label: z.string(),
  file: z.string(),
  route: z.string().optional(),
  type: z.enum(["new", "modify", "extend"]).optional(),
  badge: screenBadgeSchema.optional(),
  related: z.string().optional(),
});

export const manifestSchema = z.object({
  projectNo: z.string(),
  projectSlug: z.string(),
  prdNo: z.string(),
  feature: z.string(),
  title: z.string(),
  mode: wireframeModeSchema,
  createdAt: z.string().optional(),
  screens: z.array(screenSchema),
  diff: z
    .object({
      new: z.number().int().nonnegative(),
      modify: z.number().int().nonnegative(),
      extend: z.number().int().nonnegative(),
    })
    .optional(),
  meta: z
    .object({
      prdPath: z.string().optional(),
      screenCount: z.number().int().nonnegative().optional(),
      notes: z.string().optional(),
      overview: z.string().optional(),
    })
    .optional(),
});

export const prdEntrySchema = z.object({
  prdNo: z.string(),
  feature: z.string(),
  title: z.string(),
  status: prdStatusSchema.default("draft"),
  screenCount: z.number().int().nonnegative().default(0),
  children: z
    .array(z.object({ slug: z.string(), title: z.string(), issueNo: z.string().optional() }))
    .optional(),
});

export const projectEntrySchema = z.object({
  no: z.string(),
  slug: z.string(),
  folder: z.string(),
  title: z.string(),
  prds: z.array(prdEntrySchema),
});

export const registrySchema = z.object({
  projects: z.array(projectEntrySchema),
});

export type WireframeMode = z.infer<typeof wireframeModeSchema>;
export type ScreenBadge = z.infer<typeof screenBadgeSchema>;
export type PrdStatus = z.infer<typeof prdStatusSchema>;
export type PrimaryTab = z.infer<typeof primaryTabSchema>;
export type Screen = z.infer<typeof screenSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type PrdEntry = z.infer<typeof prdEntrySchema>;
export type ProjectEntry = z.infer<typeof projectEntrySchema>;
export type Registry = z.infer<typeof registrySchema>;
