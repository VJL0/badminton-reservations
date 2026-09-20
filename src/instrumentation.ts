import type { Instrumentation } from "next";

/**
 * Called for every error the server captures (rendering, Server Actions, route handlers, the proxy).
 * One structured line per error, so a production log search for the `digest` shown on the error page finds
 * the real cause. Swap the console for an error tracker here if the club ever wants one.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const error = err as { message?: string; digest?: string };
  console.error(
    JSON.stringify({
      level: "error",
      message: error.message ?? String(err),
      digest: error.digest,
      method: request.method,
      path: request.path,
      route: context.routePath,
      routeType: context.routeType,
      router: context.routerKind,
    }),
  );
};
