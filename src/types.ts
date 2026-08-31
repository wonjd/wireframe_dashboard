export type Screen = {
  id: string;
  no: number;
  label: string;
  file: string;
  route?: string;
};

export type Manifest = {
  projectNo: string;
  projectSlug: string;
  prdNo: string;
  feature: string;
  title: string;
  mode: "new" | "existing";
  screens: Screen[];
};

export type PrdEntry = {
  prdNo: string;
  feature: string;
  title: string;
  status?: string;
  screenCount?: number;
  children?: { slug: string; title: string; issueNo?: string }[];
};

export type ProjectEntry = {
  no: string;
  slug: string;
  folder: string;
  title: string;
  prds: PrdEntry[];
};

export type Registry = {
  projects: ProjectEntry[];
};
