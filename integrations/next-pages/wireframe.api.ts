import type { NextApiRequest, NextApiResponse } from "next";
import { handleWireframeApi } from "@wireframe-studio/server/routes";

/**
 * Next.js Pages Router API — 복사 위치:
 *   pages/api/wireframe/[...path].ts
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const raw = req.query.path;
  const path = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const response = await handleWireframeApi(path);
  res.status(response.status);
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.send(await response.text());
}
