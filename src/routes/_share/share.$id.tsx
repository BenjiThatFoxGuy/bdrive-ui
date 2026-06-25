import type { ShareListParams } from "@/types";
import type { components } from "@/lib/api";
import { createFileRoute } from "@tanstack/react-router";
import { shareQueries } from "@/utils/query-options";
import { ErrorView } from "@/components/error-view";
import { $api } from "@/utils/api";

export const Route = createFileRoute("/_share/share/$id")({
  validateSearch: (search: Record<string, unknown>) =>
    search as {
      path?: string;
      sort?: string;
      order?: string;
      limit?: number;
      cursor?: string;
    },
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, params: { id }, deps }) => {
    const res = await queryClient.ensureQueryData(
      $api.queryOptions("get", "/shares/{id}", {
        params: {
          path: {
            id,
          },
        },
      }),
    );
    const password = JSON.parse(sessionStorage.getItem("password") || "null");
    const queryParams: ShareListParams = {
      id,
      password: password || "",
      path: deps.path || "",
    };
    if (deps.sort) queryParams.sort = deps.sort;
    if (deps.order) queryParams.order = deps.order;
    if (deps.limit) queryParams.limit = Number(deps.limit);
    if (deps.cursor) queryParams.cursor = deps.cursor;

    if (res.protected && !password) {
      return;
    }
    await queryClient.ensureInfiniteQueryData(shareQueries.list(queryParams));
  },
  wrapInSuspense: true,
  errorComponent: ({ error }) => {
    return <ErrorView message={error.message} />;
  },
});
