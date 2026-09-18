import type { MetadataRoute } from "next";

// Session boards and the officer console are not for search engines.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
